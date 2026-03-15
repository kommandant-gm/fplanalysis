/**
 * FotMob Live Match Data Service
 * Fetches live scores from FotMob fixtures (works fine server-side).
 * Match details (events, stats, lineups) come from ESPN's public API
 * because FotMob's /matchDetails endpoint is blocked for server requests.
 */
const axios = require('axios');

const FOTMOB_BASES = [
  'https://www.fotmob.com/api',
  'https://api.fotmob.com',
];
const EPL_LEAGUE_ID = 47;
const ESPN_EPL_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.fotmob.com/',
  'Origin': 'https://www.fotmob.com',
};

async function getFotmob(paths, params = {}) {
  const pathList = Array.isArray(paths) ? paths : [paths];
  let lastErr = null;
  for (const path of pathList) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    for (const base of FOTMOB_BASES) {
      const url = `${base}${normalizedPath}`;
      try {
        const { data } = await axios.get(url, { params, headers: HEADERS, timeout: 15000 });
        return data;
      } catch (err) {
        lastErr = err;
        const status = err?.response?.status;
        const detail = status ? `HTTP ${status}` : (err?.code || err?.message || 'unknown');
        console.error(`[FotMob] ${url} → ${detail}`);
      }
    }
  }
  const errDetail = lastErr?.response?.status
    ? `HTTP ${lastErr.response.status}`
    : (lastErr?.code || lastErr?.message || 'unknown');
  throw new Error(`FotMob request failed for ${pathList.join(',')}: ${errDetail}`);
}

function parseStat(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  const n = parseFloat(String(val).replace('%', '').trim());
  return Number.isFinite(n) ? n : null;
}

// ─── Today's EPL matches ───────────────────────────────────────────────────

async function getTodayMatches(localDate = null) {
  let date = localDate;
  if (!date || !/^\d{8}$/.test(date)) {
    const today = new Date();
    date = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('');
  }

  const data = await getFotmob('/leagues', { id: EPL_LEAGUE_ID, tab: 'fixtures', ccode3: 'ENG' });

  if (typeof data === 'string') {
    throw new Error('FotMob returned an HTML page — request was blocked');
  }

  const rawMatches = data?.fixtures?.allMatches || [];

  const todayStr = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
  const prevDate = new Date(todayStr + 'T00:00:00Z');
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);
  const prevStr = prevDate.toISOString().slice(0, 10);

  const matches = rawMatches.filter(m => {
    const utc = m.status?.utcTime || '';
    return utc.startsWith(todayStr) || utc.startsWith(prevStr);
  });

  console.log(`[Live] allMatches total=${rawMatches.length}, today(${todayStr})+prev(${prevStr})=${matches.length}`);

  return matches.map(m => {
    const home = m.home || m.homeTeam || {};
    const away = m.away || m.awayTeam || {};
    const status = m.status || {};
    let homeScore = null, awayScore = null;
    const scoreStr = status.scoreStr || '';
    if (scoreStr) {
      const parts = scoreStr.split('-').map(s => parseInt(s.trim(), 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        homeScore = parts[0];
        awayScore = parts[1];
      }
    }
    return {
      matchId: String(m.id),
      pageUrl: m.pageUrl || null,
      homeTeam: {
        id: home.id,
        name: home.name || home.longName || 'Home',
        shortName: home.shortName || home.name || 'HOME',
      },
      awayTeam: {
        id: away.id,
        name: away.name || away.longName || 'Away',
        shortName: away.shortName || away.name || 'AWAY',
      },
      score: { home: homeScore, away: awayScore },
      status: status.finished ? 'finished' : status.started ? 'inProgress' : 'notStarted',
      minute: status.liveTime?.short || null,
      kickoff: status.utcTime || m.kickoff || null,
    };
  }).filter(m => m.matchId);
}

// ─── ESPN helpers ──────────────────────────────────────────────────────────

function normTeam(name) {
  return (name || '').toLowerCase().replace(/[^a-z]/g, '');
}

function teamsMatch(a, b) {
  const na = normTeam(a);
  const nb = normTeam(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Check first-4-char prefix overlap (handles "Man City" vs "Manchester City")
  const pa = na.slice(0, 4);
  const pb = nb.slice(0, 4);
  if (pa === pb) return true;
  // Word-level: any word ≥4 chars matches
  const wa = a.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
  const wb = b.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
  return wa.some(x => wb.some(y => x === y));
}

async function findESPNEvent(homeTeam, awayTeam) {
  const { data } = await axios.get(`${ESPN_EPL_BASE}/scoreboard`, { timeout: 10000 });
  const events = data?.events || [];

  for (const evt of events) {
    const comps = evt.competitions?.[0]?.competitors || [];
    const homeComp = comps.find(c => c.homeAway === 'home') || comps[0];
    const awayComp = comps.find(c => c.homeAway === 'away') || comps[1];
    if (!homeComp || !awayComp) continue;

    const espnHome = homeComp.team?.shortDisplayName || homeComp.team?.displayName || '';
    const espnAway = awayComp.team?.shortDisplayName || awayComp.team?.displayName || '';

    if (teamsMatch(homeTeam, espnHome) && teamsMatch(awayTeam, espnAway)) {
      return evt;
    }
    // Also try reversed (in case home/away is swapped)
    if (teamsMatch(homeTeam, espnAway) && teamsMatch(awayTeam, espnHome)) {
      return evt;
    }
  }
  return null;
}

async function getESPNSummary(eventId) {
  const { data } = await axios.get(`${ESPN_EPL_BASE}/summary`, {
    params: { event: eventId },
    timeout: 10000,
  });
  return data;
}

// ─── ESPN parsers ──────────────────────────────────────────────────────────

const ESPN_STAT_MAP = {
  possessionPct:        'possession',
  possession:           'possession',
  shotsTotal:           'shots',
  shots:                'shots',
  shotsOnTarget:        'shots on target',
  foulsCommitted:       'fouls',
  fouls:                'fouls',
  corners:              'corners',
  cornerKicks:          'corners',
  yellowCards:          'yellow cards',
  redCards:             'red cards',
  offsides:             'offsides',
  totalPasses:          'passes',
  passCompletionRate:   'pass accuracy',
  saves:                'saves',
  tackles:              'tackles',
  clearances:           'clearances',
  blockedShots:         'blocked shots',
  aerialWon:            'aerial duels won',
  bigChances:           'big chances',
  interceptions:        'interceptions',
  dribbles:             'dribbles',
};

function parseESPNStats(boxscoreTeams = [], homeTeamId, awayTeamId) {
  const result = {};
  const homeData = boxscoreTeams.find(t => String(t.team?.id) === String(homeTeamId)) || boxscoreTeams[0];
  const awayData = boxscoreTeams.find(t => String(t.team?.id) === String(awayTeamId)) || boxscoreTeams[1];
  if (!homeData || !awayData) return result;

  const homeStats = homeData.statistics || [];
  const awayStats = awayData.statistics || [];

  for (const stat of homeStats) {
    const key = ESPN_STAT_MAP[stat.name];
    if (!key) continue;
    const homeVal = parseFloat(stat.displayValue);
    const awayStat = awayStats.find(s => s.name === stat.name);
    const awayVal = parseFloat(awayStat?.displayValue ?? 'NaN');
    if (Number.isFinite(homeVal) && Number.isFinite(awayVal)) {
      result[key] = {
        home: homeVal,
        away: awayVal,
        isPercent: key.includes('possession') || key.includes('accuracy'),
      };
    }
  }
  return result;
}

function parseESPNEvents(commentary = []) {
  const events = [];
  for (const c of commentary) {
    const typeText = (c.type?.text || '').toLowerCase();
    const clockStr = c.clock?.displayValue || '';
    const minute = parseInt(clockStr) || 0;

    let type = null, isGoal = false, card = null, isPenalty = false, isOwnGoal = false;

    if (typeText === 'goal' || typeText === 'penalty - scored') {
      type = 'Goal'; isGoal = true; isPenalty = typeText.includes('penalty');
    } else if (typeText === 'own goal') {
      type = 'Goal'; isGoal = true; isOwnGoal = true;
    } else if (typeText === 'yellow card') {
      type = 'Card'; card = 'Yellow';
    } else if (typeText === 'red card') {
      type = 'Card'; card = 'Red';
    } else if (typeText === 'second yellow card') {
      type = 'Card'; card = 'YellowRed';
    } else if (typeText === 'substitution') {
      type = 'Substitution';
    } else if (typeText === 'penalty - missed') {
      type = 'MissedPenalty';
    }

    if (!type) continue;

    const teamId = String(c.team?.id || '');
    const parts = c.participants || [];

    let playerName = null, assistName = null, subIn = null, subOut = null;

    if (type === 'Substitution') {
      const enterP = parts.find(p => p.type === 'enter' || p.subrole === 'enter');
      const exitP = parts.find(p => p.type === 'exit' || p.subrole === 'exit');
      subIn = enterP?.athlete?.displayName || parts[0]?.athlete?.displayName || null;
      subOut = exitP?.athlete?.displayName || parts[1]?.athlete?.displayName || null;
    } else {
      playerName = parts[0]?.athlete?.displayName || null;
      assistName = isGoal ? (parts[1]?.athlete?.displayName || null) : null;
    }

    events.push({
      type, minute, addedMinute: null,
      teamId, playerName, playerId: null,
      assistName, card, subIn, subOut,
      isGoal, isPenalty, isOwnGoal, varOutcome: null,
    });
  }
  return events.sort((a, b) => a.minute - b.minute);
}

function parseESPNLineup(rosters = [], homeTeamId, awayTeamId) {
  const home = [], away = [];
  for (const r of rosters) {
    const teamId = String(r.team?.id || '');
    const side = teamId === String(homeTeamId) ? home : away;
    for (const p of r.roster || []) {
      const ath = p.athlete || {};
      if (!ath.id || !ath.displayName) continue;
      side.push({
        id: String(ath.id),
        name: ath.displayName,
        shirt: parseInt(ath.jersey) || null,
        position: ath.position?.abbreviation || null,
        isSub: !p.starter,
        rating: null, minutesPlayed: null,
        goals: 0, assists: 0,
        xg: null, xa: null, xgot: null,
        shots: null, shotsOnTarget: null,
        tackles: null, foulsCommitted: null,
        touches: null, passes: null,
        passAccuracy: null, dribbles: null, aerialDuels: null,
        heatmap: [],
      });
    }
  }
  return { confirmed: true, home, away };
}

function parseESPNMatch(summary, matchId) {
  const comp = summary?.header?.competitions?.[0] || {};
  const competitors = comp.competitors || [];

  const homeComp = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
  const awayComp = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};

  const statusName = comp.status?.type?.name || '';
  const status = comp.status?.type?.completed ? 'finished'
    : statusName === 'STATUS_IN_PROGRESS' ? 'inProgress'
    : 'notStarted';

  const homeTeamId = homeComp.team?.id;
  const awayTeamId = awayComp.team?.id;

  return {
    matchId: String(matchId),
    homeTeam: {
      id: homeTeamId,
      name: homeComp.team?.displayName || 'Home',
      logo: homeTeamId ? `https://a.espncdn.com/i/teamlogos/soccer/500/${homeTeamId}.png` : null,
      score: parseInt(homeComp.score) >= 0 ? parseInt(homeComp.score) : null,
    },
    awayTeam: {
      id: awayTeamId,
      name: awayComp.team?.displayName || 'Away',
      logo: awayTeamId ? `https://a.espncdn.com/i/teamlogos/soccer/500/${awayTeamId}.png` : null,
      score: parseInt(awayComp.score) >= 0 ? parseInt(awayComp.score) : null,
    },
    status,
    minute: comp.status?.displayClock || null,
    venue: summary?.gameInfo?.venue?.fullName || null,
    referee: null,
    events: parseESPNEvents(summary?.commentary || []),
    stats: parseESPNStats(summary?.boxscore?.teams || [], homeTeamId, awayTeamId),
    momentum: [],
    xgTimeline: { home: [], away: [] },
    lineup: parseESPNLineup(summary?.rosters || [], homeTeamId, awayTeamId),
    source: 'espn',
  };
}

// ─── Main match details ─────────────────────────────────────────────────────

async function getMatchDetails(matchId, homeTeam, awayTeam) {
  if (!homeTeam || !awayTeam) {
    throw new Error('Team names required to fetch match details');
  }

  const evt = await findESPNEvent(homeTeam, awayTeam);
  if (!evt) {
    throw new Error(`Match not found on ESPN: ${homeTeam} vs ${awayTeam}`);
  }

  const summary = await getESPNSummary(evt.id);
  return parseESPNMatch(summary, matchId);
}

module.exports = { getTodayMatches, getMatchDetails, getFotmobRaw: getFotmob };
