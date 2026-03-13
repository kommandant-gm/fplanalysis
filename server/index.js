require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { syncFPLData } = require('./services/fplFetcher');
const db = require('./config/db');

// Add new columns to existing tables without requiring a full DB reset
async function runMigrations() {
  const dbName = process.env.DB_NAME || 'fpl_analysis';

  async function addColumnIfMissing(table, column, definition) {
    const [rows] = await db.execute(
      `SELECT 1
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
       LIMIT 1`,
      [dbName, table, column]
    );
    if (!rows.length) {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  await addColumnIfMissing('players', 'xg', 'DECIMAL(5,3) DEFAULT NULL');
  await addColumnIfMissing('players', 'xa', 'DECIMAL(5,3) DEFAULT NULL');
  await addColumnIfMissing('players', 'fotmob_id', 'INT DEFAULT NULL');
  await addColumnIfMissing('players', 'status', "CHAR(1) DEFAULT 'a'");
  await addColumnIfMissing('players', 'chance_of_playing_next_round', 'TINYINT DEFAULT NULL');
  await addColumnIfMissing('players', 'chance_of_playing_this_round', 'TINYINT DEFAULT NULL');
  await addColumnIfMissing('players', 'news', 'VARCHAR(255) DEFAULT NULL');
  await addColumnIfMissing('players', 'penalties_order', 'TINYINT DEFAULT NULL');
  await addColumnIfMissing('players', 'direct_freekicks_order', 'TINYINT DEFAULT NULL');
  await addColumnIfMissing('players', 'corners_and_indirect_freekicks_order', 'TINYINT DEFAULT NULL');
  await addColumnIfMissing('players', 'last_gw_points', 'INT DEFAULT NULL');
  await addColumnIfMissing('players', 'last_gw_minutes', 'INT DEFAULT NULL');
  await addColumnIfMissing('players', 'avg_points_last3', 'DECIMAL(5,2) DEFAULT NULL');
  await addColumnIfMissing('players', 'avg_points_last6', 'DECIMAL(5,2) DEFAULT NULL');
  await addColumnIfMissing('players', 'avg_minutes_last3', 'DECIMAL(6,2) DEFAULT NULL');
  await addColumnIfMissing('players', 'avg_minutes_last6', 'DECIMAL(6,2) DEFAULT NULL');

  await addColumnIfMissing('fixtures', 'kickoff_time', 'DATETIME DEFAULT NULL');
  await addColumnIfMissing('fixtures', 'finished', 'BOOLEAN DEFAULT FALSE');
  await addColumnIfMissing('fixtures', 'score_home', 'TINYINT DEFAULT NULL');
  await addColumnIfMissing('fixtures', 'score_away', 'TINYINT DEFAULT NULL');

  await db.execute(
    `CREATE TABLE IF NOT EXISTS player_fotmob_data (
      player_id      INT PRIMARY KEY,
      fotmob_id      INT DEFAULT NULL,
      season_rating  DECIMAL(4,2) DEFAULT NULL,
      xg_total       DECIMAL(6,3) DEFAULT NULL,
      xa_total       DECIMAL(6,3) DEFAULT NULL,
      xgot_total     DECIMAL(6,3) DEFAULT NULL,
      matches_played INT DEFAULT 0,
      recent_matches JSON DEFAULT NULL,
      heatmap_touches JSON DEFAULT NULL,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (player_id) REFERENCES players(id)
    )`
  );

  await db.execute(
    `CREATE TABLE IF NOT EXISTS player_gameweek_history (
      player_id         INT NOT NULL,
      gameweek          INT NOT NULL,
      opponent_team_id  INT DEFAULT NULL,
      was_home          BOOLEAN DEFAULT FALSE,
      total_points      INT DEFAULT 0,
      minutes           INT DEFAULT 0,
      goals_scored      TINYINT DEFAULT 0,
      assists           TINYINT DEFAULT 0,
      clean_sheets      TINYINT DEFAULT 0,
      expected_goals    DECIMAL(6,3) DEFAULT NULL,
      expected_assists  DECIMAL(6,3) DEFAULT NULL,
      kickoff_time      DATETIME DEFAULT NULL,
      updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (player_id, gameweek),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )`
  );

  console.log('[DB] Migrations complete');
}

const playersRoute     = require('./routes/players');
const predictionsRoute = require('./routes/predictions');
const fixturesRoute    = require('./routes/fixtures');
const newsRoute        = require('./routes/news');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/players', playersRoute);
app.use('/api/predictions', predictionsRoute);
app.use('/api/fixtures', fixturesRoute);
app.use('/api/news', newsRoute);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Manual sync trigger
app.post('/api/sync', async (_req, res) => {
  try {
    await syncFPLData();
    res.json({ success: true, message: 'FPL data synced successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Weekly cron: every Thursday at 8am (after FPL updates)
cron.schedule('0 8 * * 4', async () => {
  console.log('[CRON] Running weekly FPL data sync...');
  await syncFPLData();
});

runMigrations().then(() => {
  app.listen(PORT, () => {
    console.log(`FPL Analysis server running on http://localhost:${PORT}`);
  });
});
