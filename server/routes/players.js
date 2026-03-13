const express = require('express');
const router  = express.Router();
const db      = require('../config/db');

// GET /api/players?pos=MID&sort=xpts&gw=30
router.get('/', async (req, res) => {
  try {
    const { pos, sort = 'xpts', gw } = req.query;

    // Get next GW if not specified
    let gameweek = parseInt(gw);
    if (!gameweek) {
      const [rows] = await db.execute(
        'SELECT MIN(gameweek) as nextGW FROM predictions'
      );
      gameweek = rows[0].nextGW || 1;
    }

    const posMap = { GKP: 1, DEF: 2, MID: 3, FWD: 4 };
    const posFilter = pos && posMap[pos] ? `AND p.position = ${posMap[pos]}` : '';

    const sortCol = sort === 'form' ? 'p.form' : 'pr.xpts';

    const [players] = await db.execute(`
      SELECT
        p.id, p.name, p.price, p.form, p.total_points,
        p.goals_scored, p.assists, p.clean_sheets,
        p.selected_by_percent, p.minutes,
        p.last_gw_points, p.last_gw_minutes,
        p.avg_points_last3, p.avg_points_last6,
        p.avg_minutes_last3, p.avg_minutes_last6,
        p.position,
        t.short_name AS team,
        pr.xpts, pr.likely_pts, pr.min_pts, pr.max_pts,
        pr.xg_prob, pr.xa_prob, pr.cs_prob, pr.mins_prob,
        pr.avg_bonus, pr.fdr,
        pr.gameweek
      FROM players p
      JOIN teams t ON p.team_id = t.id
      LEFT JOIN predictions pr ON p.id = pr.player_id AND pr.gameweek = ?
      WHERE 1=1 ${posFilter}
      ORDER BY ${sortCol} DESC
      LIMIT 50
    `, [gameweek]);

    res.json({ success: true, gameweek, data: players });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/players/:id — full player detail with predictions + FotMob data
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    const [playerRows] = await db.execute(`
      SELECT
        p.*, t.name AS team_name, t.short_name AS team,
        fd.season_rating, fd.xg_total, fd.xa_total, fd.xgot_total,
        fd.matches_played AS fotmob_matches,
        fd.recent_matches, fd.heatmap_touches
      FROM players p
      JOIN teams t ON p.team_id = t.id
      LEFT JOIN player_fotmob_data fd ON p.id = fd.player_id
      WHERE p.id = ?
    `, [id]);

    if (!playerRows.length) {
      return res.status(404).json({ success: false, error: 'Player not found' });
    }

    const player = playerRows[0];

    // Parse JSON columns returned as strings by MySQL
    if (typeof player.recent_matches === 'string')  player.recent_matches  = JSON.parse(player.recent_matches);
    if (typeof player.heatmap_touches === 'string') player.heatmap_touches = JSON.parse(player.heatmap_touches);

    const [predictions] = await db.execute(
      'SELECT * FROM predictions WHERE player_id = ? ORDER BY gameweek ASC',
      [id]
    );

    res.json({ success: true, data: { ...player, predictions } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
