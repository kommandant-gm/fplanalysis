const express = require('express');
const { getTodayMatches, getMatchDetails } = require('../services/fotmobLive');

const router = express.Router();

// GET /api/live/matches?date=YYYYMMDD — today's EPL matches with live status
// date param is the browser's local date so timezone differences don't cause mismatch
router.get('/matches', async (req, res) => {
  try {
    const { date } = req.query; // optional YYYYMMDD from client
    const matches = await getTodayMatches(date || null);
    res.json({ success: true, matches });
  } catch (err) {
    console.error('[Live] Failed to fetch matches:', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// GET /api/live/matchraw/:matchId — raw FotMob response for debugging
router.get('/matchraw/:matchId', async (req, res) => {
  const { matchId } = req.params;
  if (!matchId || !/^\d+$/.test(matchId)) return res.status(400).json({ error: 'Invalid match ID' });
  try {
    const { getFotmobRaw } = require('../services/fotmobLive');
    const data = await getFotmobRaw(['/matchDetails', '/matchdetails', '/match'], { matchId }, true);
    const topKeys = typeof data === 'object' ? Object.keys(data) : 'string:' + String(data).slice(0, 100);
    const headerKeys = data?.header ? Object.keys(data.header) : null;
    const contentKeys = data?.content ? Object.keys(data.content) : null;
    res.json({ topKeys, headerKeys, contentKeys, headerSample: data?.header });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/live/match/:matchId?home=TeamName&away=TeamName — full live data for a match
router.get('/match/:matchId', async (req, res) => {
  const { matchId } = req.params;
  const { home, away } = req.query;
  if (!matchId || !/^\d+$/.test(matchId)) {
    return res.status(400).json({ success: false, error: 'Invalid match ID' });
  }
  try {
    const data = await getMatchDetails(matchId, home, away);
    res.json({ success: true, data });
  } catch (err) {
    console.error(`[Live] Failed to fetch match ${matchId}:`, err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// GET /api/live/debug?date=YYYYMMDD — inspect raw FotMob fixtures response
router.get('/debug', async (req, res) => {
  try {
    const { getFotmobRaw } = require('../services/fotmobLive');
    const { date } = req.query;
    const d = date || (() => {
      const n = new Date();
      return [n.getFullYear(), String(n.getMonth()+1).padStart(2,'0'), String(n.getDate()).padStart(2,'0')].join('');
    })();
    const data = await getFotmobRaw('/leagues', { id: 47, tab: 'fixtures', ccode3: 'ENG' });
    if (typeof data === 'string') {
      return res.json({ blocked: true, preview: data.slice(0, 300) });
    }
    const topKeys = Object.keys(data || {});
    const fixturesObj = data?.fixtures;
    const fixturesKeys = fixturesObj ? Object.keys(fixturesObj) : [];
    const allFixturesKeys = fixturesObj?.allFixtures ? Object.keys(fixturesObj.allFixtures) : [];
    const fixtureList =
      fixturesObj?.allFixtures?.fixtures ||
      fixturesObj?.fixtures ||
      fixturesObj?.allMatches ||
      fixturesObj?.matches ||
      [];
    const allMatches = data?.fixtures?.allMatches || [];
    // Find any finished match to inspect score field structure
    const finishedMatch = allMatches.find(m => m.status?.finished === true);
    const startedMatch = allMatches.find(m => m.status?.started === true && !m.status?.finished);
    res.json({ totalMatches: allMatches.length, finishedMatch, startedMatch });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
