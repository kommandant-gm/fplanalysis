const axios = require('axios');
const db = require('../config/db');
const { syncFotMobData } = require('./fotmobScraper');

const FPL_BASE = 'https://fantasy.premierleague.com/api';
const HISTORY_PLAYER_LIMIT = 200;
const HISTORY_WINDOW = 8;

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
  const dbName = process.env.DB_NAME || 'fpl_analysis';
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
  const tracked = players.slice(0, HISTORY_PLAYER_LIMIT);
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
      minutesRatio: 0.7,
      goals90: null,
      assists90: null,
      xg90: null,
      xa90: null,
      csRate: null,
      scoreRate3: null,
      scoreRate6: null,
      goalsLast3: 0,
      goalsLast6: 0,
      blankStreak: 0,
      lastMatchScored: false,
      trend: 0,
      volatility: 1.8,
    };
  }

  const recent = rows.slice(0, 6);
  const recent3 = recent.slice(0, 3);
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

  const avgPoints6 = mean(points);
  const avgPoints3 = mean(recent3.map(r => toNum(r.total_points, 0)));

  return {
    sample: recent.length,
    avgPoints3,
    avgPoints6,
    minutesRatio: clamp(mean(minutes) / 90, 0.2, 1),
    goals90: totalMinutes > 0 ? (totalGoals / totalMinutes) * 90 : null,
    assists90: totalMinutes > 0 ? (totalAssists / totalMinutes) * 90 : null,
    xg90: totalMinutes > 0 ? (totalXg / totalMinutes) * 90 : null,
    xa90: totalMinutes > 0 ? (totalXa / totalMinutes) * 90 : null,
    csRate: recent.length > 0 ? cleanSheets / recent.length : null,
    scoreRate3: scoreFlags3.length ? mean(scoreFlags3) : null,
    scoreRate6: scoreFlags6.length ? mean(scoreFlags6) : null,
    goalsLast3: totalGoals3,
    goalsLast6: totalGoals,
    blankStreak,
    lastMatchScored: toNum(recent[0]?.goals_scored, 0) > 0,
    trend: avgPoints3 - avgPoints6,
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
      minutesRatio: clamp(((avgMinutes != null ? avgMinutes : mean(minutes)) / 90), 0.2, 1),
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

  // Upsert players (top 200 by total points for performance)
  const topPlayers = elements
    .sort((a, b) => b.total_points - a.total_points)
    .slice(0, 200);

  for (const p of topPlayers) {
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
  await syncPlayerGameweekHistory(topPlayers, currentGW);

  console.log('[FPL] Fetching FotMob xG/xA and form context...');
  await syncFotMobData();

  console.log('[FPL] Running enhanced prediction engine...');
  await runPredictionEngine(nextGW, topPlayers, relevantFixtures);
  console.log('[FPL] Predictions updated.');
}

// Enhanced prediction engine
async function runPredictionEngine(nextGW, players, fixtures) {
  const pointsPerGoal = { 1: 6, 2: 6, 3: 5, 4: 4 };
  const pointsPerCS = { 1: 4, 2: 4, 3: 1, 4: 0 };
  const pointsPerAssist = 3;

  // Build fixture difficulty lookup per team per GW
  const fdrMap = {};
  const opponentMap = {};
  const venueMap = {};
  for (const f of fixtures) {
    if (!fdrMap[f.team_h]) fdrMap[f.team_h] = {};
    if (!fdrMap[f.team_a]) fdrMap[f.team_a] = {};
    if (!opponentMap[f.team_h]) opponentMap[f.team_h] = {};
    if (!opponentMap[f.team_a]) opponentMap[f.team_a] = {};
    if (!venueMap[f.team_h]) venueMap[f.team_h] = {};
    if (!venueMap[f.team_a]) venueMap[f.team_a] = {};
    fdrMap[f.team_h][f.event] = toNum(f.team_h_difficulty, 3);
    fdrMap[f.team_a][f.event] = toNum(f.team_a_difficulty, 3);
    opponentMap[f.team_h][f.event] = toNum(f.team_a, 0);
    opponentMap[f.team_a][f.event] = toNum(f.team_h, 0);
    venueMap[f.team_h][f.event] = true;
    venueMap[f.team_a][f.event] = false;
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
    const teamFixtures = fdrMap[p.team] || {};
    const teamOpponents = opponentMap[p.team] || {};
    const teamVenue = venueMap[p.team] || {};
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
    const rawRecentMinutes = historySample > 0
      ? (history.minutesRatio * 90)
      : (profile.avgMinutes6 ?? profile.avgMinutes3 ?? profile.lastGwMinutes ?? null);
    const minutesRatioSignal = rawRecentMinutes != null
      ? clamp(rawRecentMinutes / 90, 0.2, 1)
      : null;
    const trendSignal = historySample > 0
      ? history.trend
      : (avgPoints3Signal - avgPoints6Signal);
    const volatilitySignal = historySample > 0 ? history.volatility : 1.6;

    const seasonStartsApprox = Math.max(seasonMinutes / 85, 1);
    const seasonMinsRatio = clamp(seasonMinutes / (seasonStartsApprox * 90), 0.35, 1);
    const minsProbBase = minutesRatioSignal != null
      ? clamp((minutesRatioSignal * 0.75) + (seasonMinsRatio * 0.25), 0.2, 1)
      : seasonMinsRatio;

    for (let gw = nextGW; gw <= nextGW + 2; gw++) {
      const fdr = teamFixtures[gw] ?? 3;
      const opponentTeamId = teamOpponents[gw] ?? null;
      const upcomingWasHome = teamVenue[gw] ?? null;
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
              { value: minsProbBase, weight: 0.82 },
              { value: vsOpponent.minutesRatio, weight: 0.18 },
            ],
            minsProbBase
          )
        : minsProbBase;
      const minsProb = clamp(minsBaseAdj * availabilityMult, 0.03, 1);
      const xgPer90 = weightedBlend(
        [
          { value: history.xg90, weight: 0.29 },
          { value: history.goals90, weight: 0.14 },
          { value: profile.xg, weight: 0.22 },
          { value: fotmobRecent.xg90, weight: 0.16 },
          { value: fotmobRecent.xgot90, weight: 0.10 },
          { value: seasonGoal90, weight: 0.07 },
          { value: seasonXgotPerMatch, weight: 0.04 },
          { value: vsOpponent.xg90, weight: vsOppWeight },
          { value: vsOpponent.goals90, weight: vsOppWeight * 0.8 },
        ],
        profile.xg ?? seasonGoal90
      );
      const xaPer90 = weightedBlend(
        [
          { value: history.xa90, weight: 0.34 },
          { value: profile.xa, weight: 0.28 },
          { value: fotmobRecent.xa90, weight: 0.20 },
          { value: seasonAssist90, weight: 0.10 },
          { value: vsOpponent.xa90, weight: vsOppWeight },
        ],
        profile.xa ?? seasonAssist90
      );

      // Confidence control: if history/FotMob are sparse, reduce optimistic open-play rates.
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
      const xgPer90Adj = xgPer90 * evidenceMult * coldStartMult;
      const xaPer90Adj = xaPer90 * evidenceMult * coldStartMult;
      const goalRateFallback = pos === 4 ? 0.34 : pos === 3 ? 0.23 : pos === 2 ? 0.08 : 0.03;
      const recentScoreRate = weightedBlend(
        [
          { value: history.scoreRate3, weight: 0.56 },
          { value: history.scoreRate6, weight: 0.30 },
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

      // Include set-piece role probabilities (penalty, direct FK, corners) on top of open-play rates.
      const setPiecePosMult = pos === 4 ? 1 : pos === 3 ? 0.8 : pos === 2 ? 0.28 : 0.12;
      const setPieceEvidenceMult = hasFotmobSignal || syntheticHistorySample >= 3 ? 1 : 0.45;
      const setPieceMult = setPiecePosMult * setPieceEvidenceMult;
      const setPieceGoalAdd = (setPiece.penaltyGoalBoost + setPiece.freeKickGoalBoost) * minsProb * setPieceMult;
      const setPieceAssistAdd = (setPiece.cornerAssistBoost + setPiece.directFkAssistBoost) * minsProb * setPieceMult;

      const lambdaGoal = (Math.max(xgPer90Adj, 0) * minsProb * attackMultAdj * goalSignalMult) + setPieceGoalAdd;
      const lambdaAssist = (Math.max(xaPer90Adj, 0) * minsProb * attackMultAdj * 0.95) + setPieceAssistAdd;
      const xGProb = clamp(1 - Math.exp(-lambdaGoal), 0, 0.97);
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
        ? clamp((blendedRating - 6.5) * 0.45, -0.30, 1.25)
        : 0;
      const formBoost = clamp((formScore / 10) * availabilityMult, 0, 1.2);
      const trendBoost = clamp(trendSignal / 3.5, -0.6, 0.8);
      const recentPointsBoost = clamp(avgPoints3Signal * 0.10, 0, 1.5);
      const opponentBoost = vsOpponent.avgPoints != null
        ? clamp(
            ((vsOpponent.avgPoints - avgPoints6Signal) * 0.14) +
            ((vsOpponent.trend ?? 0) * 0.08),
            -0.75,
            0.95
          )
        : 0;
      const injuryPenalty = availabilityMult < 0.7 ? (0.7 - availabilityMult) * 1.8 : 0;
      const uncertaintyPenalty = (1 - evidenceMult) * 1.3;
      const goalFormBonus = clamp(
        (scoringFormBoost + opponentGoalBoostMult + shotPressureBoost + xgotBoost - blankRunPenalty) * 2.2,
        -0.5,
        0.8
      );
      const setPieceBonus = clamp(
        (setPiece.penaltyGoalBoost * 2.3) +
        (setPiece.freeKickGoalBoost * 1.4) +
        (setPiece.cornerAssistBoost * 1.8) +
        (setPiece.directFkAssistBoost * 1.2),
        0,
        1.2
      );
      const avgBonus = clamp(
        0.3 + formBoost + ratingBoost + trendBoost + recentPointsBoost + opponentBoost + goalFormBonus + setPieceBonus - injuryPenalty - uncertaintyPenalty,
        0.05,
        3.5
      );

      const appearancePts = minsProb * 2;
      const xPts =
        appearancePts +
        (xGProb * pointsPerGoal[pos]) +
        (xAProb * pointsPerAssist) +
        (csProb * pointsPerCS[pos]) +
        avgBonus;

      const volatility = volatilitySignal ?? 1.8;
      const likelyPts = Math.max(0, Math.round(xPts));
      const spread = 1.7 + (volatility * 0.75);
      const minPts = Math.max(0, Math.floor(xPts - spread));
      const maxPts = Math.round(xPts + spread + 1.3);

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
          parseFloat(xPts.toFixed(2)),
          likelyPts,
          minPts,
          maxPts,
          parseFloat(xGProb.toFixed(3)),
          parseFloat(xAProb.toFixed(3)),
          parseFloat(csProb.toFixed(3)),
          parseFloat(minsProb.toFixed(3)),
          parseFloat(avgBonus.toFixed(2)),
          fdr,
        ]
      );
    }
  }
}

module.exports = { syncFPLData, fetchPlayerHistory };
