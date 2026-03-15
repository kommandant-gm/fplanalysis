/**
 * FPL Prediction Backtester
 *
 * Compares stored predictions against actual player_gameweek_history outcomes.
 * Prints a full accuracy report and writes results to server/scripts/backtest-results.json
 *
 * Usage:
 *   cd server && node scripts/backtest.js
 *   node scripts/backtest.js --gw=28-35   (restrict to gameweek range)
 *   node scripts/backtest.js --min-minutes=45  (only include players who played 45+ mins)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db   = require('../config/db');
const fs   = require('fs');
const path = require('path');

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? true];
    })
);

const gwRange    = args.gw ? args.gw.split('-').map(Number) : null;  // e.g. "28-35"
const minMinutes = Number(args['min-minutes'] ?? 0);                  // filter benchwarmers

// ─── Helpers ─────────────────────────────────────────────────────────────────
const posName = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

function mae(errors)    { return errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length; }
function rmse(errors)   { return Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length); }
function bias(errors)   { return errors.reduce((s, e) => s + e, 0) / errors.length; }
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function rSquared(actual, predicted) {
  const mean  = actual.reduce((s, v) => s + v, 0) / actual.length;
  const ssTot = actual.reduce((s, v) => s + (v - mean) ** 2, 0);
  const ssRes = actual.reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0);
  return ssTot === 0 ? null : 1 - ssRes / ssTot;
}
function spearman(x, y) {
  const n    = x.length;
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
function fmt(n, dp = 3) {
  if (n == null) return 'N/A';
  return Number(n).toFixed(dp);
}
function pct(n) { return (n * 100).toFixed(1) + '%'; }

// Calibration: group prob values into 10 buckets, compare to actual event rate
function calibrationBuckets(pairs /* [{prob, actual}] */, bucketCount = 10) {
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    low:      i / bucketCount,
    high:     (i + 1) / bucketCount,
    label:    `${(i / bucketCount * 100).toFixed(0)}–${((i + 1) / bucketCount * 100).toFixed(0)}%`,
    count:    0,
    sumProb:  0,
    sumActual: 0,
  }));

  for (const { prob, actual } of pairs) {
    const idx = Math.min(Math.floor(prob * bucketCount), bucketCount - 1);
    buckets[idx].count++;
    buckets[idx].sumProb   += prob;
    buckets[idx].sumActual += actual;
  }

  return buckets
    .filter(b => b.count >= 5)
    .map(b => ({
      range:          b.label,
      count:          b.count,
      avg_predicted:  b.sumProb   / b.count,
      actual_rate:    b.sumActual / b.count,
      calibration_err: Math.abs((b.sumProb - b.sumActual) / b.count),
    }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  FPL PREDICTION BACKTESTER');
  console.log('═══════════════════════════════════════════════════════\n');

  // ── 1. Fetch joined data ───────────────────────────────────────────────────
  let whereClause = '';
  const params = [];

  if (gwRange && gwRange.length === 2 && !isNaN(gwRange[0]) && !isNaN(gwRange[1])) {
    whereClause = 'WHERE p.gameweek BETWEEN ? AND ?';
    params.push(gwRange[0], gwRange[1]);
    console.log(`  Filtering to GW ${gwRange[0]}–${gwRange[1]}\n`);
  } else if (gwRange && gwRange.length === 1 && !isNaN(gwRange[0])) {
    whereClause = 'WHERE p.gameweek = ?';
    params.push(gwRange[0]);
    console.log(`  Filtering to GW ${gwRange[0]}\n`);
  }

  const [rows] = await db.execute(`
    SELECT
      p.player_id,
      p.gameweek,
      CAST(p.xpts      AS DECIMAL(6,3)) AS xpts,
      p.likely_pts,
      p.min_pts,
      p.max_pts,
      CAST(p.xg_prob   AS DECIMAL(5,4)) AS xg_prob,
      CAST(p.xa_prob   AS DECIMAL(5,4)) AS xa_prob,
      CAST(p.cs_prob   AS DECIMAL(5,4)) AS cs_prob,
      CAST(p.mins_prob AS DECIMAL(5,4)) AS mins_prob,
      p.fdr,
      h.total_points,
      h.minutes,
      h.goals_scored,
      h.assists,
      h.clean_sheets,
      pl.position,
      pl.name
    FROM predictions p
    JOIN player_gameweek_history h
      ON  p.player_id = h.player_id
      AND p.gameweek  = h.gameweek
    JOIN players pl ON p.player_id = pl.id
    ${whereClause}
    ORDER BY p.gameweek ASC, p.xpts DESC
  `, params);

  if (!rows.length) {
    console.log('  ⚠  No matching rows found between predictions and player_gameweek_history.');
    console.log('     Predictions may only cover future gameweeks not yet in history.\n');

    // Show what data is available
    const [[predInfo]]  = await db.execute('SELECT MIN(gameweek) minGW, MAX(gameweek) maxGW, COUNT(*) n FROM predictions');
    const [[histInfo]]  = await db.execute('SELECT MIN(gameweek) minGW, MAX(gameweek) maxGW, COUNT(*) n FROM player_gameweek_history');
    console.log(`  predictions table:            GW ${predInfo.minGW}–${predInfo.maxGW}  (${predInfo.n} rows)`);
    console.log(`  player_gameweek_history table: GW ${histInfo.minGW}–${histInfo.maxGW}  (${histInfo.n} rows)\n`);
    console.log('  → Predictions need to have been stored for already-completed gameweeks.');
    console.log('    As the season progresses and more GWs complete, this report will populate.\n');
    await db.end();
    return;
  }

  // Apply min-minutes filter after fetching (for clarity in partial-play analysis)
  const all      = rows.map(r => ({ ...r,
    xpts:      Number(r.xpts),
    xg_prob:   Number(r.xg_prob),
    xa_prob:   Number(r.xa_prob),
    cs_prob:   Number(r.cs_prob),
    mins_prob: Number(r.mins_prob),
  }));
  const filtered = minMinutes > 0 ? all.filter(r => r.minutes >= minMinutes) : all;
  const N = filtered.length;

  console.log(`  Matched rows (all players):          ${all.length}`);
  if (minMinutes > 0)
    console.log(`  After --min-minutes=${minMinutes} filter:     ${N}`);
  const gameweeks = [...new Set(all.map(r => r.gameweek))].sort((a, b) => a - b);
  console.log(`  Gameweeks covered:                   GW ${gameweeks[0]}–${gameweeks[gameweeks.length - 1]}  (${gameweeks.length} GWs)\n`);

  const errors   = filtered.map(r => r.xpts - r.total_points);
  const actual   = filtered.map(r => r.total_points);
  const predicted = filtered.map(r => r.xpts);

  // ── 2. Overall xPts accuracy ───────────────────────────────────────────────
  const overallMAE  = mae(errors);
  const overallRMSE = rmse(errors);
  const overallBias = bias(errors);
  const overallMed  = median(errors.map(Math.abs));
  const overallR2   = rSquared(actual, predicted);
  const overallSp   = spearman(actual, predicted);

  // Exact match ±1 pt, ±2 pt
  const within1 = filtered.filter(r => Math.abs(r.xpts - r.total_points) <= 1).length;
  const within2 = filtered.filter(r => Math.abs(r.xpts - r.total_points) <= 2).length;
  const within3 = filtered.filter(r => Math.abs(r.xpts - r.total_points) <= 3).length;

  // Range coverage: % actual in [min_pts, max_pts]
  const inRange  = filtered.filter(r => r.total_points >= r.min_pts && r.total_points <= r.max_pts).length;

  console.log('┌─────────────────────────────────────────────────────┐');
  console.log('│  OVERALL xPts ACCURACY                              │');
  console.log('├─────────────────────────────────────────────────────┤');
  console.log(`│  Samples:           ${String(N).padEnd(32)}│`);
  console.log(`│  MAE:               ${fmt(overallMAE, 3).padEnd(32)}│`);
  console.log(`│  RMSE:              ${fmt(overallRMSE, 3).padEnd(32)}│`);
  console.log(`│  Bias:              ${fmt(overallBias, 3).padEnd(32)}│  (+ve = over-predict)`);
  console.log(`│  Median AE:         ${fmt(overallMed, 3).padEnd(32)}│`);
  console.log(`│  R²:                ${fmt(overallR2, 4).padEnd(32)}│`);
  console.log(`│  Spearman ρ:        ${fmt(overallSp, 4).padEnd(32)}│`);
  console.log(`│  Within ±1 pt:      ${pct(within1 / N).padEnd(32)}│`);
  console.log(`│  Within ±2 pts:     ${pct(within2 / N).padEnd(32)}│`);
  console.log(`│  Within ±3 pts:     ${pct(within3 / N).padEnd(32)}│`);
  console.log(`│  Actual in range:   ${pct(inRange  / N).padEnd(32)}│  (min_pts–max_pts)`);
  console.log('└─────────────────────────────────────────────────────┘\n');

  // ── 3. Per-position breakdown ──────────────────────────────────────────────
  console.log('┌─────────────────────────────────────────────────────────────────────┐');
  console.log('│  PER-POSITION BREAKDOWN                                             │');
  console.log('├──────┬────────┬────────┬────────┬────────┬────────┬────────────────┤');
  console.log('│  Pos │    N   │   MAE  │  RMSE  │  Bias  │   R²   │  Spearman ρ    │');
  console.log('├──────┼────────┼────────┼────────┼────────┼────────┼────────────────┤');

  const byPosition = {};
  for (const r of filtered) {
    if (!byPosition[r.position]) byPosition[r.position] = [];
    byPosition[r.position].push(r);
  }

  const posResults = {};
  for (const pos of [1, 2, 3, 4]) {
    const group = byPosition[pos] || [];
    if (!group.length) continue;
    const errs = group.map(r => r.xpts - r.total_points);
    const act  = group.map(r => r.total_points);
    const pred = group.map(r => r.xpts);
    const res = {
      n:      group.length,
      mae:    mae(errs),
      rmse:   rmse(errs),
      bias:   bias(errs),
      r2:     rSquared(act, pred),
      sp:     spearman(act, pred),
    };
    posResults[pos] = res;
    console.log(
      `│  ${posName[pos].padEnd(4)}│ ${String(res.n).padStart(6)} │ ${fmt(res.mae).padStart(6)} │` +
      ` ${fmt(res.rmse).padStart(6)} │ ${fmt(res.bias).padStart(6)} │ ${fmt(res.r2, 4).padStart(6)} │` +
      ` ${fmt(res.sp, 4).padStart(14)} │`
    );
  }
  console.log('└──────┴────────┴────────┴────────┴────────┴────────┴────────────────┘\n');

  // ── 4. Per-gameweek MAE trend ──────────────────────────────────────────────
  console.log('┌──────────────────────────────────────────────────────┐');
  console.log('│  PER-GAMEWEEK MAE TREND                              │');
  console.log('├──────┬────────┬──────────┬────────────────────────── ┤');
  console.log('│  GW  │    N   │    MAE   │  Bias                     │');
  console.log('├──────┼────────┼──────────┼────────────────────────── ┤');

  const byGW = {};
  for (const r of filtered) {
    if (!byGW[r.gameweek]) byGW[r.gameweek] = [];
    byGW[r.gameweek].push(r);
  }

  const gwResults = [];
  for (const gw of gameweeks) {
    const group = byGW[gw] || [];
    if (!group.length) continue;
    const errs = group.map(r => r.xpts - r.total_points);
    const res  = { gw, n: group.length, mae: mae(errs), bias: bias(errs) };
    gwResults.push(res);
    const bar = '█'.repeat(Math.round(res.mae));
    console.log(
      `│  ${String(gw).padStart(2)}  │ ${String(res.n).padStart(6)} │  ${fmt(res.mae).padStart(6)}  │` +
      `  ${fmt(res.bias).padStart(6)}  ${bar.slice(0, 20).padEnd(20)}│`
    );
  }
  console.log('└──────┴────────┴──────────┴────────────────────────── ┘\n');

  // ── 5. Probability calibration ────────────────────────────────────────────
  const calibTargets = [
    {
      label:  'xg_prob  (predicted goal ≥1 vs actually scored)',
      pairs:  filtered.map(r => ({ prob: r.xg_prob,   actual: r.goals_scored  >= 1 ? 1 : 0 })),
    },
    {
      label:  'xa_prob  (predicted assist ≥1 vs actually assisted)',
      pairs:  filtered.map(r => ({ prob: r.xa_prob,   actual: r.assists       >= 1 ? 1 : 0 })),
    },
    {
      label:  'cs_prob  (predicted clean sheet vs actual)',
      pairs:  filtered.map(r => ({ prob: r.cs_prob,   actual: r.clean_sheets  >= 1 ? 1 : 0 })),
    },
    {
      label:  'mins_prob (predicted played vs actually played ≥1 min)',
      pairs:  filtered.map(r => ({ prob: r.mins_prob, actual: r.minutes       >= 1 ? 1 : 0 })),
    },
  ];

  const calibResults = {};
  for (const { label, pairs } of calibTargets) {
    const buckets = calibrationBuckets(pairs);
    const avgErr  = buckets.length
      ? buckets.reduce((s, b) => s + b.calibration_err, 0) / buckets.length
      : null;

    console.log(`  CALIBRATION: ${label}`);
    console.log(`  ${'Range'.padEnd(8)} ${'N'.padStart(5)}   Predicted → Actual   Error`);
    console.log(`  ${'─'.repeat(54)}`);

    for (const b of buckets) {
      const arrow = pct(b.avg_predicted).padStart(7) + ' → ' + pct(b.actual_rate).padStart(7);
      const err   = pct(b.calibration_err).padStart(7);
      const flag  = b.calibration_err > 0.10 ? '  ⚠' : '';
      console.log(`  ${b.range.padEnd(8)} ${String(b.count).padStart(5)}   ${arrow}   ${err}${flag}`);
    }
    if (avgErr != null)
      console.log(`  Average calibration error: ${pct(avgErr)}  (lower is better)\n`);
    else
      console.log(`  Not enough data for calibration buckets\n`);

    calibResults[label] = { buckets, avgErr };
  }

  // ── 6. Top-N ranking accuracy ──────────────────────────────────────────────
  console.log('┌──────────────────────────────────────────────────────────────────┐');
  console.log('│  RANKING ACCURACY  (top players by xPts vs actual outcomes)      │');
  console.log('├─────────────────────────────────────────────────────────────────-┤');

  const rankResults = [];
  for (const gw of gameweeks) {
    const group = (byGW[gw] || []).filter(r => r.minutes >= 1);
    if (group.length < 20) continue;

    const byXpts   = [...group].sort((a, b) => b.xpts        - a.xpts);
    const byActual = [...group].sort((a, b) => b.total_points - a.total_points);

    for (const topN of [5, 10, 20]) {
      const predictedTop  = new Set(byXpts.slice(0, topN).map(r => r.player_id));
      const actualTop     = new Set(byActual.slice(0, topN * 3).map(r => r.player_id));
      const hits          = [...predictedTop].filter(id => actualTop.has(id)).length;
      rankResults.push({ gw, topN, hits, possible: topN, hitRate: hits / topN });
    }
  }

  if (rankResults.length) {
    for (const topN of [5, 10, 20]) {
      const subset  = rankResults.filter(r => r.topN === topN);
      const avgHit  = subset.reduce((s, r) => s + r.hitRate, 0) / subset.length;
      console.log(`│  Top-${String(topN).padEnd(2)} by xPts in actual top-${String(topN * 3).padEnd(2)}:  ${pct(avgHit).padStart(7)} hit rate (avg over ${subset.length} GWs)  │`);
    }
  } else {
    console.log('│  Not enough data (need ≥1 GW with ≥20 players who played)         │');
  }
  console.log('└──────────────────────────────────────────────────────────────────┘\n');

  // ── 7. Zero-minute miss analysis ──────────────────────────────────────────
  const predicted0min  = all.filter(r => r.mins_prob  < 0.15);
  const actual0min     = all.filter(r => r.minutes    === 0);
  const truePosZero    = predicted0min.filter(r => r.minutes === 0).length;
  const falseNegZero   = actual0min.filter(r => r.mins_prob >= 0.15).length;

  console.log('  NON-STARTER DETECTION');
  console.log(`  Players predicted to not start (mins_prob < 15%):  ${predicted0min.length}`);
  console.log(`    → Actually didn't play:     ${truePosZero}  (${pct(predicted0min.length ? truePosZero / predicted0min.length : 0)} precision)`);
  console.log(`  Players who actually didn't play:                   ${actual0min.length}`);
  console.log(`    → Model missed them:        ${falseNegZero}  (${pct(actual0min.length ? falseNegZero / actual0min.length : 0)} miss rate)\n`);

  // ── 8. Biggest misses ─────────────────────────────────────────────────────
  const sorted       = [...all].sort((a, b) => Math.abs(b.xpts - b.total_points) - Math.abs(a.xpts - a.total_points));
  const biggestMisses = sorted.slice(0, 10);

  console.log('  TOP 10 BIGGEST MISSES');
  console.log(`  ${'Player'.padEnd(22)} ${'GW'.padStart(3)}  ${'xPts'.padStart(6)}  ${'Actual'.padStart(6)}  ${'Error'.padStart(7)}`);
  console.log(`  ${'─'.repeat(54)}`);
  for (const r of biggestMisses) {
    const err = r.xpts - r.total_points;
    const flag = err < 0 ? '↑ under' : '↓ over';
    console.log(`  ${r.name.slice(0, 22).padEnd(22)} ${String(r.gameweek).padStart(3)}  ${fmt(r.xpts).padStart(6)}  ${String(r.total_points).padStart(6)}  ${fmt(err, 2).padStart(7)} (${flag})`);
  }

  // ── 9. Save JSON report ────────────────────────────────────────────────────
  const report = {
    generatedAt:   new Date().toISOString(),
    gameweeks:     gameweeks,
    filters:       { gwRange, minMinutes },
    samples:       { all: all.length, filtered: N },
    overall: {
      mae:          overallMAE,
      rmse:         overallRMSE,
      bias:         overallBias,
      medianAE:     overallMed,
      r2:           overallR2,
      spearman:     overallSp,
      within1pt:    within1 / N,
      within2pt:    within2 / N,
      within3pt:    within3 / N,
      inRange:      inRange  / N,
    },
    byPosition:   posResults,
    byGameweek:   gwResults,
    calibration:  Object.fromEntries(
      calibTargets.map(({ label }, i) => [label, calibResults[label]])
    ),
    topNRanking:  rankResults,
    biggestMisses: biggestMisses.map(r => ({
      name:         r.name,
      gameweek:     r.gameweek,
      position:     posName[r.position],
      xpts:         r.xpts,
      actual:       r.total_points,
      error:        r.xpts - r.total_points,
      minutes:      r.minutes,
    })),
  };

  const outPath = path.join(__dirname, 'backtest-results.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n  ✓ Full report saved to: server/scripts/backtest-results.json\n`);

  await db.end();
}

run().catch(err => {
  console.error('\n  ✗ Error running backtest:', err.message);
  process.exit(1);
});
