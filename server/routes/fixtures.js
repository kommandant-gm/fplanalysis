const express = require('express');
const router = express.Router();
const db = require('../config/db');

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mean(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function poissonPMF(lambda, k) {
  if (lambda < 0) return 0;
  let factorial = 1;
  for (let i = 2; i <= k; i++) factorial *= i;
  return (Math.exp(-lambda) * (lambda ** k)) / factorial;
}

function weightedBlend(parts = [], fallback = 0) {
  const valid = parts.filter(
    p => p && Number.isFinite(p.value) && Number.isFinite(p.weight) && p.weight > 0
  );
  if (!valid.length) return fallback;
  const totalWeight = valid.reduce((sum, p) => sum + p.weight, 0);
  if (totalWeight <= 0) return fallback;
  return valid.reduce((sum, p) => sum + (p.value * p.weight), 0) / totalWeight;
}

function dixonColesTau(homeGoals, awayGoals, lambdaHome, lambdaAway, rho) {
  if (homeGoals === 0 && awayGoals === 0) return Math.max(0.25, 1 - (lambdaHome * lambdaAway * rho));
  if (homeGoals === 0 && awayGoals === 1) return Math.max(0.25, 1 + (lambdaHome * rho));
  if (homeGoals === 1 && awayGoals === 0) return Math.max(0.25, 1 + (lambdaAway * rho));
  if (homeGoals === 1 && awayGoals === 1) return Math.max(0.25, 1 - rho);
  return 1;
}

function buildPoissonScoreMatrix(homeXg, awayXg, maxGoals = 7) {
  const matrix = [];
  let total = 0;

  for (let h = 0; h <= maxGoals; h++) {
    matrix[h] = [];
    const pH = poissonPMF(homeXg, h);
    for (let a = 0; a <= maxGoals; a++) {
      const p = pH * poissonPMF(awayXg, a);
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

function buildDixonColesScoreMatrix(homeXg, awayXg, rho = -0.08, maxGoals = 7) {
  const matrix = [];
  let total = 0;

  for (let h = 0; h <= maxGoals; h++) {
    matrix[h] = [];
    const pH = poissonPMF(homeXg, h);
    for (let a = 0; a <= maxGoals; a++) {
      const pA = poissonPMF(awayXg, a);
      const tau = dixonColesTau(h, a, homeXg, awayXg, rho);
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

function blendScoreMatrices(matrixA = [], matrixB = [], weightA = 0.45, weightB = 0.55) {
  const maxGoals = Math.min(matrixA.length, matrixB.length) - 1;
  if (maxGoals < 0) return [];
  const out = [];
  let total = 0;

  for (let h = 0; h <= maxGoals; h++) {
    out[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      const value = weightedBlend(
        [
          { value: toNum(matrixA[h]?.[a], 0), weight: weightA },
          { value: toNum(matrixB[h]?.[a], 0), weight: weightB },
        ],
        0
      );
      out[h][a] = value;
      total += value;
    }
  }

  if (total <= 0) return out;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      out[h][a] = out[h][a] / total;
    }
  }
  return out;
}

function mixScoreMatrices(weightedMatrices = []) {
  const valid = weightedMatrices.filter(
    item => item && Array.isArray(item.matrix) && item.matrix.length && Number.isFinite(item.weight) && item.weight > 0
  );
  if (!valid.length) return [];

  const maxGoals = Math.min(...valid.map(item => item.matrix.length)) - 1;
  if (maxGoals < 0) return [];

  const out = [];
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    out[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      let cell = 0;
      let cellWeight = 0;
      for (const item of valid) {
        const value = toNum(item.matrix[h]?.[a], 0);
        cell += value * item.weight;
        cellWeight += item.weight;
      }
      const mixed = cellWeight > 0 ? (cell / cellWeight) : 0;
      out[h][a] = mixed;
      total += mixed;
    }
  }

  if (total <= 0) return out;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      out[h][a] = out[h][a] / total;
    }
  }
  return out;
}

function buildCalibratedFixtureMatrix(homeXg, awayXg, maxGoals = 7) {
  const totalLambda = homeXg + awayXg;
  const baseRho = clamp(-0.08 + ((2.4 - totalLambda) * 0.035), -0.16, -0.02);

  // Over-dispersion layer:
  // football scorelines are heavier-tailed than a single Poisson/DC fit.
  const dispersion = clamp(0.10 + ((totalLambda - 2.4) * 0.03), 0.08, 0.16);
  const scenarios = [
    { factor: 1 - dispersion, weight: 0.22 },
    { factor: 1, weight: 0.56 },
    { factor: 1 + dispersion, weight: 0.22 },
  ];

  const scenarioMatrices = scenarios.map((s) => {
    const lambdaHome = clamp(homeXg * s.factor, 0.15, 4.2);
    const lambdaAway = clamp(awayXg * s.factor, 0.15, 4.0);
    const rho = clamp(baseRho + ((1 - s.factor) * 0.02), -0.18, -0.01);

    const poisson = buildPoissonScoreMatrix(lambdaHome, lambdaAway, maxGoals);
    const dixonColes = buildDixonColesScoreMatrix(lambdaHome, lambdaAway, rho, maxGoals);
    return {
      matrix: blendScoreMatrices(poisson, dixonColes, 0.45, 0.55),
      weight: s.weight,
    };
  });

  const matrix = mixScoreMatrices(scenarioMatrices);
  return {
    matrix,
    rho: baseRho,
    poissonWeight: 0.45,
    dixonColesWeight: 0.55,
    dispersion: parseFloat(dispersion.toFixed(3)),
  };
}

function getOutcomeProbabilities(scoreMatrix = []) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  const maxGoals = scoreMatrix.length - 1;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = toNum(scoreMatrix[h]?.[a], 0);
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
    }
  }

  const total = homeWin + draw + awayWin;
  if (total <= 0) return { home_win: 0.33, draw: 0.34, away_win: 0.33 };

  return {
    home_win: homeWin / total,
    draw: draw / total,
    away_win: awayWin / total,
  };
}

function mostLikelyScoreline(scoreMatrix = [], maxGoals = 6) {
  let best = { home: 1, away: 1, prob: 0 };
  const maxFromMatrix = scoreMatrix.length - 1;
  const cutoff = Math.min(maxGoals, maxFromMatrix);

  for (let h = 0; h <= cutoff; h++) {
    for (let a = 0; a <= cutoff; a++) {
      const p = toNum(scoreMatrix[h]?.[a], 0);
      if (p > best.prob) best = { home: h, away: a, prob: p };
    }
  }
  return best;
}

function extractTeamGoalDistribution(scoreMatrix = [], side = 'home') {
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

  const total = dist.reduce((sum, p) => sum + p, 0);
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
    const pPlayerScores = 1 - ((1 - share) ** goals);
    prob += pGoals * pPlayerScores;
  }
  return clamp(prob, 0, 0.99);
}

function pickLikelyScorers(players = [], limit = 3, teamGoalDist = [], teamLambda = null) {
  if (!players.length) return [];
  const lambda = Math.max(toNum(teamLambda, 0), 0.15);

  const ranked = players
    .filter(p => toNum(p.xg_prob, 0) > 0.02)
    .map((p) => {
      const xgProb = toNum(p.xg_prob, 0);
      const minsProb = clamp(toNum(p.mins_prob, 0.6), 0.05, 1);
      const xpts = toNum(p.xpts, 0);
      const baseGoalProb = clamp(xgProb * minsProb, 0, 0.97);
      const pos = toNum(p.position, 4);
      const shareFloor = pos === 4 ? 0.03 : pos === 3 ? 0.02 : pos === 2 ? 0.008 : 0.004;
      const shareCap = pos === 4 ? 0.75 : pos === 3 ? 0.62 : pos === 2 ? 0.40 : 0.28;
      const rawShare = baseGoalProb / lambda;
      const playerShare = clamp(rawShare, shareFloor, shareCap);
      const dixonGoalProb = teamGoalDist.length
        ? playerGoalProbFromTeamDistribution(teamGoalDist, playerShare)
        : baseGoalProb;
      const goalProbability = clamp(
        weightedBlend(
          [
            { value: baseGoalProb, weight: 0.45 },
            { value: dixonGoalProb, weight: 0.55 },
          ],
          baseGoalProb
        ),
        0,
        0.97
      );
      const rankScore = (goalProbability * 0.78) + (minsProb * 0.15) + ((xpts / 10) * 0.07);
      return {
        id: p.id,
        name: p.name,
        position: p.position,
        xg_prob: parseFloat(xgProb.toFixed(3)),
        mins_prob: parseFloat(minsProb.toFixed(3)),
        goal_probability: parseFloat(goalProbability.toFixed(3)),
        rankScore,
      };
    })
    .sort((a, b) => b.rankScore - a.rankScore);

  const fallback = [...players]
    .sort((a, b) => toNum(b.xg_prob, 0) - toNum(a.xg_prob, 0))
    .map(p => ({
      id: p.id,
      name: p.name,
      position: p.position,
      xg_prob: parseFloat(toNum(p.xg_prob, 0).toFixed(3)),
      mins_prob: parseFloat(toNum(p.mins_prob, 0).toFixed(3)),
      goal_probability: parseFloat((toNum(p.xg_prob, 0) * clamp(toNum(p.mins_prob, 0.5), 0.05, 1)).toFixed(3)),
      rankScore: 0,
    }));

  const source = ranked.length ? ranked : fallback;
  return source.slice(0, limit);
}

function estimateTeamGoals(players = [], fdr = 3, isHome = false) {
  if (!players.length) {
    const base = isHome ? 1.12 : 0.98;
    const fdrAdj = 1 + ((3 - toNum(fdr, 3)) * 0.10);
    return clamp(base * fdrAdj, 0.25, 3.2);
  }

  const starters = [...players]
    .sort((a, b) => toNum(b.mins_prob, 0) - toNum(a.mins_prob, 0))
    .slice(0, 11);
  const likelyScorers = [...starters]
    .sort((a, b) => toNum(b.xg_prob, 0) - toNum(a.xg_prob, 0))
    .slice(0, 7);

  const scorerMass = likelyScorers.reduce(
    (sum, p) => sum + (toNum(p.xg_prob, 0) * clamp(toNum(p.mins_prob, 0.55), 0.15, 1)),
    0
  );
  const avgXpts = mean(starters.map(p => toNum(p.xpts, 0)));
  const avgLikelyPts = mean(starters.map(p => toNum(p.likely_pts, 0)));
  const avgForm = mean(starters.map(p => toNum(p.form, 0)));

  const baseLambda =
    0.22 +
    (scorerMass * 0.96) +
    (avgXpts * 0.11) +
    (avgLikelyPts * 0.025) +
    ((avgForm / 10) * 0.20);

  const fdrMult = 1 + ((3 - toNum(fdr, 3)) * 0.12);
  const venueMult = isHome ? 1.08 : 0.95;
  return clamp(baseLambda * fdrMult * venueMult, 0.25, 3.4);
}

async function resolveGameweek(gw) {
  const parsed = parseInt(gw, 10);
  if (parsed) return parsed;

  const [predGW] = await db.execute('SELECT MIN(gameweek) AS gw FROM predictions');
  if (predGW[0]?.gw) return predGW[0].gw;

  const [fixGW] = await db.execute('SELECT MIN(gameweek) AS gw FROM fixtures');
  return fixGW[0]?.gw || 1;
}

const FIXTURE_SELECT = `
  SELECT
    f.id, f.gameweek,
    f.team_home_id, f.team_away_id,
    f.difficulty_home, f.difficulty_away,
    f.kickoff_time, f.finished,
    f.score_home, f.score_away,
    th.name AS home_team, th.short_name AS home_short, th.code AS home_code,
    ta.name AS away_team, ta.short_name AS away_short, ta.code AS away_code
  FROM fixtures f
  JOIN teams th ON f.team_home_id = th.id
  JOIN teams ta ON f.team_away_id = ta.id
`;

// GET /api/fixtures/probabilities?gw=30
// Returns fixture-level win/draw probabilities and likely scorers.
router.get('/probabilities', async (req, res) => {
  try {
    const gameweek = await resolveGameweek(req.query.gw);

    const [fixtures] = await db.execute(
      `${FIXTURE_SELECT} WHERE f.gameweek = ? ORDER BY f.kickoff_time, f.id`,
      [gameweek]
    );

    if (!fixtures.length) {
      return res.json({ success: true, gameweek, data: [] });
    }

    const teamIds = Array.from(
      new Set(fixtures.flatMap(f => [toNum(f.team_home_id, 0), toNum(f.team_away_id, 0)]).filter(Boolean))
    );
    const placeholders = teamIds.map(() => '?').join(', ');

    const [playerRows] = await db.execute(
      `SELECT
         p.id, p.name, p.team_id, p.position, p.form,
         pr.xpts, pr.likely_pts, pr.xg_prob, pr.mins_prob
       FROM predictions pr
       JOIN players p ON pr.player_id = p.id
       WHERE pr.gameweek = ? AND p.team_id IN (${placeholders})
       ORDER BY p.team_id ASC, pr.xg_prob DESC, pr.xpts DESC`,
      [gameweek, ...teamIds]
    );

    const playersByTeam = {};
    for (const row of playerRows) {
      if (!playersByTeam[row.team_id]) playersByTeam[row.team_id] = [];
      playersByTeam[row.team_id].push(row);
    }

    const rows = fixtures.map((f) => {
      const homeId = toNum(f.team_home_id, 0);
      const awayId = toNum(f.team_away_id, 0);
      const homePlayers = playersByTeam[homeId] || [];
      const awayPlayers = playersByTeam[awayId] || [];

      const homeXg = estimateTeamGoals(homePlayers, f.difficulty_home, true);
      const awayXg = estimateTeamGoals(awayPlayers, f.difficulty_away, false);
      const calibrated = buildCalibratedFixtureMatrix(homeXg, awayXg, 7);
      const blendedMatrix = calibrated.matrix;
      const probs = getOutcomeProbabilities(blendedMatrix);
      const scoreline = mostLikelyScoreline(blendedMatrix, 6);
      const homeGoalDist = extractTeamGoalDistribution(blendedMatrix, 'home');
      const awayGoalDist = extractTeamGoalDistribution(blendedMatrix, 'away');

      const winnerPick =
        probs.home_win >= probs.draw && probs.home_win >= probs.away_win
          ? 'HOME'
          : probs.away_win >= probs.draw
            ? 'AWAY'
            : 'DRAW';

      return {
        id: f.id,
        gameweek: f.gameweek,
        kickoff_time: f.kickoff_time,
        home_team: f.home_team,
        home_short: f.home_short,
        home_team_id: toNum(f.team_home_id, 0),
        home_code: toNum(f.home_code, 0) || null,
        away_team: f.away_team,
        away_short: f.away_short,
        away_team_id: toNum(f.team_away_id, 0),
        away_code: toNum(f.away_code, 0) || null,
        expected_goals: {
          home: parseFloat(homeXg.toFixed(2)),
          away: parseFloat(awayXg.toFixed(2)),
        },
        probabilities: {
          home_win: parseFloat(probs.home_win.toFixed(4)),
          draw: parseFloat(probs.draw.toFixed(4)),
          away_win: parseFloat(probs.away_win.toFixed(4)),
        },
        winner_pick: winnerPick,
        likely_scoreline: {
          home: scoreline.home,
          away: scoreline.away,
          probability: parseFloat(scoreline.prob.toFixed(4)),
        },
        likely_scorers: {
          home: pickLikelyScorers(homePlayers, 3, homeGoalDist, homeXg),
          away: pickLikelyScorers(awayPlayers, 3, awayGoalDist, awayXg),
        },
        model: {
          poisson_weight: calibrated.poissonWeight,
          dixon_coles_weight: calibrated.dixonColesWeight,
          rho: parseFloat(calibrated.rho.toFixed(3)),
          dispersion: calibrated.dispersion,
        },
      };
    });

    res.json({ success: true, gameweek, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/fixtures?gw=30
router.get('/', async (req, res) => {
  try {
    const gameweek = await resolveGameweek(req.query.gw);
    const [rows] = await db.execute(
      `${FIXTURE_SELECT} WHERE f.gameweek = ? ORDER BY f.kickoff_time, f.id`,
      [gameweek]
    );
    res.json({ success: true, gameweek, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/fixtures/upcoming
router.get('/upcoming', async (_req, res) => {
  try {
    const [gwRows] = await db.execute(
      'SELECT DISTINCT gameweek FROM fixtures ORDER BY gameweek LIMIT 2'
    );

    if (!gwRows.length) {
      return res.json({ success: true, current: [], next: [], currentGW: null, nextGW: null });
    }

    const currentGW = gwRows[0].gameweek;
    const nextGW = gwRows[1]?.gameweek ?? null;

    const gwList = nextGW ? [currentGW, nextGW] : [currentGW];
    const placeholders = gwList.map(() => '?').join(', ');

    const [rows] = await db.execute(
      `${FIXTURE_SELECT} WHERE f.gameweek IN (${placeholders}) ORDER BY f.gameweek, f.kickoff_time, f.id`,
      gwList
    );

    const current = rows.filter(f => f.gameweek === currentGW);
    const next = rows.filter(f => f.gameweek === nextGW);

    res.json({ success: true, current, next, currentGW, nextGW });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
