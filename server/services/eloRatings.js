/**
 * Elo Rating System for Premier League Teams
 *
 * Computes rolling Elo ratings from player_gameweek_history match results.
 * Uses this as a better team-strength signal than FDR in predictions.
 *
 * Formula:
 *   E(A) = 1 / (1 + 10^((eloB - eloA) / 400))
 *   new_elo = old_elo + K * margin_mult * (actual - expected)
 */

const db = require('../config/db');

const ELO_START     = 1000;
const K             = 40;     // sensitivity — how fast ratings move
const HOME_ADV      = 65;     // home advantage in Elo points (~58% win prob at equal strength)
const MARGIN_WEIGHT = 0.75;   // goal-margin multiplier weight (0 = ignore margin, 1 = full weight)

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function expectedScore(eloA, eloB) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

// Goal-margin multiplier — bigger wins move ratings more, but capped to avoid outliers
function marginMultiplier(goalDiff) {
  if (goalDiff === 0) return 1;
  return clamp(MARGIN_WEIGHT * Math.log(goalDiff + 1) + (1 - MARGIN_WEIGHT), 0.8, 1.8);
}

// ─── Core computation ─────────────────────────────────────────────────────────
async function computeEloRatings() {
  // Reconstruct match results from player history (fixtures table only has ~10 rows
  // but player_gameweek_history has 28 GWs worth of data)
  const [teamRows] = await db.execute(`
    SELECT
      p.team_id,
      h.gameweek,
      h.was_home,
      h.opponent_team_id,
      SUM(h.goals_scored) AS goals
    FROM player_gameweek_history h
    JOIN players p ON h.player_id = p.id
    WHERE h.minutes > 0 AND h.opponent_team_id IS NOT NULL
    GROUP BY p.team_id, h.gameweek, h.was_home, h.opponent_team_id
    ORDER BY h.gameweek ASC
  `);

  // Pair home/away rows into complete match records
  const matchMap = {};
  for (const row of teamRows) {
    const tid  = Number(row.team_id);
    const oid  = Number(row.opponent_team_id);
    const gw   = Number(row.gameweek);
    const goals = Number(row.goals);

    if (row.was_home) {
      const key = `${gw}_${tid}_${oid}`;
      if (!matchMap[key]) matchMap[key] = { gw, homeId: tid, awayId: oid };
      matchMap[key].homeGoals = goals;
    } else {
      const key = `${gw}_${oid}_${tid}`;
      if (!matchMap[key]) matchMap[key] = { gw, homeId: oid, awayId: tid };
      matchMap[key].awayGoals = goals;
    }
  }

  // Keep only complete matches and sort chronologically
  const matches = Object.values(matchMap)
    .filter(m => m.homeGoals != null && m.awayGoals != null)
    .sort((a, b) => a.gw - b.gw);

  if (!matches.length) {
    console.warn('[ELO] No complete matches found to compute ratings.');
    return {};
  }

  // Initialize Elo map
  const eloMap = {};
  const ensure = id => { if (!eloMap[id]) eloMap[id] = { elo: ELO_START, games: 0 }; };

  // Walk through matches in GW order
  for (const { homeId, awayId, homeGoals, awayGoals } of matches) {
    ensure(homeId);
    ensure(awayId);

    // Home team gets Elo bonus for the expected-score calculation
    const expHome = expectedScore(eloMap[homeId].elo + HOME_ADV, eloMap[awayId].elo);
    const expAway = 1 - expHome;

    const actualHome = homeGoals > awayGoals ? 1 : homeGoals === awayGoals ? 0.5 : 0;
    const actualAway = 1 - actualHome;

    const mm   = marginMultiplier(Math.abs(homeGoals - awayGoals));
    const kAdj = K * mm;

    eloMap[homeId].elo   += kAdj * (actualHome - expHome);
    eloMap[awayId].elo   += kAdj * (actualAway - expAway);
    eloMap[homeId].games += 1;
    eloMap[awayId].games += 1;
  }

  return eloMap;  // { teamId: { elo, games } }
}

// ─── Persist to DB ────────────────────────────────────────────────────────────
async function computeAndStoreElo() {
  const eloMap = await computeEloRatings();
  const teams  = Object.entries(eloMap);

  if (!teams.length) return eloMap;

  for (const [teamId, data] of teams) {
    await db.execute(
      `INSERT INTO team_elo (team_id, elo, games)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE elo = VALUES(elo), games = VALUES(games)`,
      [Number(teamId), Math.round(data.elo * 100) / 100, data.games]
    );
  }

  // Log the table for visibility
  const sorted = teams
    .map(([id, d]) => ({ id: Number(id), elo: Math.round(d.elo), games: d.games }))
    .sort((a, b) => b.elo - a.elo);

  console.log('[ELO] Ratings computed and stored:');
  sorted.slice(0, 5).forEach(t => console.log(`  [ELO]   team ${t.id}: ${t.elo} (${t.games} games)`));
  if (sorted.length > 5) console.log(`  [ELO]   ...and ${sorted.length - 5} more teams`);

  return eloMap;
}

async function getEloMap() {
  const [rows] = await db.execute('SELECT team_id, elo FROM team_elo');
  const map = {};
  for (const r of rows) map[Number(r.team_id)] = Number(r.elo);
  return map;
}

// ─── Conversion helpers ───────────────────────────────────────────────────────

/**
 * Convert Elo gap (team - opponent, positive = team is stronger) to a
 * lambda multiplier for Dixon-Coles expected goals.
 *
 * eloGap = +200  → team much stronger → mult ~1.28 (scores more)
 * eloGap =    0  → even              → mult ~1.00
 * eloGap = -200  → team much weaker  → mult ~0.75 (scores less)
 *
 * @param {number} eloGap  — team Elo minus opponent Elo (home bonus already applied)
 */
function eloToLambdaMult(eloGap) {
  const winProb = 1 / (1 + Math.pow(10, -eloGap / 400));
  // Linear map: winProb 0.1→0.72,  0.5→1.00,  0.9→1.28
  return clamp(0.64 + winProb * 0.72, 0.72, 1.32);
}

/**
 * Convert Elo gap to a clean-sheet fixture probability.
 * Calibrated to actual PL CS rate (~24% average).
 *
 * eloGap = +200  → easier fixture → cs ~0.34
 * eloGap =    0  → neutral        → cs ~0.24
 * eloGap = -200  → harder fixture → cs ~0.14
 *
 * @param {number} eloGap  — team Elo minus opponent Elo (home bonus already applied)
 */
function eloToCsProb(eloGap) {
  const defProb = 1 / (1 + Math.pow(10, -eloGap / 400));
  // Linear map: defProb 0.1→0.08,  0.5→0.24,  0.9→0.40
  return clamp(0.08 + defProb * 0.32, 0.10, 0.40);
}

module.exports = {
  computeAndStoreElo,
  getEloMap,
  eloToLambdaMult,
  eloToCsProb,
  HOME_ADV,
  ELO_START,
};
