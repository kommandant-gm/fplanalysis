const axios = require('axios');
const db = require('../config/db');

const FOTMOB_BASES = [
  'https://www.fotmob.com/api',
  'https://api.fotmob.com',
];
const EPL_LEAGUE_ID = 47;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.fotmob.com/',
  'Origin': 'https://www.fotmob.com',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function lastName(name) {
  const parts = normalizeName(name).split(' ');
  return parts[parts.length - 1];
}

async function get(url, params = {}) {
  const { data } = await axios.get(url, { params, headers: HEADERS, timeout: 15000 });
  return data;
}

function endpointError(err) {
  const status = err?.response?.status;
  if (status) return `HTTP ${status}`;
  return err?.message || 'unknown error';
}

async function getFotmob(paths, params = {}) {
  const pathList = Array.isArray(paths) ? paths : [paths];
  const attempts = [];
  let lastErr = null;

  for (const path of pathList) {
    for (const base of FOTMOB_BASES) {
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      const url = `${base}${normalizedPath}`;
      try {
        return await get(url, params);
      } catch (err) {
        lastErr = err;
        attempts.push(`${url} -> ${endpointError(err)}`);
      }
    }
  }

  const detail = attempts.slice(0, 6).join(' | ');
  throw new Error(`All FotMob endpoints failed${detail ? `: ${detail}` : `: ${endpointError(lastErr)}`}`);
}

async function getEPLTeams() {
  const data = await getFotmob(['/leagues'], { id: EPL_LEAGUE_ID, ccode3: 'ENG' });

  const all =
    data?.table?.[0]?.data?.table?.all ||
    data?.table?.data?.table?.all ||
    data?.table?.all ||
    data?.all ||
    data?.teams ||
    data?.league?.table?.all ||
    [];

  const teams = (Array.isArray(all) ? all : [])
    .map(t => {
      const id = t?.id ?? t?.teamId ?? t?.team?.id;
      const name = t?.name || t?.shortName || t?.team?.name || t?.team?.shortName;
      return (id && name) ? { fotmobId: String(id), name } : null;
    })
    .filter(Boolean);

  if (!teams.length) {
    throw new Error('Could not parse EPL teams from FotMob league response');
  }

  return teams;
}

async function getTeamSquad(fotmobTeamId) {
  const data = await getFotmob(['/teams'], { id: fotmobTeamId, tab: 'squad', ccode3: 'ENG' });

  const groups =
    (Array.isArray(data?.squad) ? data.squad : null) ||
    (Array.isArray(data?.squadData?.squad) ? data.squadData.squad : null) ||
    [];

  const members = [];
  for (const group of groups) {
    const list = group.members || group.players || group.squadMembers || [];
    for (const p of list) {
      if (p.id && p.name) {
        members.push({
          fotmobId: String(p.id),
          name: p.name,
          cname: p.cname || p.name,
          position: group.title || '',
        });
      }
    }
  }

  return members;
}

async function fetchPlayerData(fotmobId) {
  return getFotmob(['/playerData', '/playerdata'], { id: fotmobId });
}

function parseStatItems(items = []) {
  const map = {};
  for (const item of items) {
    const key = (item.title || item.key || '').toLowerCase();
    const val = parseFloat(item.value || item.stat?.value || 0) || null;
    if (key) map[key] = val;
  }
  return map;
}

function parseHeatmap(data) {
  const raw =
    data?.heatmap?.data ||
    data?.heatmap?.touches ||
    data?.heatmap ||
    null;

  if (!raw || !Array.isArray(raw)) return null;

  return raw
    .slice(0, 500)
    .map(p => {
      if (Array.isArray(p)) return { x: p[0], y: p[1] };
      return { x: p.x ?? p[0], y: p.y ?? p[1] };
    })
    .filter(p => p.x != null && p.y != null);
}

function pickNumeric(row, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    const num = parseFloat(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function parseRecentMatches(recentMatches = []) {
  return recentMatches.slice(0, 10).map(m => ({
    // Keep broad key matching because FotMob payload keys vary by endpoint/version.
    matchId: m.matchId || m.id,
    opponentId: m.opponentTeamId,
    opponentName: m.opponentTeamName || null,
    minutes: m.minutesPlayed ?? m.minutes ?? null,
    rating: parseFloat(m.rating?.num || m.rating || 0) || null,
    goals: m.goals ?? null,
    assists: m.assists ?? null,
    xg: parseFloat(m.expectedGoals || m.xg || 0) || null,
    xa: parseFloat(m.expectedAssists || m.xa || 0) || null,
    xgot: parseFloat(m.expectedGoalsOnTarget || m.xgot || 0) || null,
    shots: pickNumeric(m, ['shots', 'shotsTotal', 'totalShots', 'shots_attempted', 'shotAttempts', 'attemptedShots']),
    shotsOnTarget: pickNumeric(m, ['shotsOnTarget', 'shots_on_target', 'onTargetShots', 'shotsOT', 'sot']),
    bigChances: pickNumeric(m, ['bigChances', 'big_chances', 'bigChance']),
  }));
}

async function syncOnePlayerFromFotmob(playerId, playerName, fotmobId) {
  const data = await fetchPlayerData(fotmobId);

  const statItems = data?.statsSection?.items || data?.stats?.items || [];
  const stats = parseStatItems(statItems);

  const xgTotal = stats['expected goals (xg)'] ?? stats['expected_goals'] ?? null;
  const xaTotal = stats['expected assists (xa)'] ?? stats['expected_assists'] ?? null;
  const xgotTotal = stats['expected goals on target (xgot)'] ?? stats['expected_goals_on_target'] ?? null;
  const rating = stats['season rating'] ?? stats['rating'] ?? null;

  const recentMatches = data?.recentMatches || data?.matchHistory?.items || [];
  const matchCount = recentMatches.length || 1;
  const xgPerGame = xgTotal != null ? parseFloat((xgTotal / matchCount).toFixed(4)) : null;
  const xaPerGame = xaTotal != null ? parseFloat((xaTotal / matchCount).toFixed(4)) : null;

  if (xgPerGame != null || xaPerGame != null) {
    await db.execute(
      'UPDATE players SET xg = COALESCE(?, xg), xa = COALESCE(?, xa) WHERE id = ?',
      [xgPerGame, xaPerGame, playerId]
    );
  }

  const heatmapTouches = parseHeatmap(data);
  const parsedMatches = parseRecentMatches(recentMatches);

  await db.execute(
    `INSERT INTO player_fotmob_data
       (player_id, fotmob_id, season_rating, xg_total, xa_total, xgot_total,
        matches_played, recent_matches, heatmap_touches)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       fotmob_id=VALUES(fotmob_id),
       season_rating=VALUES(season_rating),
       xg_total=VALUES(xg_total),
       xa_total=VALUES(xa_total),
       xgot_total=VALUES(xgot_total),
       matches_played=VALUES(matches_played),
       recent_matches=VALUES(recent_matches),
       heatmap_touches=VALUES(heatmap_touches),
       updated_at=CURRENT_TIMESTAMP`,
    [
      playerId,
      fotmobId,
      rating,
      xgTotal,
      xaTotal,
      xgotTotal,
      parsedMatches.length,
      JSON.stringify(parsedMatches),
      heatmapTouches ? JSON.stringify(heatmapTouches) : null,
    ]
  );

  return { playerName, fotmobId, parsedMatchesCount: parsedMatches.length };
}

async function syncKnownFotmobIdsFallback() {
  const [players] = await db.execute(
    `SELECT id, name, fotmob_id
     FROM players
     WHERE fotmob_id IS NOT NULL
     ORDER BY total_points DESC
     LIMIT 100`
  );

  if (!players.length) {
    console.warn('[FotMob] No saved fotmob_id values found for fallback sync.');
    return 0;
  }

  let fetched = 0;
  for (const p of players) {
    try {
      await syncOnePlayerFromFotmob(p.id, p.name, p.fotmob_id);
      fetched++;
      await sleep(300);
    } catch (err) {
      console.warn(`[FotMob] fallback playerData failed for ${p.name} (${p.fotmob_id}): ${err.message}`);
    }
  }

  console.log(`[FotMob] Fallback sync fetched data for ${fetched}/${players.length} players`);
  return fetched;
}

async function syncFotMobData() {
  console.log('[FotMob] Starting full player data sync...');

  let teams;
  try {
    teams = await getEPLTeams();
    console.log(`[FotMob] Found ${teams.length} EPL teams`);
  } catch (err) {
    console.warn('[FotMob] Could not fetch EPL teams; trying fallback by saved fotmob_id:', err.message);
    await syncKnownFotmobIdsFallback();
    return;
  }

  const fotmobByNorm = {};
  const fotmobByLast = {};

  for (const team of teams) {
    try {
      const squad = await getTeamSquad(team.fotmobId);
      for (const p of squad) {
        const norm = normalizeName(p.name);
        const last = lastName(p.name);
        fotmobByNorm[norm] = p.fotmobId;
        if (!fotmobByLast[last]) fotmobByLast[last] = p.fotmobId;
      }
      await sleep(250);
    } catch (err) {
      console.warn(`[FotMob] Squad fetch failed for team ${team.fotmobId}: ${err.message}`);
    }
  }

  console.log(`[FotMob] Squad map built: ${Object.keys(fotmobByNorm).length} players`);

  const [fplPlayers] = await db.execute(
    'SELECT id, name FROM players ORDER BY total_points DESC LIMIT 200'
  );

  let matched = 0;
  let fetched = 0;

  for (const player of fplPlayers) {
    const norm = normalizeName(player.name);
    const last = lastName(player.name);
    const fotmobId = fotmobByNorm[norm] || fotmobByLast[last] || null;

    if (!fotmobId) continue;
    matched++;

    await db.execute('UPDATE players SET fotmob_id = ? WHERE id = ?', [fotmobId, player.id]);

    try {
      await syncOnePlayerFromFotmob(player.id, player.name, fotmobId);
      fetched++;
      await sleep(300);
    } catch (err) {
      console.warn(`[FotMob] playerData failed for ${player.name} (${fotmobId}): ${err.message}`);
    }
  }

  console.log(`[FotMob] Matched ${matched} players, fetched data for ${fetched}`);
}

module.exports = { syncFotMobData };
