/**
 * FPL Retroactive Backtester  (walk-forward validation)
 *
 * Uses player_gameweek_history to simulate predictions for every GW using
 * only data that would have been available BEFORE that GW was played.
 * No FotMob signals (we don't have per-GW FotMob snapshots), but gives
 * immediate signal quality metrics across the full season.
 *
 * Usage:
 *   cd server && node scripts/backtest_retro.js
 *   node scripts/backtest_retro.js --start=5   (start from GW 5, default 4)
 *   node scripts/backtest_retro.js --window=6  (rolling window size, default 6)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db   = require('../config/db');
const fs   = require('fs');
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; })
);

const WINDOW    = Number(args.window ?? 6);   // rolling history window
const START_GW  = Number(args.start  ?? 4);   // need at least 3 GWs of history

const posName = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

// ─── Stat helpers ─────────────────────────────────────────────────────────────
function mae(errors)  { return errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length; }
function rmse(errors) { return Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length); }
function bias(errors) { return errors.reduce((s, e) => s + e, 0) / errors.length; }
function median(arr)  {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function rSquared(actual, predicted) {
  const avg    = actual.reduce((s, v) => s + v, 0) / actual.length;
  const ssTot  = actual.reduce((s, v) => s + (v - avg) ** 2, 0);
  const ssRes  = actual.reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0);
  return ssTot === 0 ? null : 1 - ssRes / ssTot;
}
function spearman(x, y) {
  const n = x.length;
  const rank = arr => {
    const sorted = [...arr].map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    const ranks  = new Array(n);
    sorted.forEach(([, i], r) => { ranks[i] = r + 1; });
    return ranks;
  };
  const rx = rank(x), ry = rank(y);
  const d2 = rx.reduce((s, r, i) => s + (r - ry[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}
function pearson(x, y) {
  const n   = x.length;
  const mx  = x.reduce((s, v) => s + v, 0) / n;
  const my  = y.reduce((s, v) => s + v, 0) / n;
  const num = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0);
  const den = Math.sqrt(
    x.reduce((s, v) => s + (v - mx) ** 2, 0) *
    y.reduce((s, v) => s + (v - my) ** 2, 0)
  );
  return den === 0 ? 0 : num / den;
}
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function fmt(n, dp = 3)   { return n == null ? 'N/A' : Number(n).toFixed(dp); }
function pct(n)            { return (n * 100).toFixed(1) + '%'; }

// ─── Prediction signal logic (history-only version) ───────────────────────────
// This mirrors the production model but uses only FPL history data.
const PTS_GOAL   = { 1: 6, 2: 6, 3: 5, 4: 4 };
const PTS_ASSIST = { 1: 3, 2: 3, 3: 3, 4: 3 };
const PTS_CS     = { 1: 4, 2: 4, 3: 1, 4: 0 };

function buildSimplePrediction(playerRows, gameweek, position) {
  // playerRows = history rows for this player, sorted by gameweek ASC
  const prior = playerRows
    .filter(r => r.gameweek < gameweek)
    .sort((a, b) => b.gameweek - a.gameweek)   // most recent first
    .slice(0, WINDOW);

  if (!prior.length) return null;

  const totalMins   = prior.reduce((s, r) => s + r.minutes,       0);
  const totalGames  = prior.length;

  // Minutes probability
  const gamesPlayed = prior.filter(r => r.minutes > 0).length;
  const games60plus = prior.filter(r => r.minutes >= 60).length;
  const minsProb    = clamp(gamesPlayed / totalGames, 0.05, 1.0);
  const mins60Prob  = clamp(games60plus / totalGames, 0.0,  minsProb);

  // xG signal: expected_goals per 90 from history
  const rowsWithXg  = prior.filter(r => r.minutes > 0 && r.expected_goals != null);
  const xgPer90     = rowsWithXg.length
    ? (rowsWithXg.reduce((s, r) => s + Number(r.expected_goals), 0) / rowsWithXg.length)
    : 0;

  // Goals per 90 as secondary check
  const goalsPer90  = totalMins > 0
    ? prior.reduce((s, r) => s + r.goals_scored, 0) / (totalMins / 90)
    : 0;

  // Blend xG and raw goals (3:1 in favour of xG when available)
  const blendedXgPer90 = rowsWithXg.length >= 2
    ? (xgPer90 * 0.75 + goalsPer90 * 0.25)
    : (xgPer90 * 0.40 + goalsPer90 * 0.60);

  // xG probability: Poisson(lambda) → P(goals >= 1)
  const lambdaGoal = clamp(blendedXgPer90 * minsProb, 0, 2.5);
  const xgProb     = clamp(1 - Math.exp(-lambdaGoal), 0, 0.97);

  // xA signal
  const rowsWithXa  = prior.filter(r => r.minutes > 0 && r.expected_assists != null);
  const xaPer90     = rowsWithXa.length
    ? (rowsWithXa.reduce((s, r) => s + Number(r.expected_assists), 0) / rowsWithXa.length)
    : 0;
  const assistsPer90 = totalMins > 0
    ? prior.reduce((s, r) => s + r.assists, 0) / (totalMins / 90)
    : 0;
  const blendedXaPer90 = rowsWithXa.length >= 2
    ? (xaPer90 * 0.75 + assistsPer90 * 0.25)
    : (xaPer90 * 0.40 + assistsPer90 * 0.60);
  const lambdaAssist = clamp(blendedXaPer90 * minsProb, 0, 2.0);
  const xaProb       = clamp(1 - Math.exp(-lambdaAssist), 0, 0.90);

  // CS probability from rolling clean sheet rate
  // Caps calibrated to actual PL rates: GKP 24.6%, DEF 20.5%, MID 18.6%
  const csGames = prior.filter(r => r.minutes > 0).length;
  const csCount = prior.filter(r => r.minutes > 0 && r.clean_sheets > 0).length;
  const csRate  = csGames > 0 ? csCount / csGames : 0.22;

  // Apply position CS cap (calibrated — old caps were 0.78/0.55 which caused 25% calibration error)
  const csCap   = position <= 2 ? 0.52 : position === 3 ? 0.35 : 0.0;
  const csProb  = clamp(csRate * minsProb, 0, csCap);

  // Expected points
  const ptGoal   = PTS_GOAL[position]   ?? 4;
  const ptAssist = PTS_ASSIST[position] ?? 3;
  const ptCs     = PTS_CS[position]     ?? 0;
  const ptConc   = position <= 2 ? 0.5 : 0;   // simplified concede deduction

  const xpts =
    (minsProb * 1) +           // appearance point
    (mins60Prob * 1) +         // 60-min bonus
    (xgProb    * ptGoal) +
    (xaProb    * ptAssist) +
    (csProb    * ptCs) -
    (position <= 2 ? (1 - csProb) * minsProb * ptConc : 0);

  return {
    xpts:      clamp(xpts,     0, 30),
    xgProb:    clamp(xgProb,   0, 0.97),
    xaProb:    clamp(xaProb,   0, 0.90),
    csProb:    clamp(csProb,   0, csCap),
    minsProb:  minsProb,
    sampleSize: prior.length,
  };
}

// ─── Naive baselines for comparison ──────────────────────────────────────────
function naiveBaseline3(playerRows, gameweek) {
  const prior = playerRows
    .filter(r => r.gameweek < gameweek)
    .sort((a, b) => b.gameweek - a.gameweek)
    .slice(0, 3);
  if (!prior.length) return null;
  return prior.reduce((s, r) => s + r.total_points, 0) / prior.length;
}

function naiveSeason(playerRows, gameweek) {
  const prior = playerRows.filter(r => r.gameweek < gameweek);
  if (!prior.length) return null;
  return prior.reduce((s, r) => s + r.total_points, 0) / prior.length;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  FPL RETROACTIVE BACKTESTER  (walk-forward validation)');
  console.log(`  Rolling window: last ${WINDOW} GWs   |   Starting from GW ${START_GW}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Fetch all history + player info
  const [histRows] = await db.execute(`
    SELECT
      h.player_id, h.gameweek, h.total_points, h.minutes,
      h.goals_scored, h.assists, h.clean_sheets,
      h.expected_goals, h.expected_assists,
      pl.position, pl.name
    FROM player_gameweek_history h
    JOIN players pl ON h.player_id = pl.id
    ORDER BY h.player_id ASC, h.gameweek ASC
  `);

  if (!histRows.length) {
    console.log('  ⚠  player_gameweek_history is empty. Run a full sync first.\n');
    await db.end();
    return;
  }

  // Index history by player
  const byPlayer = {};
  for (const r of histRows) {
    if (!byPlayer[r.player_id]) byPlayer[r.player_id] = [];
    byPlayer[r.player_id].push(r);
  }

  const allGWs     = [...new Set(histRows.map(r => r.gameweek))].sort((a, b) => a - b);
  const targetGWs  = allGWs.filter(gw => gw >= START_GW);

  console.log(`  Players:    ${Object.keys(byPlayer).length}`);
  console.log(`  GW range:   ${allGWs[0]}–${allGWs[allGWs.length - 1]}  (${allGWs.length} GWs)`);
  console.log(`  Testing GW: ${targetGWs[0]}–${targetGWs[targetGWs.length - 1]}  (${targetGWs.length} GWs)\n`);

  // Walk-forward: for each target GW, build predictions and compare
  const allResults = [];   // {gw, position, xpts_pred, xpts_naive3, xpts_season, actual}

  for (const gw of targetGWs) {
    for (const [playerId, rows] of Object.entries(byPlayer)) {
      const actual = rows.find(r => r.gameweek === gw);
      if (!actual) continue;

      const position = actual.position;
      const pred     = buildSimplePrediction(rows, gw, position);
      if (!pred) continue;

      const naive3   = naiveBaseline3(rows, gw);
      const season   = naiveSeason(rows, gw);

      allResults.push({
        gw,
        playerId:   Number(playerId),
        name:       actual.name,
        position,
        xpts_pred:  pred.xpts,
        xg_prob:    pred.xgProb,
        xa_prob:    pred.xaProb,
        cs_prob:    pred.csProb,
        mins_prob:  pred.minsProb,
        sample:     pred.sampleSize,
        naive3:     naive3 ?? 0,
        season_avg: season ?? 0,
        actual:     actual.total_points,
        actual_mins: actual.minutes,
        actual_goals: actual.goals_scored,
        actual_assists: actual.assists,
        actual_cs:    actual.clean_sheets,
      });
    }
  }

  const N = allResults.length;
  console.log(`  Walk-forward samples generated: ${N}\n`);

  // ── Model accuracy ──────────────────────────────────────────────────────────
  const modelErrors  = allResults.map(r => r.xpts_pred - r.actual);
  const naive3Errors = allResults.map(r => r.naive3    - r.actual);
  const seasonErrors = allResults.map(r => r.season_avg - r.actual);

  const modelMAE   = mae(modelErrors);
  const naive3MAE  = mae(naive3Errors);
  const seasonMAE  = mae(seasonErrors);
  const modelRMSE  = rmse(modelErrors);
  const modelBias  = bias(modelErrors);
  const modelMed   = median(modelErrors.map(Math.abs));
  const modelR2    = rSquared(allResults.map(r => r.actual), allResults.map(r => r.xpts_pred));
  const modelSp    = spearman(allResults.map(r => r.actual), allResults.map(r => r.xpts_pred));

  const within1    = allResults.filter(r => Math.abs(r.xpts_pred - r.actual) <= 1).length;
  const within2    = allResults.filter(r => Math.abs(r.xpts_pred - r.actual) <= 2).length;
  const within3    = allResults.filter(r => Math.abs(r.xpts_pred - r.actual) <= 3).length;

  console.log('┌────────────────────────────────────────────────────────────────────┐');
  console.log('│  OVERALL ACCURACY  (retroactive history-only model)                │');
  console.log('├───────────────────────────────────┬───────────────────────────────-┤');
  console.log('│  Metric               History-only model   vs Naive baselines      │');
  console.log('├───────────────────────────────────────────────────────────────────-┤');
  console.log(`│  MAE                    ${fmt(modelMAE).padEnd(12)}  (3-GW avg: ${fmt(naive3MAE)}  |  season: ${fmt(seasonMAE)})   │`);
  console.log(`│  RMSE                   ${fmt(modelRMSE).padEnd(46)}│`);
  console.log(`│  Bias                   ${fmt(modelBias).padEnd(46)}│  (+ve = over-predict)`);
  console.log(`│  Median AE              ${fmt(modelMed).padEnd(46)}│`);
  console.log(`│  R²                     ${fmt(modelR2, 4).padEnd(46)}│`);
  console.log(`│  Spearman ρ             ${fmt(modelSp, 4).padEnd(46)}│`);
  console.log(`│  Within ±1 pt           ${pct(within1 / N).padEnd(46)}│`);
  console.log(`│  Within ±2 pts          ${pct(within2 / N).padEnd(46)}│`);
  console.log(`│  Within ±3 pts          ${pct(within3 / N).padEnd(46)}│`);
  console.log('└────────────────────────────────────────────────────────────────────┘\n');

  // MAE improvement over naive
  const impVsNaive3  = ((naive3MAE - modelMAE) / naive3MAE * 100);
  const impVsSeason  = ((seasonMAE - modelMAE) / seasonMAE * 100);
  console.log(`  MAE improvement vs 3-GW naive: ${impVsNaive3 >= 0 ? '+' : ''}${impVsNaive3.toFixed(1)}%  (+ = model is better)`);
  console.log(`  MAE improvement vs season avg: ${impVsSeason >= 0 ? '+' : ''}${impVsSeason.toFixed(1)}%\n`);

  // ── Per-position breakdown ──────────────────────────────────────────────────
  console.log('┌──────┬────────┬────────┬────────┬────────┬────────────┬─────────────────┐');
  console.log('│  Pos │    N   │   MAE  │  RMSE  │  Bias  │ Spearman ρ │ vs Naive-3 MAE  │');
  console.log('├──────┼────────┼────────┼────────┼────────┼────────────┼─────────────────┤');

  const byPosition = {};
  for (const r of allResults) {
    if (!byPosition[r.position]) byPosition[r.position] = [];
    byPosition[r.position].push(r);
  }

  const posResults = {};
  for (const pos of [1, 2, 3, 4]) {
    const g = byPosition[pos] || [];
    if (!g.length) continue;
    const errs  = g.map(r => r.xpts_pred - r.actual);
    const n3err = g.map(r => r.naive3    - r.actual);
    const res = {
      n:      g.length,
      mae:    mae(errs),
      rmse:   rmse(errs),
      bias:   bias(errs),
      sp:     spearman(g.map(r => r.actual), g.map(r => r.xpts_pred)),
      naive3: mae(n3err),
    };
    posResults[pos] = res;
    const delta = res.naive3 - res.mae;
    const flag  = delta >= 0 ? `+${fmt(delta)}` : fmt(delta);
    console.log(
      `│  ${posName[pos].padEnd(4)}│ ${String(res.n).padStart(6)} │ ${fmt(res.mae).padStart(6)} │` +
      ` ${fmt(res.rmse).padStart(6)} │ ${fmt(res.bias).padStart(6)} │ ${fmt(res.sp, 4).padStart(10)} │ ${flag.padStart(15)} │`
    );
  }
  console.log('└──────┴────────┴────────┴────────┴────────┴────────────┴─────────────────┘\n');

  // ── Per-GW MAE ─────────────────────────────────────────────────────────────
  const byGW = {};
  for (const r of allResults) {
    if (!byGW[r.gw]) byGW[r.gw] = [];
    byGW[r.gw].push(r);
  }

  console.log('  PER-GAMEWEEK MAE  (model vs naive 3-GW average)');
  console.log(`  ${'GW'.padEnd(4)} ${'N'.padStart(5)}  ${'Model MAE'.padStart(9)}  ${'Naive3'.padStart(9)}  Delta`);
  console.log(`  ${'─'.repeat(50)}`);

  const gwResults = [];
  for (const gw of targetGWs) {
    const g = byGW[gw] || [];
    if (!g.length) continue;
    const errs  = g.map(r => r.xpts_pred - r.actual);
    const n3err = g.map(r => r.naive3    - r.actual);
    const maeM  = mae(errs);
    const maeN  = mae(n3err);
    const delta = maeN - maeM;
    const flag  = delta >= 0 ? ` +${delta.toFixed(2)}` : `  ${delta.toFixed(2)}`;
    gwResults.push({ gw, n: g.length, maeModel: maeM, maeNaive3: maeN, delta });
    console.log(`  ${String(gw).padEnd(4)} ${String(g.length).padStart(5)}     ${fmt(maeM).padStart(6)}     ${fmt(maeN).padStart(6)} ${flag}`);
  }
  console.log();

  // ── Probability calibration ─────────────────────────────────────────────────
  function calibBuckets(pairs, bucketCount = 8) {
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      label:    `${(i / bucketCount * 100).toFixed(0)}–${((i + 1) / bucketCount * 100).toFixed(0)}%`,
      count: 0, sumProb: 0, sumActual: 0,
    }));
    for (const { prob, actual } of pairs) {
      const idx = Math.min(Math.floor(prob * bucketCount), bucketCount - 1);
      buckets[idx].count++; buckets[idx].sumProb += prob; buckets[idx].sumActual += actual;
    }
    return buckets
      .filter(b => b.count >= 10)
      .map(b => ({
        range:         b.label,
        count:         b.count,
        avg_predicted: b.sumProb   / b.count,
        actual_rate:   b.sumActual / b.count,
        error:         Math.abs((b.sumProb - b.sumActual) / b.count),
      }));
  }

  const calibTargets = [
    { label: 'xg_prob  → actually scored',    pairs: allResults.map(r => ({ prob: r.xg_prob,   actual: r.actual_goals   >= 1 ? 1 : 0 })) },
    { label: 'xa_prob  → actually assisted',  pairs: allResults.map(r => ({ prob: r.xa_prob,   actual: r.actual_assists >= 1 ? 1 : 0 })) },
    { label: 'cs_prob  → clean sheet',        pairs: allResults.map(r => ({ prob: r.cs_prob,   actual: r.actual_cs      >= 1 ? 1 : 0 })) },
    { label: 'mins_prob → played ≥1 min',     pairs: allResults.map(r => ({ prob: r.mins_prob, actual: r.actual_mins    >= 1 ? 1 : 0 })) },
  ];

  const calibResults = {};
  for (const { label, pairs } of calibTargets) {
    const buckets = calibBuckets(pairs);
    const avgErr  = buckets.length ? buckets.reduce((s, b) => s + b.error, 0) / buckets.length : null;
    console.log(`  CALIBRATION: ${label}`);
    console.log(`  ${'Range'.padEnd(9)} ${'N'.padStart(5)}   Predicted → Actual   Error`);
    console.log(`  ${'─'.repeat(50)}`);
    for (const b of buckets) {
      const flag = b.error > 0.10 ? '  ⚠ over-confident' : b.error > 0.06 ? '  △' : '';
      console.log(`  ${b.range.padEnd(9)} ${String(b.count).padStart(5)}   ${pct(b.avg_predicted).padStart(7)} → ${pct(b.actual_rate).padStart(7)}   ${pct(b.error).padStart(6)}${flag}`);
    }
    if (avgErr != null) console.log(`  Avg calibration error: ${pct(avgErr)}\n`);
    else console.log(`  Insufficient data\n`);
    calibResults[label] = { buckets, avgErr };
  }

  // ── Feature correlation analysis ────────────────────────────────────────────
  // What individual features (computed from N prior GWs) correlate most with
  // actual next-GW points? Guides where to focus model improvement.
  console.log('  FEATURE → ACTUAL POINTS CORRELATION');
  console.log(`  (Pearson r over ${N} samples — higher = more predictive)`);
  console.log(`  ${'─'.repeat(45)}`);

  const features = {
    'Predicted xpts (model)':       allResults.map(r => r.xpts_pred),
    'Naive 3-GW avg':               allResults.map(r => r.naive3),
    'Season avg pts':               allResults.map(r => r.season_avg),
    'xg_prob':                      allResults.map(r => r.xg_prob),
    'xa_prob':                      allResults.map(r => r.xa_prob),
    'cs_prob':                      allResults.map(r => r.cs_prob),
    'mins_prob':                    allResults.map(r => r.mins_prob),
  };
  const actual = allResults.map(r => r.actual);

  const corrs = Object.entries(features)
    .map(([name, vals]) => ({ name, r: pearson(vals, actual) }))
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

  for (const { name, r } of corrs) {
    const bar = '█'.repeat(Math.round(Math.abs(r) * 20));
    const dir = r >= 0 ? '+' : '-';
    console.log(`  ${name.padEnd(30)} ${dir}${fmt(Math.abs(r), 4)}  ${bar}`);
  }
  console.log();

  // ── Top-N ranking accuracy ─────────────────────────────────────────────────
  const rankResults = [];
  for (const gw of targetGWs) {
    const g = (byGW[gw] || []).filter(r => r.actual_mins > 0);
    if (g.length < 20) continue;
    const byPred   = [...g].sort((a, b) => b.xpts_pred - a.xpts_pred);
    const byActual = [...g].sort((a, b) => b.actual    - a.actual);
    for (const topN of [5, 10, 20]) {
      const predTop   = new Set(byPred.slice(0, topN).map(r => r.playerId));
      const actualTop = new Set(byActual.slice(0, topN * 3).map(r => r.playerId));
      const hits      = [...predTop].filter(id => actualTop.has(id)).length;
      rankResults.push({ gw, topN, hits, hitRate: hits / topN });
    }
  }

  if (rankResults.length) {
    console.log('  TOP-N RANKING ACCURACY');
    for (const topN of [5, 10, 20]) {
      const sub    = rankResults.filter(r => r.topN === topN);
      const avgHit = sub.reduce((s, r) => s + r.hitRate, 0) / sub.length;
      console.log(`  Top-${topN} by xpts → in actual top-${topN * 3}: ${pct(avgHit)} hit rate  (${sub.length} GWs)`);
    }
    console.log();
  }

  // ── Biggest misses ─────────────────────────────────────────────────────────
  const sorted = [...allResults]
    .sort((a, b) => Math.abs(b.xpts_pred - b.actual) - Math.abs(a.xpts_pred - a.actual));
  const biggestMisses = sorted.slice(0, 12);

  console.log('  TOP 12 BIGGEST MISSES');
  console.log(`  ${'Player'.padEnd(24)} GW  ${'Pred'.padStart(6)}  ${'Actual'.padStart(6)}  ${'Error'.padStart(7)}  Reason`);
  console.log(`  ${'─'.repeat(72)}`);
  for (const r of biggestMisses) {
    const err   = r.xpts_pred - r.actual;
    const dir   = err < 0 ? '↑ under' : '↓ over';
    const why   = r.actual_mins === 0 ? 'DNP' : r.actual > 15 ? 'haul' : '';
    console.log(`  ${r.name.slice(0, 24).padEnd(24)} ${String(r.gw).padStart(2)}  ${fmt(r.xpts_pred).padStart(6)}  ${String(r.actual).padStart(6)}  ${fmt(err, 2).padStart(7)}  ${dir} ${why}`);
  }

  // ── Save report ───────────────────────────────────────────────────────────
  const report = {
    generatedAt: new Date().toISOString(),
    config:      { window: WINDOW, startGW: START_GW },
    gwRange:     { from: targetGWs[0], to: targetGWs[targetGWs.length - 1] },
    samples:     N,
    overall: {
      mae:         modelMAE,
      rmse:        modelRMSE,
      bias:        modelBias,
      medianAE:    modelMed,
      r2:          modelR2,
      spearman:    modelSp,
      within1pt:   within1 / N,
      within2pt:   within2 / N,
      within3pt:   within3 / N,
    },
    baselines:    { naive3MAE, seasonMAE, impVsNaive3, impVsSeason },
    byPosition:   posResults,
    byGameweek:   gwResults,
    correlations: corrs,
    calibration:  calibResults,
    topNRanking:  rankResults,
    biggestMisses: biggestMisses.map(r => ({
      name:     r.name,
      gw:       r.gw,
      position: posName[r.position],
      predicted: r.xpts_pred,
      actual:   r.actual,
      error:    r.xpts_pred - r.actual,
      minutes:  r.actual_mins,
    })),
  };

  const outPath = path.join(__dirname, 'backtest-retro-results.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n  ✓ Full report saved → server/scripts/backtest-retro-results.json\n`);

  await db.end();
}

run().catch(err => {
  console.error('\n  ✗ Retroactive backtest failed:', err.message);
  process.exit(1);
});
