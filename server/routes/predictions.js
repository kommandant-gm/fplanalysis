const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { buildMinutesRotationProfile } = require('../services/minutesRotationModel');

async function resolveGameweek(gw) {
  const parsed = parseInt(gw, 10);
  if (parsed) return parsed;

  const [rows] = await db.execute('SELECT MIN(gameweek) AS nextGW FROM predictions');
  return rows[0]?.nextGW || 1;
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}



function parseMaybeJson(raw, fallback = []) {
  if (raw == null) return fallback;
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// GET /api/predictions/top?gw=30&pos=MID
router.get('/top', async (req, res) => {
  try {
    const { gw, pos, limit = 20 } = req.query;
    const gameweek = await resolveGameweek(gw);
    const rowLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const posMap = { GKP: 1, DEF: 2, MID: 3, FWD: 4 };
    const posValue = (pos && posMap[pos]) ? posMap[pos] : null;
    const posClause = posValue !== null ? 'AND p.position = ?' : '';
    const topParams = posValue !== null ? [gameweek, posValue, rowLimit] : [gameweek, rowLimit];

    const [rows] = await db.execute(`
      SELECT
        p.id, p.name, p.price, p.form, p.position,
        t.short_name AS team,
        pr.xpts, pr.likely_pts, pr.min_pts, pr.max_pts,
        pr.xg_prob, pr.xa_prob, pr.cs_prob, pr.fdr, pr.gameweek
      FROM predictions pr
      JOIN players p ON pr.player_id = p.id
      JOIN teams t ON p.team_id = t.id
      WHERE pr.gameweek = ? ${posClause}
      ORDER BY pr.xpts DESC
      LIMIT ?
    `, topParams);

    res.json({ success: true, gameweek, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/predictions/transfers — suggest best transfers
// Compare top available players vs worst in same position by xpts over 3 GWs
router.get('/transfers', async (req, res) => {
  try {
    const posMap = { GKP: 1, DEF: 2, MID: 3, FWD: 4 };
    const reqPos = String(req.query.pos || '').toUpperCase();
    const requestedPosition = posMap[reqPos] || null;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 5), 40);

    const [gwRows] = await db.execute(
      'SELECT DISTINCT gameweek FROM predictions ORDER BY gameweek ASC LIMIT 3'
    );
    const gameweeks = gwRows
      .map(r => parseInt(r.gameweek, 10))
      .filter(Number.isFinite);

    if (!gameweeks.length) {
      return res.json({
        success: true,
        gameweeks: [],
        data: [],
        best_by_position: [],
      });
    }

    const gwPlaceholders = gameweeks.map(() => '?').join(', ');
    const [rows] = await db.execute(`
      SELECT
        p.id, p.name, p.price, p.position,
        t.short_name AS team,
        ROUND(SUM(pr.xpts), 2) AS total_xpts_3gw,
        ROUND(AVG(pr.xpts), 2) AS avg_xpts,
        GROUP_CONCAT(pr.gameweek ORDER BY pr.gameweek) AS gameweeks,
        GROUP_CONCAT(pr.xpts ORDER BY pr.gameweek) AS xpts_per_gw,
        GROUP_CONCAT(pr.likely_pts ORDER BY pr.gameweek) AS likely_per_gw,
        GROUP_CONCAT(pr.fdr ORDER BY pr.gameweek) AS fdrs
      FROM predictions pr
      JOIN players p ON pr.player_id = p.id
      JOIN teams t ON p.team_id = t.id
      WHERE pr.gameweek IN (${gwPlaceholders})
      GROUP BY p.id, p.name, p.price, p.position, t.short_name
      ORDER BY total_xpts_3gw DESC
    `, gameweeks);

    const normalized = rows.map(r => ({
      ...r,
      id: parseInt(r.id, 10),
      position: parseInt(r.position, 10),
      price: parseFloat(r.price),
      total_xpts_3gw: parseFloat(r.total_xpts_3gw) || 0,
      avg_xpts: parseFloat(r.avg_xpts) || 0,
    }));

    const byPos = { 1: [], 2: [], 3: [], 4: [] };
    normalized.forEach(r => {
      if (byPos[r.position]) byPos[r.position].push(r);
    });

    const buildCandidatesForPosition = (players, position) => {
      if (!players || players.length < 2) return [];

      const sortedDesc = [...players].sort((a, b) => b.total_xpts_3gw - a.total_xpts_3gw);
      const sortedAsc = [...players].sort((a, b) => a.total_xpts_3gw - b.total_xpts_3gw);

      const topPool = sortedDesc.slice(0, Math.min(12, sortedDesc.length));
      const outPool = sortedAsc.slice(0, Math.min(20, sortedAsc.length));
      const candidates = [];

      for (const inPlayer of topPool) {
        let best = null;

        for (const outPlayer of outPool) {
          if (inPlayer.id === outPlayer.id) continue;
          if (Math.abs(inPlayer.price - outPlayer.price) > 1.5) continue;

          const gain = inPlayer.total_xpts_3gw - outPlayer.total_xpts_3gw;
          if (gain <= 0) continue;

          const transfer = {
            out: {
              id: outPlayer.id,
              name: outPlayer.name,
              team: outPlayer.team,
              price: outPlayer.price,
              xpts: outPlayer.total_xpts_3gw.toFixed(1),
            },
            in: {
              id: inPlayer.id,
              name: inPlayer.name,
              team: inPlayer.team,
              price: inPlayer.price,
              xpts: inPlayer.total_xpts_3gw.toFixed(1),
            },
            gain: parseFloat(gain.toFixed(1)),
            position,
          };

          if (!best || transfer.gain > best.gain) best = transfer;
        }

        if (best) candidates.push(best);
      }

      return candidates.sort((a, b) => b.gain - a.gain);
    };

    const allPositions = [1, 2, 3, 4];
    const candidateMap = {
      1: buildCandidatesForPosition(byPos[1], 1),
      2: buildCandidatesForPosition(byPos[2], 2),
      3: buildCandidatesForPosition(byPos[3], 3),
      4: buildCandidatesForPosition(byPos[4], 4),
    };

    const scopePositions = requestedPosition ? [requestedPosition] : allPositions;
    const scopedCandidates = scopePositions.flatMap(pos => candidateMap[pos] || []);
    scopedCandidates.sort((a, b) => b.gain - a.gain);

    // Keep output diverse and remove duplicate "IN" names.
    const uniqueTransfers = [];
    const seenIn = new Set();
    const seenOut = new Set();
    for (const t of scopedCandidates) {
      if (seenIn.has(t.in.id)) continue;
      if (seenOut.has(t.out.id)) continue;
      uniqueTransfers.push(t);
      seenIn.add(t.in.id);
      seenOut.add(t.out.id);
      if (uniqueTransfers.length >= limit) break;
    }

    const bestByPosition = allPositions
      .map(pos => (candidateMap[pos] || [])[0])
      .filter(Boolean);

    res.json({
      success: true,
      gameweeks,
      position_filter: reqPos || 'ALL',
      data: uniqueTransfers,
      best_by_position: bestByPosition,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/predictions/captain?gw=30
router.get('/captain', async (req, res) => {
  try {
    const { gw } = req.query;
    const gameweek = await resolveGameweek(gw);
    const includeDef = String(req.query.includeDef || '').toLowerCase() === '1';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 3), 10);

    // Pull a wider candidate pool, then rank with captain-specific logic.
    const [candidates] = await db.execute(
      `SELECT
         p.id, p.name, p.price, p.form, p.position, p.xg, p.xa,
         t.short_name AS team,
         fd.season_rating,
         pr.xpts, pr.likely_pts, pr.max_pts, pr.fdr,
         pr.xg_prob, pr.xa_prob, pr.cs_prob, pr.mins_prob, pr.avg_bonus
       FROM predictions pr
       JOIN players p ON pr.player_id = p.id
       JOIN teams t ON p.team_id = t.id
       LEFT JOIN player_fotmob_data fd ON p.id = fd.player_id
       WHERE pr.gameweek = ?
       ORDER BY pr.xpts DESC
       LIMIT 120`,
      [gameweek]
    );

    if (!candidates.length) {
      return res.json({ success: true, gameweek, data: [] });
    }

    const playerIds = candidates
      .map(r => parseInt(r.id, 10))
      .filter(Number.isFinite);

    const idPlaceholders = playerIds.map(() => '?').join(',');
    const [historyRows] = await db.query(
      `SELECT
         player_id, gameweek, total_points, minutes
       FROM player_gameweek_history
       WHERE player_id IN (${idPlaceholders}) AND gameweek < ?
       ORDER BY player_id ASC, gameweek DESC`,
      [...playerIds, gameweek]
    );

    const historyByPlayer = {};
    for (const row of historyRows) {
      if (!historyByPlayer[row.player_id]) historyByPlayer[row.player_id] = [];
      historyByPlayer[row.player_id].push(row);
    }

    const positionMult = { 1: 0.55, 2: 0.78, 3: 1.08, 4: 1.12 };

    const ranked = candidates.map(row => {
      const history = (historyByPlayer[row.id] || []).slice(0, 6);
      const points = history.map(h => Number(h.total_points) || 0);
      const mins = history.map(h => Number(h.minutes) || 0);
      const sample = history.length;

      const avgPts6 = sample ? points.reduce((s, p) => s + p, 0) / sample : 0;
      const avgMins6 = sample ? mins.reduce((s, m) => s + m, 0) / sample : 70;
      const blanksRate = sample
        ? points.filter(p => p <= 2).length / sample
        : 0.45;
      const returnsRate = sample
        ? points.filter(p => p >= 6).length / sample
        : 0.2;

      const minsProb = Number(row.mins_prob) || 0;
      const xgProb = Number(row.xg_prob) || 0;
      const xaProb = Number(row.xa_prob) || 0;
      const xpts = Number(row.xpts) || 0;
      const form = Number(row.form) || 0;
      const xg = Number(row.xg) || 0;
      const xa = Number(row.xa) || 0;
      const seasonRating = Number(row.season_rating) || 6.8;
      const pos = Number(row.position) || 0;

      const attackingSignal =
        (xgProb * 4.4) +
        (xaProb * 2.6) +
        (xg * 2.8) +
        (xa * 1.8);

      const consistencySignal =
        (avgPts6 * 0.58) +
        (returnsRate * 2.0) -
        (blanksRate * 1.55) +
        (Math.min(avgMins6, 90) / 90) * 0.65;

      const fotmobSignal = (seasonRating - 6.5) * 0.9;
      const modelSignal =
        (xpts * 0.70) +
        ((Number(row.likely_pts) || 0) * 0.35) +
        (minsProb * 1.4) +
        ((Number(row.avg_bonus) || 0) * 0.35);

      const rawScore =
        modelSignal +
        attackingSignal +
        consistencySignal +
        fotmobSignal +
        (form * 0.16);

      const captainScore = rawScore * (positionMult[pos] || 0.9);

      return {
        ...row,
        avg_points_last6: parseFloat(avgPts6.toFixed(2)),
        mins_last6: parseFloat(avgMins6.toFixed(1)),
        blanks_rate: parseFloat(blanksRate.toFixed(3)),
        returns_rate: parseFloat(returnsRate.toFixed(3)),
        captain_score: parseFloat(captainScore.toFixed(3)),
      };
    });

    // Captaincy should prioritize attacking players by default.
    const primaryPool = ranked.filter(r => Number(r.position) >= 3);
    const secondaryPool = ranked.filter(r => Number(r.position) === 2);
    const fallbackPool = ranked.filter(r => Number(r.position) === 1);

    let pool = includeDef ? ranked : primaryPool;
    if (!pool.length) pool = secondaryPool.length ? secondaryPool : fallbackPool;

    // Hard floor to avoid obvious poor captain picks.
    const quality = pool.filter(r =>
      (Number(r.mins_prob) || 0) >= 0.55 &&
      (Number(r.avg_points_last6) || 0) >= 2.2 &&
      (Number(r.captain_score) || 0) > 0
    );

    const base = quality.length >= limit ? quality : pool;
    const rows = [...base]
      .sort((a, b) => b.captain_score - a.captain_score)
      .slice(0, limit);

    res.json({ success: true, gameweek, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/predictions/rotation-risk?gw=30&limit=12&sort=xpts
// Uses FPL minutes history + FotMob recent minutes to estimate rotation risk.
router.get('/rotation-risk', async (req, res) => {
  try {
    const gameweek = await resolveGameweek(req.query.gw);
    const requestedLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 800)
      : null;
    const sort = String(req.query.sort || 'xpts').toLowerCase();

    const [rows] = await db.execute(
      `SELECT
         p.id, p.name, p.position, p.status,
         p.chance_of_playing_next_round, p.chance_of_playing_this_round,
         t.short_name AS team,
         pr.xpts, pr.likely_pts, pr.mins_prob, pr.fdr,
         fd.recent_matches
       FROM predictions pr
       JOIN players p ON pr.player_id = p.id
       JOIN teams t ON p.team_id = t.id
       LEFT JOIN player_fotmob_data fd ON p.id = fd.player_id
       WHERE pr.gameweek = ?
       ORDER BY pr.xpts DESC`,
      [gameweek]
    );

    if (!rows.length) {
      return res.json({ success: true, gameweek, data: [] });
    }

    const playerIds = rows.map(r => parseInt(r.id, 10)).filter(Number.isFinite);
    const idPlaceholders = playerIds.map(() => '?').join(',');
    const [historyRows] = await db.query(
      `SELECT player_id, gameweek, minutes
       FROM player_gameweek_history
       WHERE player_id IN (${idPlaceholders}) AND gameweek < ?
       ORDER BY player_id ASC, gameweek DESC`,
      [...playerIds, gameweek]
    );

    const historyByPlayer = {};
    for (const row of historyRows) {
      if (!historyByPlayer[row.player_id]) historyByPlayer[row.player_id] = [];
      historyByPlayer[row.player_id].push(row);
    }

    const statusMult = { a: 1, d: 0.75, i: 0.05, s: 0.25, u: 0.2, n: 0.35 };

    const data = rows.map((row) => {
      const chance = row.chance_of_playing_next_round != null
        ? toNum(row.chance_of_playing_next_round, 100)
        : row.chance_of_playing_this_round != null
          ? toNum(row.chance_of_playing_this_round, 100)
          : 100;
      const availability = clamp((chance / 100) * (statusMult[String(row.status || 'a').toLowerCase()] ?? 1), 0, 1);
      const model = buildMinutesRotationProfile({
        fplHistoryRows: historyByPlayer[row.id] || [],
        fotmobMatches: parseMaybeJson(row.recent_matches, []),
        fallbackMinsProb: toNum(row.mins_prob, 0.7),
        availability,
      });
      const minsProbModel = clamp(toNum(model.minsProb, 0.7), 0, 1);
      const minsProbPred = clamp(toNum(row.mins_prob, minsProbModel), 0, 1);
      const minsProb = clamp((minsProbModel * 0.65) + (minsProbPred * 0.35), 0, 1);
      const availabilityRisk = (1 - availability) * 24;
      const predictionDriftRisk = Math.abs(minsProbPred - minsProbModel) * 22;
      const rotationRisk = clamp(
        toNum(model.rotationRisk, 45) + availabilityRisk + predictionDriftRisk,
        1,
        99
      );
      const startRate = clamp(toNum(model.startRate, 0), 0, 1);
      const subOnRate = clamp(toNum(model.subOnRate, 0), 0, 1);
      const cameoRate = clamp(toNum(model.cameoRate, 0), 0, 1);
      const subOffRate = clamp(toNum(model.subOffRate, 0), 0, 1);
      const avgFplMinutes = model.avgFplMinutes != null ? toNum(model.avgFplMinutes, 0) : null;
      const avgFotmobMinutes = model.avgFotmobMinutes != null ? toNum(model.avgFotmobMinutes, 0) : null;
      const avgMinutesCombined = toNum(model.avgMinutesCombined, 0);
      const minsVolatility = toNum(model.minsVolatility, 0);
      const fplSample = toNum(model.fplSample, 0);
      const fotmobSample = toNum(model.fotmobSample, 0);

      let substitutionPattern = 'Mixed pattern';
      if (!fplSample && !fotmobSample) substitutionPattern = 'No minutes sample';
      else if (cameoRate >= 0.35) substitutionPattern = 'Frequent cameo';
      else if (subOnRate >= 0.38) substitutionPattern = 'Often subbed on';
      else if (subOffRate >= 0.45) substitutionPattern = 'Often subbed off';
      else if (startRate >= 0.8 && avgMinutesCombined >= 80) substitutionPattern = "Regular starter";
      else if (avgMinutesCombined < 65) substitutionPattern = 'Managed minutes';

      const riskBand =
        rotationRisk >= 70 ? 'High' :
        rotationRisk >= 45 ? 'Medium' : 'Low';

      return {
        id: row.id,
        name: row.name,
        team: row.team,
        position: row.position,
        fdr: row.fdr,
        xpts: parseFloat(toNum(row.xpts, 0).toFixed(2)),
        likely_pts: toNum(row.likely_pts, 0),
        mins_prob: parseFloat(minsProb.toFixed(3)),
        avg_minutes_fpl: avgFplMinutes != null ? parseFloat(avgFplMinutes.toFixed(1)) : null,
        avg_minutes_fotmob: avgFotmobMinutes != null ? parseFloat(avgFotmobMinutes.toFixed(1)) : null,
        avg_minutes_combined: parseFloat(avgMinutesCombined.toFixed(1)),
        minutes_sample: {
          fpl: fplSample,
          fotmob: fotmobSample,
        },
        substitution_pattern: substitutionPattern,
        substitution_stats: {
          start_rate: parseFloat(startRate.toFixed(3)),
          sub_on_rate: parseFloat(subOnRate.toFixed(3)),
          cameo_rate: parseFloat(cameoRate.toFixed(3)),
          sub_off_rate: parseFloat(subOffRate.toFixed(3)),
          minutes_volatility: parseFloat(minsVolatility.toFixed(2)),
        },
        rotation_risk: parseFloat(rotationRisk.toFixed(1)),
        rotation_risk_band: riskBand,
      };
    });

    const ranked = [...data].sort((a, b) => {
      if (sort === 'risk') return b.rotation_risk - a.rotation_risk;
      if (sort === 'minutes') return b.avg_minutes_combined - a.avg_minutes_combined;
      return b.xpts - a.xpts;
    });

    res.json({
      success: true,
      gameweek,
      sort,
      data: limit ? ranked.slice(0, limit) : ranked,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/predictions/insights?gw=30&limit=8
// Returns chart-ready dashboard data:
// - league-wide GW trend from historical FPL matches
// - top predicted players and their recent GW points history
router.get('/insights', async (req, res) => {
  try {
    const gameweek = await resolveGameweek(req.query.gw);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 8, 4), 12);

    const [topRows] = await db.execute(
      `SELECT
         p.id, p.name, p.position, t.short_name AS team,
         pr.gameweek, pr.xpts, pr.likely_pts, pr.fdr
       FROM predictions pr
       JOIN players p ON pr.player_id = p.id
       JOIN teams t ON p.team_id = t.id
       WHERE pr.gameweek = ?
       ORDER BY pr.xpts DESC
       LIMIT ${limit}`,
      [gameweek]
    );

    const [trendRows] = await db.execute(
      `SELECT
         gameweek,
         ROUND(AVG(total_points), 3) AS avg_points,
         ROUND(AVG(COALESCE(expected_goals, 0)), 3) AS avg_xg,
         ROUND(AVG(COALESCE(expected_assists, 0)), 3) AS avg_xa,
         COUNT(*) AS sample_size
       FROM player_gameweek_history
       GROUP BY gameweek
       ORDER BY gameweek DESC
       LIMIT 12`
    );

    if (!topRows.length) {
      return res.json({
        success: true,
        gameweek,
        trend: trendRows.reverse(),
        players: [],
        momentum: [],
      });
    }

    const playerIds = topRows
      .map(r => parseInt(r.id, 10))
      .filter(Number.isFinite);

    if (!playerIds.length) {
      return res.json({
        success: true,
        gameweek,
        trend: trendRows.reverse(),
        players: [],
        momentum: [],
      });
    }

    const insightIdPlaceholders = playerIds.map(() => '?').join(',');
    const [historyRows] = await db.query(
      `SELECT
         player_id, gameweek, total_points, minutes,
         goals_scored, assists, expected_goals, expected_assists
       FROM player_gameweek_history
       WHERE player_id IN (${insightIdPlaceholders}) AND gameweek < ?
       ORDER BY player_id ASC, gameweek DESC`,
      [...playerIds, gameweek]
    );

    const historyMap = {};
    historyRows.forEach(row => {
      if (!historyMap[row.player_id]) historyMap[row.player_id] = [];
      historyMap[row.player_id].push(row);
    });

    const players = topRows.map((row) => {
      const history = (historyMap[row.id] || [])
        .slice(0, 6)
        .reverse()
        .map(h => ({
          gameweek: h.gameweek,
          points: h.total_points,
          minutes: h.minutes,
          goals: h.goals_scored,
          assists: h.assists,
          xg: h.expected_goals != null ? parseFloat(h.expected_goals) : null,
          xa: h.expected_assists != null ? parseFloat(h.expected_assists) : null,
        }));

      const points = history.map(h => Number(h.points) || 0);
      const last3 = points.slice(-3);
      const avgLast6 = points.length
        ? points.reduce((s, p) => s + p, 0) / points.length
        : 0;
      const avgLast3 = last3.length
        ? last3.reduce((s, p) => s + p, 0) / last3.length
        : 0;

      return {
        ...row,
        history,
        history_points: points,
        avg_last6: parseFloat(avgLast6.toFixed(2)),
        avg_last3: parseFloat(avgLast3.toFixed(2)),
        momentum: parseFloat((avgLast3 - avgLast6).toFixed(2)),
      };
    });

    const momentum = [...players]
      .sort((a, b) => b.momentum - a.momentum)
      .slice(0, 6)
      .map(p => ({
        id: p.id,
        name: p.name,
        team: p.team,
        position: p.position,
        momentum: p.momentum,
        avg_last3: p.avg_last3,
        avg_last6: p.avg_last6,
        next_xpts: parseFloat(parseFloat(p.xpts).toFixed(2)),
      }));

    res.json({
      success: true,
      gameweek,
      trend: trendRows.reverse(),
      players,
      momentum,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
