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

function stdDev(values = []) {
  if (!values.length) return 0;
  const avg = mean(values);
  const variance = mean(values.map(v => (v - avg) ** 2));
  return Math.sqrt(variance);
}

function weightedBlend(parts, fallback = 0) {
  const valid = parts.filter((p) => p.value != null && Number.isFinite(p.value) && p.weight > 0);
  if (!valid.length) return fallback;
  const totalWeight = valid.reduce((sum, p) => sum + p.weight, 0);
  if (!totalWeight) return fallback;
  return valid.reduce((sum, p) => sum + (p.value * p.weight), 0) / totalWeight;
}

function parseMaybeJsonArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getMinutesFromFotmobMatch(match) {
  if (!match || typeof match !== 'object') return 0;
  if (match.minutes != null) return Math.max(0, toNum(match.minutes, 0));
  if (match.minutesPlayed != null) return Math.max(0, toNum(match.minutesPlayed, 0));
  return 0;
}

function buildRateProfile(minutes = []) {
  const sample = minutes.length;
  if (!sample) {
    return {
      sample: 0,
      startRate: 0,
      subOnRate: 0,
      cameoRate: 0,
      subOffRate: 0,
      lowMinuteRate: 0,
      benchRate: 0,
    };
  }

  const starts = minutes.filter(m => m >= 60).length;
  const subOn = minutes.filter(m => m > 0 && m < 60).length;
  const cameo = minutes.filter(m => m > 0 && m <= 30).length;
  const subOff = minutes.filter(m => m >= 60 && m < 90).length;
  const lowMins = minutes.filter(m => m > 0 && m < 45).length;
  const bench = minutes.filter(m => m <= 0).length;

  return {
    sample,
    startRate: starts / sample,
    subOnRate: subOn / sample,
    cameoRate: cameo / sample,
    subOffRate: subOff / sample,
    lowMinuteRate: lowMins / sample,
    benchRate: bench / sample,
  };
}

function buildMinutesRotationProfile({
  fplHistoryRows = [],
  fotmobMatches = [],
  fallbackMinsProb = 0.7,
  availability = 1,
} = {}) {
  const history = Array.isArray(fplHistoryRows)
    ? [...fplHistoryRows].sort((a, b) => toNum(b?.gameweek, 0) - toNum(a?.gameweek, 0))
    : [];
  const fplMinutesSeason = history.map(h => Math.max(0, toNum(h?.minutes, 0)));
  const fplMinutesRecent = fplMinutesSeason.slice(0, 8);
  const fplMinutesLast3 = fplMinutesSeason.slice(0, 3);

  const seasonRates = buildRateProfile(fplMinutesSeason);
  const recentRates = buildRateProfile(fplMinutesRecent);

  const avgFplMinutesSeason = seasonRates.sample ? mean(fplMinutesSeason) : null;
  const avgFplMinutesRecent = recentRates.sample ? mean(fplMinutesRecent) : null;
  const avgFplMinutesLast3 = fplMinutesLast3.length ? mean(fplMinutesLast3) : null;
  const minsVolatility = stdDev(fplMinutesRecent.length >= 3 ? fplMinutesRecent : fplMinutesSeason);

  const parsedFotmob = parseMaybeJsonArray(fotmobMatches);
  const fotmobMinutes = parsedFotmob.map(getMinutesFromFotmobMatch).filter(m => m >= 0);
  const fotmobSample = fotmobMinutes.length;
  const avgFotmobMinutes = fotmobSample ? mean(fotmobMinutes) : null;
  const fotmobLowMinsRate = fotmobSample
    ? (fotmobMinutes.filter(m => m > 0 && m < 45).length / fotmobSample)
    : 0;

  // Hard gate: player has never played this season and has no FotMob data.
  // Skip all further computation and return a zeroed sentinel.
  const totalFplMins = fplMinutesSeason.reduce((s, m) => s + m, 0);
  if (totalFplMins === 0 && fotmobSample === 0) {
    return {
      fplSample: 0,
      fotmobSample: 0,
      avgFplMinutes: 0,
      avgFplMinutesRecent: 0,
      avgFplMinutesLast3: 0,
      avgFotmobMinutes: null,
      avgMinutesCombined: 0,
      minsVolatility: 0,
      startRate: 0,
      subOnRate: 0,
      cameoRate: 0,
      subOffRate: 0,
      lowMinuteRate: 0,
      benchRate: 1,
      baseMinsProb: 0,
      minsProb: 0,
      rotationRisk: 99,
      trendDrop: 0,
      zeroed: true,
    };
  }

  const startRate = clamp(
    weightedBlend(
      [
        { value: recentRates.startRate, weight: 0.58 },
        { value: seasonRates.startRate, weight: 0.42 },
      ],
      seasonRates.startRate
    ),
    0,
    1
  );
  const subOnRate = clamp(
    weightedBlend(
      [
        { value: recentRates.subOnRate, weight: 0.58 },
        { value: seasonRates.subOnRate, weight: 0.42 },
      ],
      seasonRates.subOnRate
    ),
    0,
    1
  );
  const cameoRate = clamp(
    weightedBlend(
      [
        { value: recentRates.cameoRate, weight: 0.58 },
        { value: seasonRates.cameoRate, weight: 0.42 },
      ],
      seasonRates.cameoRate
    ),
    0,
    1
  );
  const subOffRate = clamp(
    weightedBlend(
      [
        { value: recentRates.subOffRate, weight: 0.55 },
        { value: seasonRates.subOffRate, weight: 0.45 },
      ],
      seasonRates.subOffRate
    ),
    0,
    1
  );

  const lowMinuteRate = clamp(
    weightedBlend(
      [
        { value: recentRates.lowMinuteRate, weight: 0.55 },
        { value: seasonRates.lowMinuteRate, weight: 0.45 },
      ],
      seasonRates.lowMinuteRate
    ),
    0,
    1
  );
  const benchRate = clamp(
    weightedBlend(
      [
        { value: recentRates.benchRate, weight: 0.5 },
        { value: seasonRates.benchRate, weight: 0.5 },
      ],
      seasonRates.benchRate
    ),
    0,
    1
  );

  const baseMinsProb = clamp(
    weightedBlend(
      [
        { value: avgFplMinutesLast3 != null ? (avgFplMinutesLast3 / 90) : null, weight: 0.24 },
        { value: avgFplMinutesRecent != null ? (avgFplMinutesRecent / 90) : null, weight: 0.34 },
        { value: avgFplMinutesSeason != null ? (avgFplMinutesSeason / 90) : null, weight: 0.27 },
        { value: avgFotmobMinutes != null ? (avgFotmobMinutes / 90) : null, weight: 0.15 },
      ],
      clamp(toNum(fallbackMinsProb, 0.7), 0.03, 1)
    ),
    0.03,
    1
  );

  const trendDrop = (avgFplMinutesSeason != null && avgFplMinutesLast3 != null)
    ? Math.max(0, avgFplMinutesSeason - avgFplMinutesLast3)
    : 0;
  const trendPenalty = clamp(trendDrop / 32, 0, 0.35);

  const rotationRisk = clamp(
    ((1 - startRate) * 48) +
    (subOnRate * 17) +
    (cameoRate * 15) +
    (subOffRate * 9) +
    (lowMinuteRate * 12) +
    (benchRate * 11) +
    (clamp(minsVolatility / 16, 0, 1) * 10) +
    (trendPenalty * 30) +
    (fotmobLowMinsRate * 8),
    1,
    99
  );

  const availabilityClamped = clamp(toNum(availability, 1), 0, 1);
  const riskMultiplier = clamp(1 - (rotationRisk * 0.0024), 0.72, 1);
  const minsProb = clamp(baseMinsProb * riskMultiplier * availabilityClamped, 0.03, 1);

  const avgMinutesCombined = weightedBlend(
    [
      { value: avgFplMinutesRecent, weight: 0.45 },
      { value: avgFplMinutesSeason, weight: 0.35 },
      { value: avgFotmobMinutes, weight: 0.20 },
    ],
    avgFplMinutesSeason ?? avgFotmobMinutes ?? 0
  );

  return {
    fplSample: seasonRates.sample,
    fotmobSample,
    avgFplMinutes: avgFplMinutesSeason,
    avgFplMinutesRecent,
    avgFplMinutesLast3,
    avgFotmobMinutes,
    avgMinutesCombined,
    minsVolatility,
    startRate,
    subOnRate,
    cameoRate,
    subOffRate,
    lowMinuteRate,
    benchRate,
    baseMinsProb,
    minsProb,
    rotationRisk,
    trendDrop,
    zeroed: false,
  };
}

module.exports = {
  buildMinutesRotationProfile,
};

