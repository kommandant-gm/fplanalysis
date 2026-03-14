const axios = require('axios');
const db = require('../config/db');
const { syncFotMobData } = require('./fotmobScraper');
const { buildMinutesRotationProfile } = require('./minutesRotationModel');

const FPL_BASE = 'https://fantasy.premierleague.com/api';
const HISTORY_WINDOW = 38;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toNullableNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdDev(values) {
  if (!values.length) return 0;
  const avg = mean(values);
  const variance = mean(values.map(v => (v - avg) ** 2));
  return Math.sqrt(variance);
}

function weightedBlend(parts, fallback = 0) {
  const valid = parts.filter(p => p.value != null && Number.isFinite(p.value) && p.weight > 0);
  if (!valid.length) return fallback;
  const weightTotal = valid.reduce((sum, p) => sum + p.weight, 0);
  if (!weightTotal) return fallback;
  return valid.reduce((sum, p) => sum + (p.value * p.weight), 0) / weightTotal;
}

function poissonPMF(lambda, k) {
  if (!Number.isFinite(lambda) || lambda < 0 || k < 0) return 0;
  let factorial = 1;
  for (let i = 2; i <= k; i++) factorial *= i;
  return (Math.exp(-lambda) * (lambda ** k)) / factorial;
}

// Dixon-Coles low-score correction term.
function dixonColesTau(homeGoals, awayGoals, lambdaHome, lambdaAway, rho) {
  if (homeGoals === 0 && awayGoals === 0) {
    return Math.max(0.25, 1 - (lambdaHome * lambdaAway * rho));
  }
  if (homeGoals === 0 && awayGoals === 1) {
    return Math.max(0.25, 1 + (lambdaHome * rho));
  }
  if (homeGoals === 1 && awayGoals === 0) {
    return Math.max(0.25, 1 + (lambdaAway * rho));
  }
  if (homeGoals === 1 && awayGoals === 1) {
    return Math.max(0.25, 1 - rho);
  }
  return 1;
}

function buildDixonColesScoreMatrix(lambdaHome, lambdaAway, rho = -0.08, maxGoals = 7) {
  const matrix = [];
  let total = 0;

  for (let h = 0; h <= maxGoals; h++) {
    matrix[h] = [];
    const pH = poissonPMF(lambdaHome, h);
    for (let a = 0; a <= maxGoals; a++) {
      const pA = poissonPMF(lambdaAway, a);
      const tau = dixonColesTau(h, a, lambdaHome, lambdaAway, rho);
      const p = pH * pA * tau;
      matrix[h][a] = p;
      total += p;
    }
  }

  if (total <= 0) return matrix;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      matrix[h][a] = matrix[h][a] / total;
    }
  }
  return matrix;
}

function extractTeamGoalDistribution(scoreMatrix, side = 'home') {
  if (!Array.isArray(scoreMatrix) || !scoreMatrix.length) return [];
  const maxGoals = scoreMatrix.length - 1;
  const dist = Array(maxGoals + 1).fill(0);

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = toNum(scoreMatrix[h]?.[a], 0);
      if (side === 'home') dist[h] += p;
      else dist[a] += p;
    }
  }

  const total = dist.reduce((s, p) => s + p, 0);
  if (total <= 0) return dist;
  return dist.map(p => p / total);
}

function playerGoalProbFromTeamDistribution(teamGoalDist = [], playerShare = 0) {
  const share = clamp(playerShare, 0, 0.92);
  if (!teamGoalDist.length || share <= 0) return 0;

  let prob = 0;
  for (let goals = 0; goals < teamGoalDist.length; goals++) {
    const pGoals = toNum(teamGoalDist[goals], 0);
    if (pGoals <= 0) continue;
    // Given team scores k goals, approximate player's chance of >=1 goal by share allocation.
    const pPlayerScores = 1 - ((1 - share) ** goals);
    prob += pGoals * pPlayerScores;
  }
  return clamp(prob, 0, 0.99);
}

function expectedConcedeDeduction(oppGoalDist = [], minsProb = 1) {
  if (!Array.isArray(oppGoalDist) || !oppGoalDist.length) return 0;
  const minutesWeight = clamp(toNum(minsProb, 0), 0, 1);
  let expectedBlocks = 0;
  for (let goals = 0; goals < oppGoalDist.length; goals++) {
    const pGoals = toNum(oppGoalDist[goals], 0);
    if (pGoals <= 0) continue;
    expectedBlocks += Math.floor(goals / 2) * pGoals;
  }
  return expectedBlocks * minutesWeight;
}

function expectedAppearancePoints(minsProb = 0, startRate = 0, avgMinutes = null) {
  const pPlay = clamp(toNum(minsProb, 0), 0, 1);
  if (pPlay <= 0) return 0;

  const start = clamp(toNum(startRate, 0), 0, 1);
  const avg = avgMinutes != null ? clamp(toNum(avgMinutes, 0), 0, 90) : null;
  const sixtyFromAvg = avg != null ? clamp((avg - 15) / 75, 0, 1) : start;
  const pSixtyGivenPlay = clamp((start * 0.7) + (sixtyFromAvg * 0.3), 0, 1);
  const pSixty = clamp(pPlay * pSixtyGivenPlay, 0, pPlay);

  // FPL appearance scoring: +1 for appearance, +1 more for 60+ mins.
  return pPlay + pSixty;
}

function parseMaybeJson(raw, fallback = null) {
  if (raw == null) return fallback;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function getAvailabilityMultiplier(status, chanceNext, chanceThis) {
  const statusMap = { a: 1, d: 0.72, i: 0.08, s: 0.15, u: 0.25, n: 0.35 };
  const byStatus = statusMap[String(status || 'a').toLowerCase()] ?? 1;
  const chance = chanceNext ?? chanceThis;
  const byChance = chance != null ? clamp(toNum(chance, 100) / 100, 0.05, 1) : 1;
  return clamp(byStatus * byChance, 0.03, 1);
}

function getSetPieceBonuses(profile = {}) {
  const pen = profile.penaltiesOrder;
  const fk = profile.directFreekicksOrder;
  const cor = profile.cornersOrder;

  const penaltyGoalBoost =
    pen === 1 ? 0.14 :
    pen === 2 ? 0.08 :
    pen === 3 ? 0.04 : 0;

  const freeKickGoalBoost =
    fk === 1 ? 0.07 :
    fk === 2 ? 0.035 :
    fk === 3 ? 0.015 : 0;

  const cornerAssistBoost =
    cor === 1 ? 0.10 :
    cor === 2 ? 0.06 :
    cor === 3 ? 0.03 : 0;

  const directFkAssistBoost =
    fk === 1 ? 0.03 :
    fk === 2 ? 0.015 : 0;

  return {
    penaltyGoalBoost,
    freeKickGoalBoost,
    cornerAssistBoost,
    directFkAssistBoost,
  };
}

function getFotmobRecentFeatures(recentMatchesRaw) {
  const rows = Array.isArray(recentMatchesRaw) ? recentMatchesRaw.slice(0, 8) : [];
  if (!rows.length) {
    return {
      avgRating: null,
      xg90: null,
      xa90: null,
      xgot90: null,
      shots90: null,
      sot90: null,
      bigChances90: null,
      scoreRate: null,
    };
  }

  const ratings = rows.map(r => toNum(r?.rating, 0)).filter(v => v > 0);
  const mins = rows.map(r => toNum(r?.minutes, 0));
  const totalMinutes = mins.reduce((s, m) => s + m, 0);
  const totalXg = rows.reduce((s, r) => s + toNum(r?.xg, 0), 0);
  const totalXa = rows.reduce((s, r) => s + toNum(r?.xa, 0), 0);
  const totalGoals = rows.reduce((s, r) => s + toNum(r?.goals, 0), 0);
  const xgotRows = rows.filter(r => r?.xgot != null);
  const shotsRows = rows.filter(r => r?.shots != null);
  const sotRows = rows.filter(r => r?.shotsOnTarget != null);
  const bigRows = rows.filter(r => r?.bigChances != null);
  const totalXgot = xgotRows.reduce((s, r) => s + toNum(r?.xgot, 0), 0);
  const totalShots = shotsRows.reduce((s, r) => s + toNum(r?.shots, 0), 0);
  const totalSot = sotRows.reduce((s, r) => s + toNum(r?.shotsOnTarget, 0), 0);
  const totalBig = bigRows.reduce((s, r) => s + toNum(r?.bigChances, 0), 0);
  const scoringMatches = rows.filter(r => toNum(r?.goals, 0) > 0).length;

  return {
    avgRating: ratings.length ? mean(ratings) : null,
    xg90: totalMinutes > 0 ? (totalXg / totalMinutes) * 90 : null,
    xa90: totalMinutes > 0 ? (totalXa / totalMinutes) * 90 : null,
    xgot90: totalMinutes > 0 && xgotRows.length ? (totalXgot / totalMinutes) * 90 : null,
    shots90: totalMinutes > 0 && shotsRows.length ? (totalShots / totalMinutes) * 90 : null,
    sot90: totalMinutes > 0 && sotRows.length ? (totalSot / totalMinutes) * 90 : null,
    bigChances90: totalMinutes > 0 && bigRows.length ? (totalBig / totalMinutes) * 90 : null,
    scoreRate: rows.length ? scoringMatches / rows.length : null,
    goals90: totalMinutes > 0 ? (totalGoals / totalMinutes) * 90 : null,
  };
}

// Fetch all bootstrap data (players, teams, gameweeks)
async function fetchBootstrap() {
  const res = await axios.get(`${FPL_BASE}/bootstrap-static/`, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  return res.data;
}

// Fetch fixtures
async function fetchFixtures() {
  const res = await axios.get(`${FPL_BASE}/fixtures/`, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  return res.data;
}

// Lightweight sync for injury/news + core FPL fields only.
// Designed for frequent runs (e.g. every 15 minutes).
async function syncAvailabilityData() {
  console.log('[FPL] Starting lightweight availability sync...');
  await ensurePredictionModelColumns();

  const bootstrap = await fetchBootstrap();
  const teams = bootstrap?.teams || [];
  const elements = bootstrap?.elements || [];

  for (const team of teams) {
    await db.execute(
      `INSERT INTO teams (id, name, short_name) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), short_name=VALUES(short_name)`,
      [team.id, team.name, team.short_name]
    );
  }

  const [existingRows] = await db.execute('SELECT id FROM players');
  const existingPlayerIds = new Set(
    existingRows.map((r) => toNum(r.id, 0)).filter(Boolean)
  );

  let updated = 0;
  for (const p of elements) {
    if (!existingPlayerIds.has(toNum(p.id, 0))) continue;

    await db.execute(
      `UPDATE players
       SET
         name=?,
         team_id=?,
         position=?,
         price=?,
         total_points=?,
         form=?,
         minutes=?,
         goals_scored=?,
         assists=?,
         clean_sheets=?,
         selected_by_percent=?,
         status=?,
         chance_of_playing_next_round=?,
         chance_of_playing_this_round=?,
         news=?,
         penalties_order=?,
         direct_freekicks_order=?,
         corners_and_indirect_freekicks_order=?
       WHERE id=?`,
      [
        `${p.first_name} ${p.second_name}`,
        p.team,
        p.element_type,
        p.now_cost / 10,
        toNum(p.total_points, 0),
        toNum(p.form, 0),
        toNum(p.minutes, 0),
        toNum(p.goals_scored, 0),
        toNum(p.assists, 0),
        toNum(p.clean_sheets, 0),
        toNum(p.selected_by_pct, 0),
        p.status || 'a',
        p.chance_of_playing_next_round != null ? toNum(p.chance_of_playing_next_round, 100) : null,
        p.chance_of_playing_this_round != null ? toNum(p.chance_of_playing_this_round, 100) : null,
        p.news || null,
        p.penalties_order != null ? toNum(p.penalties_order, 0) : null,
        p.direct_freekicks_order != null ? toNum(p.direct_freekicks_order, 0) : null,
        p.corners_and_indirect_freekicks_order != null ? toNum(p.corners_and_indirect_freekicks_order, 0) : null,
        p.id,
      ]
    );
    updated++;
  }

  console.log(`[FPL] Lightweight availability sync complete. Updated players: ${updated}`);
  return { updated };
}

// Fetch individual player history
async function fetchPlayerHistory(playerId) {
  const res = await axios.get(`${FPL_BASE}/element-summary/${playerId}/`, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  return res.data;
}

async function fetchPlayerHistoryWithRetry(playerId, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchPlayerHistory(playerId);
    } catch (err) {
      lastErr = err;
      const waitMs = 350 + (i * 450);
      await sleep(waitMs);
    }
  }
  throw lastErr || new Error(`history fetch failed for player ${playerId}`);
}

async function ensurePredictionModelColumns() {
  const dbName = process.env.MYSQLDATABASE || process.env.DB_NAME || 'fpl_analysis';
  const [cols] = await db.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'players'`,
    [dbName]
  );
  const existing = new Set(cols.map(c => c.COLUMN_NAME));

  const defs = {
    status: "CHAR(1) DEFAULT 'a'",
    chance_of_playing_next_round: 'TINYINT DEFAULT NULL',
    chance_of_playing_this_round: 'TINYINT DEFAULT NULL',
    news: 'VARCHAR(255) DEFAULT NULL',
    penalties_order: 'TINYINT DEFAULT NULL',
    direct_freekicks_order: 'TINYINT DEFAULT NULL',
    corners_and_indirect_freekicks_order: 'TINYINT DEFAULT NULL',
    last_gw_points: 'INT DEFAULT NULL',
    last_gw_minutes: 'INT DEFAULT NULL',
    avg_points_last3: 'DECIMAL(5,2) DEFAULT NULL',
    avg_points_last6: 'DECIMAL(5,2) DEFAULT NULL',
    avg_minutes_last3: 'DECIMAL(6,2) DEFAULT NULL',
    avg_minutes_last6: 'DECIMAL(6,2) DEFAULT NULL',
  };

  for (const [col, def] of Object.entries(defs)) {
    if (existing.has(col)) continue;
    await db.execute(`ALTER TABLE players ADD COLUMN ${col} ${def}`);
  }
}

async function syncPlayerGameweekHistory(players, currentGW) {
  const tracked = Array.isArray(players) ? players : [];
  const batchSize = 4;
  let done = 0;
  let rowsUpserted = 0;

  for (let i = 0; i < tracked.length; i += batchSize) {
    const batch = tracked.slice(i, i + batchSize);

    await Promise.all(batch.map(async (player) => {
      try {
        const summary = await fetchPlayerHistoryWithRetry(player.id, 3);
        const history = (summary?.history || [])
          .filter(h => toNum(h.round, 0) > 0 && toNum(h.round, 0) < currentGW)
          .sort((a, b) => toNum(b.round, 0) - toNum(a.round, 0))
          .slice(0, Math.max(HISTORY_WINDOW, 10));

        for (const h of history) {
          await db.execute(
            `INSERT INTO player_gameweek_history
               (player_id, gameweek, opponent_team_id, was_home,
                total_points, minutes, goals_scored, assists, clean_sheets,
                expected_goals, expected_assists, kickoff_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               opponent_team_id=VALUES(opponent_team_id),
               was_home=VALUES(was_home),
               total_points=VALUES(total_points),
               minutes=VALUES(minutes),
               goals_scored=VALUES(goals_scored),
               assists=VALUES(assists),
               clean_sheets=VALUES(clean_sheets),
               expected_goals=VALUES(expected_goals),
               expected_assists=VALUES(expected_assists),
               kickoff_time=VALUES(kickoff_time)`,
            [
              player.id,
              toNum(h.round, 0),
              toNum(h.opponent_team, 0) || null,
              h.was_home ? 1 : 0,
              toNum(h.total_points, 0),
              toNum(h.minutes, 0),
              toNum(h.goals_scored, 0),
              toNum(h.assists, 0),
              toNum(h.clean_sheets, 0),
              toNullableNum(h.expected_goals),
              toNullableNum(h.expected_assists),
              h.kickoff_time ? new Date(h.kickoff_time) : null,
            ]
          );
          rowsUpserted++;
        }

        const recent6 = history.slice(0, 6);
        const recent3 = history.slice(0, 3);
        const last = history[0] || null;

        const avgPoints6 = recent6.length ? mean(recent6.map(h => toNum(h.total_points, 0))) : null;
        const avgPoints3 = recent3.length ? mean(recent3.map(h => toNum(h.total_points, 0))) : null;
        const avgMinutes6 = recent6.length ? mean(recent6.map(h => toNum(h.minutes, 0))) : null;
        const avgMinutes3 = recent3.length ? mean(recent3.map(h => toNum(h.minutes, 0))) : null;

        await db.execute(
          `UPDATE players
           SET
             last_gw_points = ?,
             last_gw_minutes = ?,
             avg_points_last3 = ?,
             avg_points_last6 = ?,
             avg_minutes_last3 = ?,
             avg_minutes_last6 = ?
           WHERE id = ?`,
          [
            last ? toNum(last.total_points, 0) : null,
            last ? toNum(last.minutes, 0) : null,
            avgPoints3 != null ? parseFloat(avgPoints3.toFixed(2)) : null,
            avgPoints6 != null ? parseFloat(avgPoints6.toFixed(2)) : null,
            avgMinutes3 != null ? parseFloat(avgMinutes3.toFixed(2)) : null,
            avgMinutes6 != null ? parseFloat(avgMinutes6.toFixed(2)) : null,
            player.id,
          ]
        );

        done++;
      } catch (err) {
        console.warn(`[FPL] History sync failed for player ${player.id}: ${err.message}`);
      }
    }));

    console.log(`[FPL] Player history sync progress: ${Math.min(i + batchSize, tracked.length)}/${tracked.length}`);
    await sleep(260);
  }

  console.log(`[FPL] Player history synced for ${done}/${tracked.length} players (${rowsUpserted} rows upserted)`);
}

function getHistoryFeatures(rows) {
  if (!rows.length) {
    return {
      sample: 0,
      avgPoints3: 0,
      avgPoints6: 0,
      seasonAvgPoints: 0,
      minutesRatio: 0.7,
      seasonMinutesRatio: 0.7,
      goals90: null,
      assists90: null,
      xg90: null,
      xa90: null,
      csRate: null,
      scoreRate3: null,
      scoreRate6: null,
      seasonScoreRate: null,
      goalsLast3: 0,
      goalsLast6: 0,
      blankStreak: 0,
      lastMatchScored: false,
      trend: 0,
      volatility: 1.8,
    };
  }

  const season = rows.slice(0, Math.max(HISTORY_WINDOW, 10));
  const recent = season.slice(0, 6);
  const recent3 = recent.slice(0, 3);
  const seasonPoints = season.map(r => toNum(r.total_points, 0));
  const seasonMinutes = season.map(r => toNum(r.minutes, 0));
  const seasonScoreFlags = season.map(r => (toNum(r.goals_scored, 0) > 0 ? 1 : 0));
  const seasonAvgPoints = seasonPoints.length ? mean(seasonPoints) : 0;
  const seasonMinutesRatio = seasonMinutes.length ? clamp(mean(seasonMinutes) / 90, 0, 1) : 0.7;
  const points = recent.map(r => toNum(r.total_points, 0));
  const minutes = recent.map(r => toNum(r.minutes, 0));
  const totalMinutes = minutes.reduce((s, m) => s + m, 0);
  const totalGoals = recent.reduce((s, r) => s + toNum(r.goals_scored, 0), 0);
  const totalGoals3 = recent3.reduce((s, r) => s + toNum(r.goals_scored, 0), 0);
  const totalAssists = recent.reduce((s, r) => s + toNum(r.assists, 0), 0);
  const totalXg = recent.reduce((s, r) => s + toNum(r.expected_goals, 0), 0);
  const totalXa = recent.reduce((s, r) => s + toNum(r.expected_assists, 0), 0);
  const cleanSheets = recent.filter(r => toNum(r.clean_sheets, 0) > 0).length;
  const scoreFlags6 = recent.map(r => (toNum(r.goals_scored, 0) > 0 ? 1 : 0));
  const scoreFlags3 = recent3.map(r => (toNum(r.goals_scored, 0) > 0 ? 1 : 0));
  let blankStreak = 0;
  for (const r of recent) {
    if (toNum(r.goals_scored, 0) > 0) break;
    blankStreak++;
  }

  const avgPoints6 = points.length ? mean(points) : seasonAvgPoints;
  const avgPoints3 = mean(recent3.map(r => toNum(r.total_points, 0)));
  const recentBias = avgPoints3 - seasonAvgPoints;

  return {
    sample: season.length,
    avgPoints3,
    avgPoints6,
    seasonAvgPoints,
    minutesRatio: clamp(mean(minutes) / 90, 0, 1),
    seasonMinutesRatio,
    goals90: totalMinutes > 0 ? (totalGoals / totalMinutes) * 90 : null,
    assists90: totalMinutes > 0 ? (totalAssists / totalMinutes) * 90 : null,
    xg90: totalMinutes > 0 ? (totalXg / totalMinutes) * 90 : null,
    xa90: totalMinutes > 0 ? (totalXa / totalMinutes) * 90 : null,
    csRate: recent.length > 0 ? cleanSheets / recent.length : null,
    scoreRate3: scoreFlags3.length ? mean(scoreFlags3) : null,
    scoreRate6: scoreFlags6.length ? mean(scoreFlags6) : null,
    seasonScoreRate: seasonScoreFlags.length ? mean(seasonScoreFlags) : null,
    goalsLast3: totalGoals3,
    goalsLast6: totalGoals,
    blankStreak,
    lastMatchScored: toNum(recent[0]?.goals_scored, 0) > 0,
    trend: (avgPoints3 - avgPoints6) * 0.7 + (recentBias * 0.3),
    volatility: stdDev(points) || 1.3,
  };
}

function getOpponentHistoryFeatures(rows, opponentTeamId, upcomingWasHome = null) {
  const empty = {
    sample: 0,
    venueSample: 0,
    avgPoints: null,
    minutesRatio: null,
    goals90: null,
    scoreRate: null,
    xg90: null,
    xa90: null,
    csRate: null,
    trend: null,
  };
  if (!opponentTeamId || !rows?.length) return empty;

  const weightedMean = (values, weights) => {
    if (!values.length || !weights.length) return null;
    let num = 0;
    let den = 0;
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      const weight = weights[i];
      if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
      num += value * weight;
      den += weight;
    }
    return den > 0 ? num / den : null;
  };

  const summarize = (matches) => {
    if (!matches.length) return null;
    const points = matches.map(r => toNum(r.total_points, 0));
    const minutes = matches.map(r => toNum(r.minutes, 0));
    const totalMinutes = minutes.reduce((s, m) => s + m, 0);
    const totalGoals = matches.reduce((s, r) => s + toNum(r.goals_scored, 0), 0);
    const totalXg = matches.reduce((s, r) => s + toNum(r.expected_goals, 0), 0);
    const totalXa = matches.reduce((s, r) => s + toNum(r.expected_assists, 0), 0);
    const scoreFlags = matches.map(r => (toNum(r.goals_scored, 0) > 0 ? 1 : 0));
    const csBinary = matches.map(r => (toNum(r.clean_sheets, 0) > 0 ? 1 : 0));
    const recencyWeights = matches.map((_, idx) => clamp(1 - (idx * 0.18), 0.30, 1));
    const avgPoints = weightedMean(points, recencyWeights);
    const avgMinutes = weightedMean(minutes, recencyWeights);
    const scoreRate = weightedMean(scoreFlags, recencyWeights);
    const csRate = weightedMean(csBinary, recencyWeights);
    const recent3 = points.slice(0, 3);
    const older = points.slice(3);
    const trend = older.length ? mean(recent3) - mean(older) : (recent3[0] ?? 0) - mean(recent3);
    return {
      sample: matches.length,
      avgPoints: avgPoints != null ? avgPoints : mean(points),
      minutesRatio: clamp(((avgMinutes != null ? avgMinutes : mean(minutes)) / 90), 0, 1),
      goals90: totalMinutes > 0 ? (totalGoals / totalMinutes) * 90 : null,
      scoreRate: scoreRate != null ? clamp(scoreRate, 0, 1) : null,
      xg90: totalMinutes > 0 ? (totalXg / totalMinutes) * 90 : null,
      xa90: totalMinutes > 0 ? (totalXa / totalMinutes) * 90 : null,
      csRate: csRate != null ? clamp(csRate, 0, 1) : null,
      trend: Number.isFinite(trend) ? trend : 0,
    };
  };

  const allMatches = rows
    .filter(r => toNum(r.opponent_team_id, 0) === toNum(opponentTeamId, 0))
    .slice(0, 6);
  if (!allMatches.length) return empty;

  const isHomeTarget = upcomingWasHome == null ? null : (upcomingWasHome ? 1 : 0);
  const venueMatches = isHomeTarget == null
    ? []
    : allMatches.filter(r => (toNum(r.was_home, 0) > 0 ? 1 : 0) === isHomeTarget).slice(0, 4);

  const allSummary = summarize(allMatches);
  const venueSummary = summarize(venueMatches);
  if (!allSummary) return empty;

  const venueWeightBase = venueSummary ? clamp(venueSummary.sample / 3, 0, 1) : 0;
  const venueWeight = venueWeightBase * 0.45;
  const allWeight = 1 - venueWeight;

  return {
    sample: allSummary.sample,
    venueSample: venueSummary?.sample || 0,
    avgPoints: weightedBlend(
      [
        { value: allSummary.avgPoints, weight: allWeight },
        { value: venueSummary?.avgPoints ?? null, weight: venueWeight },
      ],
      allSummary.avgPoints
    ),
    minutesRatio: weightedBlend(
      [
        { value: allSummary.minutesRatio, weight: allWeight },
        { value: venueSummary?.minutesRatio ?? null, weight: venueWeight },
      ],
      allSummary.minutesRatio
    ),
    goals90: weightedBlend(
      [
        { value: allSummary.goals90, weight: allWeight },
        { value: venueSummary?.goals90 ?? null, weight: venueWeight },
      ],
      allSummary.goals90
    ),
    scoreRate: weightedBlend(
      [
        { value: allSummary.scoreRate, weight: allWeight },
        { value: venueSummary?.scoreRate ?? null, weight: venueWeight },
      ],
      allSummary.scoreRate
    ),
    xg90: weightedBlend(
      [
        { value: allSummary.xg90, weight: allWeight },
        { value: venueSummary?.xg90 ?? null, weight: venueWeight },
      ],
      allSummary.xg90
    ),
    xa90: weightedBlend(
      [
        { value: allSummary.xa90, weight: allWeight },
        { value: venueSummary?.xa90 ?? null, weight: venueWeight },
      ],
      allSummary.xa90
    ),
    csRate: weightedBlend(
      [
        { value: allSummary.csRate, weight: allWeight },
        { value: venueSummary?.csRate ?? null, weight: venueWeight },
      ],
      allSummary.csRate
    ),
    trend: weightedBlend(
      [
        { value: allSummary.trend, weight: 0.68 },
        { value: venueSummary?.trend ?? null, weight: 0.32 * venueWeightBase },
      ],
      allSummary.trend
    ),
  };
}

async function buildFixtureGoalModels(fixtures = []) {
  const byTeamGw = {};
  if (!fixtures.length) return byTeamGw;

  const [historyRows] = await db.execute(
    `SELECT team_home_id, team_away_id, score_home, score_away
     FROM fixtures
     WHERE finished = 1
       AND score_home IS NOT NULL
       AND score_away IS NOT NULL
     ORDER BY gameweek DESC
     LIMIT 760`
  );

  const defaultLeagueHome = 1.45;
  const defaultLeagueAway = 1.22;
  const played = historyRows.filter(
    r => toNum(r.team_home_id, 0) > 0 && toNum(r.team_away_id, 0) > 0
  );

  const leagueHomeAvg = played.length
    ? mean(played.map(r => toNum(r.score_home, 0)))
    : defaultLeagueHome;
  const leagueAwayAvg = played.length
    ? mean(played.map(r => toNum(r.score_away, 0)))
    : defaultLeagueAway;
  const leagueOverallAvg = (leagueHomeAvg + leagueAwayAvg) / 2;

  const teamStats = {};
  const ensureTeam = (teamId) => {
    if (!teamStats[teamId]) {
      teamStats[teamId] = {
        homeFor: [],
        homeAgainst: [],
        awayFor: [],
        awayAgainst: [],
        allFor: [],
        allAgainst: [],
      };
    }
    return teamStats[teamId];
  };

  for (const row of played) {
    const homeId = toNum(row.team_home_id, 0);
    const awayId = toNum(row.team_away_id, 0);
    const homeGoals = toNum(row.score_home, 0);
    const awayGoals = toNum(row.score_away, 0);

    const homeStats = ensureTeam(homeId);
    const awayStats = ensureTeam(awayId);

    homeStats.homeFor.push(homeGoals);
    homeStats.homeAgainst.push(awayGoals);
    homeStats.allFor.push(homeGoals);
    homeStats.allAgainst.push(awayGoals);

    awayStats.awayFor.push(awayGoals);
    awayStats.awayAgainst.push(homeGoals);
    awayStats.allFor.push(awayGoals);
    awayStats.allAgainst.push(homeGoals);
  }

  const shrinkToOne = (value, sample, cap = 14) => {
    if (!Number.isFinite(value) || value <= 0) return 1;
    const w = clamp(sample / cap, 0, 1);
    return 1 + ((value - 1) * w);
  };

  const strengths = {};
  const defaultStrength = {
    homeAttack: 1,
    awayAttack: 1,
    homeDefenseWeak: 1,
    awayDefenseWeak: 1,
  };

  for (const [teamId, stats] of Object.entries(teamStats)) {
    const homeForAvg = stats.homeFor.length ? mean(stats.homeFor) : null;
    const homeAgainstAvg = stats.homeAgainst.length ? mean(stats.homeAgainst) : null;
    const awayForAvg = stats.awayFor.length ? mean(stats.awayFor) : null;
    const awayAgainstAvg = stats.awayAgainst.length ? mean(stats.awayAgainst) : null;
    const allForAvg = stats.allFor.length ? mean(stats.allFor) : leagueOverallAvg;
    const allAgainstAvg = stats.allAgainst.length ? mean(stats.allAgainst) : leagueOverallAvg;

    const homeAttackRaw = homeForAvg != null
      ? homeForAvg / Math.max(leagueHomeAvg, 0.35)
      : allForAvg / Math.max(leagueOverallAvg, 0.35);
    const awayAttackRaw = awayForAvg != null
      ? awayForAvg / Math.max(leagueAwayAvg, 0.35)
      : allForAvg / Math.max(leagueOverallAvg, 0.35);

    const homeDefWeakRaw = homeAgainstAvg != null
      ? homeAgainstAvg / Math.max(leagueAwayAvg, 0.35)
      : allAgainstAvg / Math.max(leagueOverallAvg, 0.35);
    const awayDefWeakRaw = awayAgainstAvg != null
      ? awayAgainstAvg / Math.max(leagueHomeAvg, 0.35)
      : allAgainstAvg / Math.max(leagueOverallAvg, 0.35);

    strengths[teamId] = {
      homeAttack: clamp(shrinkToOne(homeAttackRaw, stats.homeFor.length), 0.62, 1.55),
      awayAttack: clamp(shrinkToOne(awayAttackRaw, stats.awayFor.length), 0.62, 1.55),
      homeDefenseWeak: clamp(shrinkToOne(homeDefWeakRaw, stats.homeAgainst.length), 0.62, 1.60),
      awayDefenseWeak: clamp(shrinkToOne(awayDefWeakRaw, stats.awayAgainst.length), 0.62, 1.60),
    };
  }

  for (const fixture of fixtures) {
    const gw = toNum(fixture.event, 0);
    const homeId = toNum(fixture.team_h, 0);
    const awayId = toNum(fixture.team_a, 0);
    if (!gw || !homeId || !awayId) continue;

    const h = strengths[homeId] || defaultStrength;
    const a = strengths[awayId] || defaultStrength;
    const homeFdr = toNum(fixture.team_h_difficulty, 3);
    const awayFdr = toNum(fixture.team_a_difficulty, 3);

    const homeFdrAdj = clamp(1 + ((3 - homeFdr) * 0.12), 0.72, 1.32);
    const awayFdrAdj = clamp(1 + ((3 - awayFdr) * 0.12), 0.72, 1.32);

    const lambdaHome = clamp(
      leagueHomeAvg * h.homeAttack * a.awayDefenseWeak * homeFdrAdj,
      0.20,
      3.60
    );
    const lambdaAway = clamp(
      leagueAwayAvg * a.awayAttack * h.homeDefenseWeak * awayFdrAdj,
      0.20,
      3.30
    );

    const totalLambda = lambdaHome + lambdaAway;
    const rho = clamp(-0.08 + ((2.4 - totalLambda) * 0.035), -0.16, -0.02);

    const scoreMatrix = buildDixonColesScoreMatrix(lambdaHome, lambdaAway, rho, 7);
    const homeGoalDist = extractTeamGoalDistribution(scoreMatrix, 'home');
    const awayGoalDist = extractTeamGoalDistribution(scoreMatrix, 'away');

    if (!byTeamGw[homeId]) byTeamGw[homeId] = {};
    if (!byTeamGw[awayId]) byTeamGw[awayId] = {};
    if (!Array.isArray(byTeamGw[homeId][gw])) byTeamGw[homeId][gw] = [];
    if (!Array.isArray(byTeamGw[awayId][gw])) byTeamGw[awayId][gw] = [];

    byTeamGw[homeId][gw].push({
      fixtureId: toNum(fixture.id, 0),
      teamLambda: lambdaHome,
      oppLambda: lambdaAway,
      isHome: true,
      rho,
      teamGoalDist: homeGoalDist,
      oppGoalDist: awayGoalDist,
    });
    byTeamGw[awayId][gw].push({
      fixtureId: toNum(fixture.id, 0),
      teamLambda: lambdaAway,
      oppLambda: lambdaHome,
      isHome: false,
      rho,
      teamGoalDist: awayGoalDist,
      oppGoalDist: homeGoalDist,
    });
  }

  return byTeamGw;
}

// Main sync function - call this weekly
async function syncFPLData() {
  console.log('[FPL] Starting data sync...');
  await ensurePredictionModelColumns();

  const bootstrap = await fetchBootstrap();
  const fixtures = await fetchFixtures();

  const teams = bootstrap.teams;
  const elements = bootstrap.elements;
  const events = bootstrap.events;

  // Current and next gameweek
  const currentGW = events.find(e => e.is_current)?.id || 1;
  const nextGW = events.find(e => e.is_next)?.id || currentGW + 1;

  console.log(`[FPL] Current GW: ${currentGW}, Next GW: ${nextGW}`);

  // Upsert teams
  for (const team of teams) {
    await db.execute(
      `INSERT INTO teams (id, name, short_name) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), short_name=VALUES(short_name)`,
      [team.id, team.name, team.short_name]
    );
  }

  // Upsert all active FPL players
  const allPlayers = [...elements].sort((a, b) => b.total_points - a.total_points);

  for (const p of allPlayers) {
    await db.execute(
      `INSERT INTO players
         (id, name, team_id, position, price, total_points, form, minutes,
          goals_scored, assists, clean_sheets, selected_by_percent,
          status, chance_of_playing_next_round, chance_of_playing_this_round, news,
          penalties_order, direct_freekicks_order, corners_and_indirect_freekicks_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         price=VALUES(price), total_points=VALUES(total_points),
         form=VALUES(form), minutes=VALUES(minutes),
         goals_scored=VALUES(goals_scored), assists=VALUES(assists),
         clean_sheets=VALUES(clean_sheets),
         selected_by_percent=VALUES(selected_by_percent),
         status=VALUES(status),
         chance_of_playing_next_round=VALUES(chance_of_playing_next_round),
         chance_of_playing_this_round=VALUES(chance_of_playing_this_round),
         news=VALUES(news),
         penalties_order=VALUES(penalties_order),
         direct_freekicks_order=VALUES(direct_freekicks_order),
         corners_and_indirect_freekicks_order=VALUES(corners_and_indirect_freekicks_order)`,
      [
        p.id,
        `${p.first_name} ${p.second_name}`,
        p.team,
        p.element_type,
        p.now_cost / 10,
        p.total_points,
        toNum(p.form, 0),
        toNum(p.minutes, 0),
        toNum(p.goals_scored, 0),
        toNum(p.assists, 0),
        toNum(p.clean_sheets, 0),
        toNum(p.selected_by_pct, 0),
        p.status || 'a',
        p.chance_of_playing_next_round != null ? toNum(p.chance_of_playing_next_round, 100) : null,
        p.chance_of_playing_this_round != null ? toNum(p.chance_of_playing_this_round, 100) : null,
        p.news || null,
        p.penalties_order != null ? toNum(p.penalties_order, 0) : null,
        p.direct_freekicks_order != null ? toNum(p.direct_freekicks_order, 0) : null,
        p.corners_and_indirect_freekicks_order != null ? toNum(p.corners_and_indirect_freekicks_order, 0) : null,
      ]
    );
  }

  // Upsert fixtures: currentGW through currentGW+4 (includes current GW scores)
  const relevantFixtures = fixtures.filter(
    f => toNum(f.event, 0) >= currentGW && toNum(f.event, 0) <= currentGW + 4
  );

  for (const f of relevantFixtures) {
    await db.execute(
      `INSERT INTO fixtures
         (id, gameweek, team_home_id, team_away_id,
          difficulty_home, difficulty_away,
          kickoff_time, finished, score_home, score_away)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         difficulty_home=VALUES(difficulty_home),
         difficulty_away=VALUES(difficulty_away),
         kickoff_time=VALUES(kickoff_time),
         finished=VALUES(finished),
         score_home=VALUES(score_home),
         score_away=VALUES(score_away)`,
      [
        toNum(f.id, 0),
        toNum(f.event, 0),
        toNum(f.team_h, 0),
        toNum(f.team_a, 0),
        toNum(f.team_h_difficulty, 3),
        toNum(f.team_a_difficulty, 3),
        f.kickoff_time ? new Date(f.kickoff_time) : null,
        f.finished ? 1 : 0,
        toNullableNum(f.team_h_score),
        toNullableNum(f.team_a_score),
      ]
    );
  }

  console.log('[FPL] Syncing player gameweek history...');
  await syncPlayerGameweekHistory(allPlayers, currentGW);

  console.log('[FPL] Fetching FotMob xG/xA and form context...');
  await syncFotMobData();

  console.log('[FPL] Running enhanced prediction engine...');
  await runPredictionEngine(nextGW, allPlayers, relevantFixtures);
  console.log('[FPL] Predictions updated.');
}

// Enhanced prediction engine
async function runPredictionEngine(nextGW, players, fixtures) {
  const pointsPerGoal = { 1: 6, 2: 6, 3: 5, 4: 4 };
  const pointsPerCS = { 1: 4, 2: 4, 3: 1, 4: 0 };
  const pointsPerAssist = 3;
  const fixtureGoalModels = await buildFixtureGoalModels(fixtures);

  // Build fixture lookup per team per GW as arrays to support DGW.
  const teamFixturesByGw = {};
  for (const f of fixtures) {
    const gw = toNum(f.event, 0);
    if (!gw) continue;
    const homeTeamId = toNum(f.team_h, 0);
    const awayTeamId = toNum(f.team_a, 0);
    const fixtureId = toNum(f.id, 0);
    if (!homeTeamId || !awayTeamId) continue;

    if (!teamFixturesByGw[homeTeamId]) teamFixturesByGw[homeTeamId] = {};
    if (!teamFixturesByGw[awayTeamId]) teamFixturesByGw[awayTeamId] = {};
    if (!Array.isArray(teamFixturesByGw[homeTeamId][gw])) teamFixturesByGw[homeTeamId][gw] = [];
    if (!Array.isArray(teamFixturesByGw[awayTeamId][gw])) teamFixturesByGw[awayTeamId][gw] = [];

    teamFixturesByGw[homeTeamId][gw].push({
      fixtureId,
      fdr: toNum(f.team_h_difficulty, 3),
      opponentTeamId: awayTeamId,
      wasHome: true,
    });
    teamFixturesByGw[awayTeamId][gw].push({
      fixtureId,
      fdr: toNum(f.team_a_difficulty, 3),
      opponentTeamId: homeTeamId,
      wasHome: false,
    });
  }

  const playerIds = players.map(p => p.id);
  if (!playerIds.length) return;
  const idPlaceholders = playerIds.map(() => '?').join(', ');

  // Profile map from DB (includes synced FotMob values)
  const [profileRows] = await db.execute(
    `SELECT
       p.id, p.position, p.form, p.minutes, p.goals_scored, p.assists, p.clean_sheets,
       p.status, p.chance_of_playing_next_round, p.chance_of_playing_this_round,
       p.penalties_order, p.direct_freekicks_order, p.corners_and_indirect_freekicks_order,
       p.last_gw_points, p.last_gw_minutes,
       p.avg_points_last3, p.avg_points_last6, p.avg_minutes_last3, p.avg_minutes_last6,
       p.xg, p.xa, fd.season_rating, fd.xgot_total, fd.matches_played, fd.recent_matches
     FROM players p
     LEFT JOIN player_fotmob_data fd ON p.id = fd.player_id
     WHERE p.id IN (${idPlaceholders})`,
    playerIds
  );
  const profileMap = {};
  for (const row of profileRows) {
    profileMap[row.id] = {
      position: toNum(row.position, 0),
      form: toNum(row.form, 0),
      minutes: toNum(row.minutes, 0),
      goalsScored: toNum(row.goals_scored, 0),
      assists: toNum(row.assists, 0),
      cleanSheets: toNum(row.clean_sheets, 0),
      status: row.status || 'a',
      chanceNext: row.chance_of_playing_next_round != null ? toNum(row.chance_of_playing_next_round, 100) : null,
      chanceThis: row.chance_of_playing_this_round != null ? toNum(row.chance_of_playing_this_round, 100) : null,
      penaltiesOrder: row.penalties_order != null ? toNum(row.penalties_order, 0) : null,
      directFreekicksOrder: row.direct_freekicks_order != null ? toNum(row.direct_freekicks_order, 0) : null,
      cornersOrder: row.corners_and_indirect_freekicks_order != null ? toNum(row.corners_and_indirect_freekicks_order, 0) : null,
      lastGwPoints: row.last_gw_points != null ? toNum(row.last_gw_points, 0) : null,
      lastGwMinutes: row.last_gw_minutes != null ? toNum(row.last_gw_minutes, 0) : null,
      avgPoints3: row.avg_points_last3 != null ? toNum(row.avg_points_last3, 0) : null,
      avgPoints6: row.avg_points_last6 != null ? toNum(row.avg_points_last6, 0) : null,
      avgMinutes3: row.avg_minutes_last3 != null ? toNum(row.avg_minutes_last3, 0) : null,
      avgMinutes6: row.avg_minutes_last6 != null ? toNum(row.avg_minutes_last6, 0) : null,
      xg: row.xg != null ? toNum(row.xg, 0) : null,
      xa: row.xa != null ? toNum(row.xa, 0) : null,
      seasonRating: row.season_rating != null ? toNum(row.season_rating, 0) : null,
      xgotTotal: row.xgot_total != null ? toNum(row.xgot_total, 0) : null,
      fotmobMatches: row.matches_played != null ? toNum(row.matches_played, 0) : 0,
      recentMatches: parseMaybeJson(row.recent_matches, []),
    };
  }

  // FPL past GW history map
  const [historyRows] = await db.execute(
    `SELECT
       player_id, gameweek, opponent_team_id, was_home, total_points, minutes,
       goals_scored, assists, clean_sheets,
       expected_goals, expected_assists
     FROM player_gameweek_history
     WHERE player_id IN (${idPlaceholders})
     ORDER BY player_id ASC, gameweek DESC`,
    playerIds
  );

  const historyByPlayer = {};
  for (const row of historyRows) {
    if (!historyByPlayer[row.player_id]) historyByPlayer[row.player_id] = [];
    historyByPlayer[row.player_id].push(row);
  }

  const historyFeaturesByPlayer = {};
  for (const playerId of playerIds) {
    historyFeaturesByPlayer[playerId] = getHistoryFeatures(historyByPlayer[playerId] || []);
  }

  for (const p of players) {
    const teamFixtures = teamFixturesByGw[p.team] || {};
    const profile = profileMap[p.id] || {};
    const playerHistoryRows = historyByPlayer[p.id] || [];
    const history = historyFeaturesByPlayer[p.id] || getHistoryFeatures([]);
    const fotmobRecent = getFotmobRecentFeatures(profile.recentMatches);
    const setPiece = getSetPieceBonuses(profile);
    const availabilityMult = getAvailabilityMultiplier(
      profile.status,
      profile.chanceNext,
      profile.chanceThis
    );
    const hasFotmobSignal =
      profile.xg != null ||
      profile.xa != null ||
      profile.seasonRating != null ||
      fotmobRecent.xg90 != null ||
      fotmobRecent.xa90 != null ||
      fotmobRecent.xgot90 != null ||
      fotmobRecent.shots90 != null ||
      fotmobRecent.sot90 != null ||
      fotmobRecent.avgRating != null;
    const historySample = history.sample || 0;

    const pos = p.element_type;
    const formScore = profile.form ?? toNum(p.form, 0);

    const seasonMinutes = profile.minutes ?? toNum(p.minutes, 0);
    const seasonGoals = profile.goalsScored ?? toNum(p.goals_scored, 0);
    const seasonAssists = profile.assists ?? toNum(p.assists, 0);
    const seasonCleanSheets = profile.cleanSheets ?? toNum(p.clean_sheets, 0);
    const seasonXgotPerMatch = profile.xgotTotal != null && profile.fotmobMatches > 0
      ? (profile.xgotTotal / profile.fotmobMatches)
      : null;
    const seasonGoal90 = seasonMinutes > 0 ? (seasonGoals / seasonMinutes) * 90 : 0;
    const seasonAssist90 = seasonMinutes > 0 ? (seasonAssists / seasonMinutes) * 90 : 0;
    const seasonCSRate = seasonMinutes > 0 ? clamp(seasonCleanSheets / (seasonMinutes / 90), 0, 1) : 0.2;

    const avgPoints3Signal = historySample > 0
      ? history.avgPoints3
      : (profile.avgPoints3 ?? profile.lastGwPoints ?? 0);
    const avgPoints6Signal = historySample > 0
      ? history.avgPoints6
      : (profile.avgPoints6 ?? avgPoints3Signal);
    const seasonPointsSignal = historySample > 0
      ? history.seasonAvgPoints
      : (profile.avgPoints6 ?? avgPoints6Signal);
    const rawRecentMinutes = historySample > 0
      ? (history.minutesRatio * 90)
      : (profile.avgMinutes6 ?? profile.avgMinutes3 ?? profile.lastGwMinutes ?? null);
    const minutesRatioSignal = rawRecentMinutes != null
      ? clamp(rawRecentMinutes / 90, 0, 1)
      : null;
    const trendSignal = historySample > 0
      ? history.trend
      : (avgPoints3Signal - avgPoints6Signal);
    const volatilitySignal = historySample > 0 ? history.volatility : 1.6;

    // Use actual GW appearance count from history so low-minute players are not
    // treated like regular starters.
    const totalApproxGames = playerHistoryRows.length || Math.max(Math.floor(seasonMinutes / 30), 1);
    const seasonMinsRatio = clamp(seasonMinutes / (totalApproxGames * 90), 0.05, 1);
    const minsProbBase = minutesRatioSignal != null
      ? clamp((minutesRatioSignal * 0.75) + (seasonMinsRatio * 0.25), 0.05, 1)
      : seasonMinsRatio;
    const minutesProfile = buildMinutesRotationProfile({
      fplHistoryRows: playerHistoryRows,
      fotmobMatches: profile.recentMatches,
      fallbackMinsProb: minsProbBase,
      availability: 1,
    });
    const rotationRiskSeason = toNum(minutesProfile.rotationRisk, 45);
    const minsProbFinalCheckBase = clamp(
      weightedBlend(
        [
          { value: minsProbBase, weight: 0.38 },
          { value: minutesProfile.baseMinsProb, weight: 0.22 },
          { value: minutesProfile.minsProb, weight: 0.40 },
        ],
        minsProbBase
      ),
      0.03,
      1
    );

    // Weight FotMob season xG/xA by minute evidence and normalize to per-90.
    const fotmobMinutesWeight = minutesProfile.avgMinutesCombined > 0
      ? clamp(minutesProfile.avgMinutesCombined / 60, 0, 1)
      : 0;
    const fotmobScaleMinutes = minutesProfile.avgFotmobMinutes
      ?? minutesProfile.avgFplMinutesRecent
      ?? minutesProfile.avgFplMinutes
      ?? null;
    const fotmobPerGameToPer90 = fotmobScaleMinutes != null && fotmobScaleMinutes > 0
      ? clamp(90 / fotmobScaleMinutes, 0.8, 3.0)
      : 1.20;

    // Hard gate for unavailable/no-minute players.
    const chanceNow = profile.chanceNext ?? profile.chanceThis;
    if (minutesProfile.zeroed === true || chanceNow === 0) {
      for (let gw = nextGW; gw <= nextGW + 2; gw++) {
        const gwFixtures = Array.isArray(teamFixtures[gw]) ? teamFixtures[gw] : [];
        const gwFdr = gwFixtures.length
          ? Math.round(mean(gwFixtures.map(fx => toNum(fx.fdr, 3))))
          : 5;
        await db.execute(
          `INSERT INTO predictions
             (player_id, gameweek, xpts, likely_pts, min_pts, max_pts,
              xg_prob, xa_prob, cs_prob, mins_prob, avg_bonus, fdr)
           VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?)
           ON DUPLICATE KEY UPDATE
             xpts=0, likely_pts=0, min_pts=0, max_pts=0,
             xg_prob=0, xa_prob=0, cs_prob=0, mins_prob=0,
             avg_bonus=0, fdr=VALUES(fdr)`,
          [p.id, gw, gwFdr]
        );
      }
      continue;
    }

    for (let gw = nextGW; gw <= nextGW + 2; gw++) {
      const gwFixtures = Array.isArray(teamFixtures[gw]) ? teamFixtures[gw] : [];
      if (!gwFixtures.length) {
        await db.execute(
          `INSERT INTO predictions
             (player_id, gameweek, xpts, likely_pts, min_pts, max_pts,
              xg_prob, xa_prob, cs_prob, mins_prob, avg_bonus, fdr)
           VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5)
           ON DUPLICATE KEY UPDATE
             xpts=0, likely_pts=0, min_pts=0, max_pts=0,
             xg_prob=0, xa_prob=0, cs_prob=0, mins_prob=0,
             avg_bonus=0, fdr=5`,
          [p.id, gw]
        );
        continue;
      }

      const fixtureModels = fixtureGoalModels[p.team]?.[gw] || [];
      const gwCount = gwFixtures.length;
      const gwFdr = Math.round(mean(gwFixtures.map(fx => toNum(fx.fdr, 3))));

      let totalXPts = 0;
      let minsNoProb = 1;
      let goalNoProb = 1;
      let assistNoProb = 1;
      let csNoProb = 1;
      let bonusSum = 0;

      for (let fixtureIdx = 0; fixtureIdx < gwFixtures.length; fixtureIdx++) {
        const gwFixture = gwFixtures[fixtureIdx];
        const fdr = toNum(gwFixture.fdr, 3);
        const opponentTeamId = gwFixture.opponentTeamId ?? null;
        const upcomingWasHome = gwFixture.wasHome ?? null;
        const fixtureModel = fixtureModels.find(
          m => toNum(m.fixtureId, 0) === toNum(gwFixture.fixtureId, 0)
        ) || null;
        const vsOpponent = getOpponentHistoryFeatures(playerHistoryRows, opponentTeamId, upcomingWasHome);
        const vsOppWeight = clamp((vsOpponent.sample / 4) * 0.22 + (vsOpponent.venueSample / 2) * 0.10, 0, 0.32);

        const attackMult = fdr <= 2 ? 1.2 : fdr === 3 ? 1.0 : fdr === 4 ? 0.86 : 0.72;
        const opponentFormAdj = vsOpponent.avgPoints != null
          ? clamp(1 + ((vsOpponent.avgPoints - avgPoints6Signal) * 0.012), 0.90, 1.12)
          : 1;
        const attackMultAdj = attackMult * opponentFormAdj;
        const csFixtureProb = fdr <= 2 ? 0.58 : fdr === 3 ? 0.40 : fdr === 4 ? 0.25 : 0.14;

        const minsBaseAdj = vsOpponent.minutesRatio != null
          ? weightedBlend(
              [
                { value: minsProbFinalCheckBase, weight: 0.82 },
                { value: vsOpponent.minutesRatio, weight: 0.18 },
              ],
              minsProbFinalCheckBase
            )
          : minsProbFinalCheckBase;
        const minsRiskGuard = clamp(1 - (rotationRiskSeason * 0.0012), 0.84, 1);
        const extraFixturePenalty = gwCount > 1
          ? clamp(1 - (fixtureIdx * (0.10 + (rotationRiskSeason * 0.0007))), 0.72, 1)
          : 1;
        const minsProb = clamp(minsBaseAdj * minsRiskGuard * availabilityMult * extraFixturePenalty, 0.02, 1);

        const xgSeasonPer90 = profile.xg != null ? profile.xg * fotmobPerGameToPer90 : null;
        const xaSeasonPer90 = profile.xa != null ? profile.xa * fotmobPerGameToPer90 : null;
        const xgSeasonWeighted = xgSeasonPer90 != null ? xgSeasonPer90 * fotmobMinutesWeight : null;
        const xaSeasonWeighted = xaSeasonPer90 != null ? xaSeasonPer90 * fotmobMinutesWeight : null;

        const xgPer90 = weightedBlend(
          [
            { value: history.xg90, weight: 0.29 },
            { value: history.goals90, weight: 0.14 },
            { value: xgSeasonWeighted, weight: 0.22 },
            { value: fotmobRecent.xg90, weight: 0.16 },
            { value: fotmobRecent.xgot90, weight: 0.10 },
            { value: seasonGoal90, weight: 0.07 },
            { value: seasonXgotPerMatch, weight: 0.04 },
            { value: vsOpponent.xg90, weight: vsOppWeight },
            { value: vsOpponent.goals90, weight: vsOppWeight * 0.8 },
          ],
          xgSeasonWeighted ?? seasonGoal90
        );
        const xaPer90 = weightedBlend(
          [
            { value: history.xa90, weight: 0.34 },
            { value: xaSeasonWeighted, weight: 0.28 },
            { value: fotmobRecent.xa90, weight: 0.20 },
            { value: seasonAssist90, weight: 0.10 },
            { value: vsOpponent.xa90, weight: vsOppWeight },
          ],
          xaSeasonWeighted ?? seasonAssist90
        );

        const syntheticHistorySample = historySample > 0
          ? historySample
          : (profile.avgPoints6 != null ? 6 : profile.avgPoints3 != null ? 3 : profile.lastGwPoints != null ? 1 : 0);
        const opponentEvidence = clamp(vsOpponent.sample / 3, 0, 1);
        const historyCoverage = clamp(syntheticHistorySample / 6, 0, 1);
        const evidenceMult = clamp(
          0.60 + (historyCoverage * 0.25) + (hasFotmobSignal ? 0.10 : 0) + (opponentEvidence * 0.05),
          0.55,
          1
        );
        const coldStartMult = (!hasFotmobSignal && syntheticHistorySample < 3) ? 0.74 : 1;
        const subDiscountMult = clamp(0.40 + (minutesProfile.startRate * 0.60), 0.35, 1.0);
        const xgPer90Adj = xgPer90 * evidenceMult * coldStartMult * subDiscountMult;
        const xaPer90Adj = xaPer90 * evidenceMult * coldStartMult * subDiscountMult;
        const goalRateFallback = pos === 4 ? 0.34 : pos === 3 ? 0.23 : pos === 2 ? 0.08 : 0.03;
        const recentScoreRate = weightedBlend(
          [
            { value: history.scoreRate3, weight: 0.56 },
            { value: history.scoreRate6, weight: 0.30 },
            { value: history.seasonScoreRate, weight: 0.14 },
            { value: fotmobRecent.scoreRate, weight: 0.14 },
          ],
          goalRateFallback
        );
        const scoringFormBoost = clamp((recentScoreRate - goalRateFallback) * 0.32, -0.08, 0.14);
        const opponentGoalBoostMult = vsOpponent.scoreRate != null
          ? clamp((vsOpponent.scoreRate - recentScoreRate) * 0.24, -0.08, 0.10)
          : 0;
        const blankRunPenalty = history.blankStreak > 2
          ? clamp((history.blankStreak - 2) * 0.035, 0, 0.16)
          : 0;
        const lastMatchScoredBoost = history.lastMatchScored ? 0.025 : -0.005;
        const shotPressure = weightedBlend(
          [
            { value: fotmobRecent.shots90, weight: 0.50 },
            { value: fotmobRecent.sot90 != null ? fotmobRecent.sot90 * 1.9 : null, weight: 0.50 },
          ],
          null
        );
        const shotPressureBoost = shotPressure != null
          ? clamp((shotPressure - 1.4) * 0.07, -0.06, 0.14)
          : 0;
        const xgotBoost = fotmobRecent.xgot90 != null
          ? clamp((fotmobRecent.xgot90 - 0.16) * 0.16, -0.04, 0.10)
          : 0;
        const goalSignalMult = clamp(
          1 + scoringFormBoost + opponentGoalBoostMult + lastMatchScoredBoost + shotPressureBoost + xgotBoost - blankRunPenalty,
          0.75,
          1.35
        );

        const setPiecePosMult = pos === 4 ? 1 : pos === 3 ? 0.8 : pos === 2 ? 0.28 : 0.12;
        const setPieceEvidenceMult = hasFotmobSignal || syntheticHistorySample >= 3 ? 1 : 0.45;
        const setPieceMult = setPiecePosMult * setPieceEvidenceMult;
        const setPieceGoalAdd = (setPiece.penaltyGoalBoost + setPiece.freeKickGoalBoost) * minsProb * setPieceMult;
        const setPieceAssistAdd = (setPiece.cornerAssistBoost + setPiece.directFkAssistBoost) * minsProb * setPieceMult;

        const lambdaGoal = (Math.max(xgPer90Adj, 0) * minsProb * attackMultAdj * goalSignalMult) + setPieceGoalAdd;
        const lambdaAssist = (Math.max(xaPer90Adj, 0) * minsProb * attackMultAdj * 0.95) + setPieceAssistAdd;
        const poissonGoalProb = clamp(1 - Math.exp(-lambdaGoal), 0, 0.97);
        let dixonColesGoalProb = poissonGoalProb;

        if (fixtureModel?.teamGoalDist?.length) {
          const teamLambda = Math.max(toNum(fixtureModel.teamLambda, 0), 0.15);
          const positionShareFloor = pos === 4 ? 0.03 : pos === 3 ? 0.02 : pos === 2 ? 0.008 : 0.004;
          const positionShareCap = pos === 4 ? 0.75 : pos === 3 ? 0.62 : pos === 2 ? 0.40 : 0.28;
          const rawShare = lambdaGoal / teamLambda;
          const playerShare = clamp(rawShare, positionShareFloor, positionShareCap);
          dixonColesGoalProb = playerGoalProbFromTeamDistribution(fixtureModel.teamGoalDist, playerShare);
        }

        const xGProb = clamp(
          weightedBlend(
            [
              { value: poissonGoalProb, weight: 0.45 },
              { value: dixonColesGoalProb, weight: 0.55 },
            ],
            poissonGoalProb
          ),
          0,
          0.97
        );
        const xAProb = clamp(1 - Math.exp(-lambdaAssist), 0, 0.90);

        let csProb = 0;
        if (pos === 4) {
          csProb = 0;
        } else if (pos === 3) {
          csProb = clamp(
            weightedBlend(
              [
                { value: csFixtureProb * 0.44, weight: 0.44 },
                { value: history.csRate, weight: 0.33 },
                { value: seasonCSRate, weight: 0.20 },
                { value: vsOpponent.csRate, weight: vsOppWeight },
              ],
              csFixtureProb * 0.40
            ),
            0.04,
            0.55
          );
        } else {
          csProb = clamp(
            weightedBlend(
              [
                { value: csFixtureProb, weight: 0.58 },
                { value: history.csRate, weight: 0.23 },
                { value: seasonCSRate, weight: 0.15 },
                { value: vsOpponent.csRate, weight: vsOppWeight },
              ],
              csFixtureProb
            ),
            0.08,
            0.78
          );
        }
        csProb = clamp(csProb * availabilityMult, 0, 0.85);

        const blendedRating = weightedBlend(
          [
            { value: profile.seasonRating, weight: 0.65 },
            { value: fotmobRecent.avgRating, weight: 0.35 },
          ],
          profile.seasonRating ?? fotmobRecent.avgRating ?? 6.8
        );
        const ratingBoost = blendedRating != null
          ? clamp((blendedRating - 6.5) * 0.22, -0.18, 0.55)
          : 0;
        const formBoost = clamp((formScore / 10) * availabilityMult * 0.35, 0, 0.45);
        const trendVsSeason = avgPoints3Signal - seasonPointsSignal;
        const trendBoost = clamp((trendSignal * 0.12) + (trendVsSeason * 0.10), -0.16, 0.28);
        const recentPointsBase = weightedBlend(
          [
            { value: avgPoints3Signal, weight: 0.60 },
            { value: avgPoints6Signal, weight: 0.25 },
            { value: seasonPointsSignal, weight: 0.15 },
          ],
          avgPoints6Signal
        );
        const recentPointsBoost = clamp(recentPointsBase * 0.055, 0, 0.90);
        const opponentBoost = vsOpponent.avgPoints != null
          ? clamp(
              ((vsOpponent.avgPoints - avgPoints6Signal) * 0.06) +
              ((vsOpponent.trend ?? 0) * 0.04),
              -0.25,
              0.35
            )
          : 0;
        const injuryPenalty = availabilityMult < 0.7 ? (0.7 - availabilityMult) * 1.4 : 0;
        const uncertaintyPenalty = (1 - evidenceMult) * 0.45;
        const goalFormBonus = clamp(
          (scoringFormBoost + opponentGoalBoostMult + shotPressureBoost + xgotBoost - blankRunPenalty) * 0.9,
          -0.18,
          0.28
        );
        const setPieceBonus = clamp(
          (setPiece.penaltyGoalBoost * 0.75) +
          (setPiece.freeKickGoalBoost * 0.50) +
          (setPiece.cornerAssistBoost * 0.70) +
          (setPiece.directFkAssistBoost * 0.45),
          0,
          0.45
        );
        const bonusAvailabilityMult = clamp((minsProb * 0.72) + 0.20, 0.2, 0.92);
        const avgBonus = clamp(
          (
            0.12 +
            formBoost +
            ratingBoost +
            trendBoost +
            recentPointsBoost +
            opponentBoost +
            goalFormBonus +
            setPieceBonus -
            injuryPenalty -
            uncertaintyPenalty
          ) * bonusAvailabilityMult,
          0,
          1.85
        );

        const appearancePts = expectedAppearancePoints(
          minsProb,
          minutesProfile.startRate,
          minutesProfile.avgMinutesCombined
        );
        const goalPointsFromProb = xGProb * pointsPerGoal[pos];
        const assistPointsFromProb = xAProb * pointsPerAssist;
        const goalEventsExp = clamp(lambdaGoal, 0, pos === 4 ? 2.2 : pos === 3 ? 1.8 : pos === 2 ? 1.15 : 0.85);
        const assistEventsExp = clamp(lambdaAssist, 0, 1.35);
        const goalPointsFromEvents = goalEventsExp * pointsPerGoal[pos];
        const assistPointsFromEvents = assistEventsExp * pointsPerAssist;
        const goalPoints = weightedBlend(
          [
            { value: goalPointsFromProb, weight: 0.40 },
            { value: goalPointsFromEvents, weight: 0.60 },
          ],
          goalPointsFromProb
        );
        const assistPoints = weightedBlend(
          [
            { value: assistPointsFromProb, weight: 0.45 },
            { value: assistPointsFromEvents, weight: 0.55 },
          ],
          assistPointsFromProb
        );
        const concedePenalty = (pos === 1 || pos === 2)
          ? expectedConcedeDeduction(fixtureModel?.oppGoalDist || [], minsProb)
          : 0;
        const xPts =
          appearancePts +
          goalPoints +
          assistPoints +
          (csProb * pointsPerCS[pos]) +
          avgBonus -
          concedePenalty;

        totalXPts += xPts;
        minsNoProb *= (1 - minsProb);
        goalNoProb *= (1 - xGProb);
        assistNoProb *= (1 - xAProb);
        csNoProb *= (1 - csProb);
        bonusSum += avgBonus;
      }

      const xGProbGw = clamp(1 - goalNoProb, 0, 0.99);
      const xAProbGw = clamp(1 - assistNoProb, 0, 0.95);
      const csProbGw = clamp(1 - csNoProb, 0, 0.95);
      const minsProbGw = clamp(1 - minsNoProb, 0, 1);
      const avgBonusGw = gwCount > 0 ? (bonusSum / gwCount) : 0;

      const volatility = volatilitySignal ?? 1.8;
      const spread = (1.7 + (volatility * 0.75)) * Math.sqrt(gwCount);
      const likelyPts = Math.max(0, Math.round(totalXPts));
      const minPts = Math.max(0, Math.floor(totalXPts - spread));
      const maxPts = Math.round(totalXPts + spread + (1.3 * gwCount));

      await db.execute(
        `INSERT INTO predictions
           (player_id, gameweek, xpts, likely_pts, min_pts, max_pts,
            xg_prob, xa_prob, cs_prob, mins_prob, avg_bonus, fdr)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           xpts=VALUES(xpts), likely_pts=VALUES(likely_pts),
           min_pts=VALUES(min_pts), max_pts=VALUES(max_pts),
           xg_prob=VALUES(xg_prob), xa_prob=VALUES(xa_prob),
           cs_prob=VALUES(cs_prob), mins_prob=VALUES(mins_prob),
           avg_bonus=VALUES(avg_bonus), fdr=VALUES(fdr)`,
        [
          p.id,
          gw,
          parseFloat(totalXPts.toFixed(2)),
          likelyPts,
          minPts,
          maxPts,
          parseFloat(xGProbGw.toFixed(3)),
          parseFloat(xAProbGw.toFixed(3)),
          parseFloat(csProbGw.toFixed(3)),
          parseFloat(minsProbGw.toFixed(3)),
          parseFloat(avgBonusGw.toFixed(2)),
          gwFdr,
        ]
      );
    }
  }
}

module.exports = { syncFPLData, syncAvailabilityData, fetchPlayerHistory };
