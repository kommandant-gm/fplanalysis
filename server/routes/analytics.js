const express = require('express');
const router = express.Router();
const db = require('../config/db');

function normalizeText(value, max = 255) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  return v.slice(0, max);
}

function getIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  return normalizeText(req.socket?.remoteAddress || '', 64);
}

async function upsertSession({ sessionId, path, userAgent, referrer, ip, incrementVisit = false }) {
  await db.execute(
    `INSERT INTO analytics_sessions (
      session_id, first_path, last_path, user_agent, last_referrer, last_ip, first_seen, last_seen, visit_count
    ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)
    ON DUPLICATE KEY UPDATE
      last_seen = NOW(),
      last_path = VALUES(last_path),
      user_agent = COALESCE(VALUES(user_agent), user_agent),
      last_referrer = COALESCE(VALUES(last_referrer), last_referrer),
      last_ip = COALESCE(VALUES(last_ip), last_ip),
      visit_count = visit_count + ?`,
    [sessionId, path, path, userAgent, referrer, ip, incrementVisit ? 1 : 0, incrementVisit ? 1 : 0]
  );
}

// POST /api/analytics/pageview
router.post('/pageview', async (req, res) => {
  try {
    const sessionId = normalizeText(req.body?.sessionId, 64);
    const path = normalizeText(req.body?.path, 255);
    if (!sessionId || !path) {
      return res.status(400).json({ success: false, error: 'sessionId and path are required' });
    }

    const title = normalizeText(req.body?.title, 255);
    const referrer = normalizeText(req.body?.referrer, 255);
    const viewport = normalizeText(req.body?.viewport, 32);
    const userAgent = normalizeText(req.headers['user-agent'] || '', 255);
    const ip = getIp(req);

    await upsertSession({
      sessionId,
      path,
      userAgent,
      referrer,
      ip,
      incrementVisit: true,
    });

    await db.execute(
      `INSERT INTO analytics_pageviews (
        session_id, path, title, referrer, user_agent, ip, viewport
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, path, title, referrer, userAgent, ip, viewport]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[ANALYTICS] pageview error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/analytics/heartbeat
router.post('/heartbeat', async (req, res) => {
  try {
    const sessionId = normalizeText(req.body?.sessionId, 64);
    const path = normalizeText(req.body?.path, 255);
    if (!sessionId || !path) {
      return res.status(400).json({ success: false, error: 'sessionId and path are required' });
    }

    const userAgent = normalizeText(req.headers['user-agent'] || '', 255);
    const ip = getIp(req);

    await upsertSession({
      sessionId,
      path,
      userAgent,
      referrer: null,
      ip,
      incrementVisit: false,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[ANALYTICS] heartbeat error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/analytics/summary
router.get('/summary', async (_req, res) => {
  try {
    const parsedWindow = Number.parseInt(process.env.ANALYTICS_ACTIVE_WINDOW_SECONDS, 10);
    const activeWindowSec = Number.isFinite(parsedWindow)
      ? Math.max(30, Math.min(parsedWindow, 3600))
      : 120;

    const [totalVisitsRows] = await db.execute(
      'SELECT COUNT(*) AS totalVisits FROM analytics_pageviews'
    );
    const [uniqueSessionsRows] = await db.execute(
      'SELECT COUNT(*) AS totalSessions FROM analytics_sessions'
    );
    const [activeRows] = await db.execute(
      `SELECT COUNT(*) AS activeNow
       FROM analytics_sessions
       WHERE last_seen >= DATE_SUB(NOW(), INTERVAL ${activeWindowSec} SECOND)`
    );
    const [pageRows] = await db.execute(
      `SELECT
         path,
         COUNT(*) AS views,
         COUNT(DISTINCT session_id) AS uniqueVisitors,
         MAX(created_at) AS lastVisited
       FROM analytics_pageviews
       GROUP BY path
       ORDER BY views DESC, path ASC
       LIMIT 20`
    );
    const [recentRows] = await db.execute(
      `SELECT
         path,
         session_id AS sessionId,
         created_at AS createdAt
       FROM analytics_pageviews
       ORDER BY id DESC
       LIMIT 20`
    );

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      activeWindowSec,
      stats: {
        activeNow: Number(activeRows[0]?.activeNow || 0),
        totalVisits: Number(totalVisitsRows[0]?.totalVisits || 0),
        totalSessions: Number(uniqueSessionsRows[0]?.totalSessions || 0),
      },
      pages: pageRows,
      recent: recentRows,
    });
  } catch (err) {
    console.error('[ANALYTICS] summary error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
