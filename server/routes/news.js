const express = require('express');
const axios   = require('axios');
const cheerio = require('cheerio');
const db      = require('../config/db');

const router = express.Router();

/* ── RSS cache (15-minute TTL) ────────────────────────────── */
let rssCache = { data: [], fetchedAt: 0 };
const RSS_TTL = 15 * 60 * 1000;

const RSS_FEEDS = [
  { url: 'https://feeds.bbci.co.uk/sport/football/rss.xml',             source: 'BBC Sport'   },
  { url: 'https://www.skysports.com/rss/12040',                          source: 'Sky Sports'  },
  { url: 'https://www.theguardian.com/football/premierleague/rss',        source: 'Guardian'    },
  { url: 'https://www.reddit.com/r/FantasyPL/top.rss?t=day&limit=20',    source: 'r/FantasyPL' },
  { url: 'https://www.reddit.com/r/FantasyPL/new.rss?limit=15',          source: 'r/FantasyPL' },
];

async function fetchFeed(url, source) {
  try {
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
    });
    const $ = cheerio.load(data, { xmlMode: true });
    const items = [];

    // RSS <item> and Atom <entry> both supported
    $('item, entry').each((_, el) => {
      const title   = $(el).find('title').first().text().trim();
      // <link> in RSS is text node; in Atom it's an href attribute
      const linkEl  = $(el).find('link').first();
      const link    = linkEl.text().trim() || linkEl.attr('href') || '';
      const pubDate = $(el).find('pubDate, published, updated').first().text().trim();
      const rawDesc = $(el).find('description, summary, content').first().text() || '';
      const description = rawDesc.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
      if (title && !title.toLowerCase().includes('privacy')) {
        items.push({ title, link, pubDate, description, source });
      }
    });

    console.log(`[News] ${source}: ${items.length} items from ${url}`);
    return items.slice(0, 15);
  } catch (err) {
    console.warn(`[News] RSS failed (${source}): ${err.message}`);
    return [];
  }
}

/* ── GET /api/news ────────────────────────────────────────── */
router.get('/', async (_req, res) => {
  try {
    /* 1 ── FPL injury / availability news from DB */
    const [rows] = await db.execute(`
      SELECT p.id, p.name, t.short_name AS team, p.position, p.status,
             p.chance_of_playing_next_round,
             p.chance_of_playing_this_round,
             p.news
      FROM   players p
      JOIN   teams t ON p.team_id = t.id
      WHERE  p.news IS NOT NULL AND TRIM(p.news) != ''
      ORDER  BY p.total_points DESC
      LIMIT  40
    `);

    console.log(`[News] Found ${rows.length} players with injury news`);

    const injuries = rows.map(p => ({
      id:         p.id,
      name:       p.name,
      team:       p.team_name,
      position:   p.position,
      status:     p.status || 'a',
      chanceNext: p.chance_of_playing_next_round,
      chanceThis: p.chance_of_playing_this_round,
      news:       p.news,
    }));

    /* 2 ── RSS feed (cached) */
    let feed = rssCache.data;
    if (Date.now() - rssCache.fetchedAt > RSS_TTL) {
      const results = await Promise.allSettled(
        RSS_FEEDS.map(f => fetchFeed(f.url, f.source))
      );
      const all = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
      // sort newest first
      all.sort((a, b) => {
        const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
        const db_ = b.pubDate ? new Date(b.pubDate).getTime() : 0;
        return db_ - da;
      });
      feed = all.slice(0, 24);
      rssCache = { data: feed, fetchedAt: Date.now() };
      console.log(`[News] RSS refreshed: ${feed.length} items`);
    }

    res.json({ injuries, feed });
  } catch (err) {
    console.error('[News] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
