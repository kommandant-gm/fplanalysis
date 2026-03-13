CREATE DATABASE IF NOT EXISTS fpl_analysis;
USE fpl_analysis;

CREATE TABLE IF NOT EXISTS teams (
  id          INT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  short_name  VARCHAR(10)  NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id                  INT PRIMARY KEY,
  name                VARCHAR(150) NOT NULL,
  team_id             INT NOT NULL,
  position            TINYINT NOT NULL COMMENT '1=GKP 2=DEF 3=MID 4=FWD',
  price               DECIMAL(4,1) NOT NULL,
  total_points        INT DEFAULT 0,
  form                DECIMAL(4,1) DEFAULT 0,
  minutes             INT DEFAULT 0,
  goals_scored        INT DEFAULT 0,
  assists             INT DEFAULT 0,
  clean_sheets        INT DEFAULT 0,
  selected_by_percent DECIMAL(5,1) DEFAULT 0,
  xg                  DECIMAL(5,3) DEFAULT NULL COMMENT 'FotMob xG per game',
  xa                  DECIMAL(5,3) DEFAULT NULL COMMENT 'FotMob xA per game',
  fotmob_id           INT DEFAULT NULL,
  status              CHAR(1) DEFAULT 'a' COMMENT 'FPL availability: a,d,i,s,u,n',
  chance_of_playing_next_round TINYINT DEFAULT NULL,
  chance_of_playing_this_round TINYINT DEFAULT NULL,
  news                VARCHAR(255) DEFAULT NULL,
  penalties_order     TINYINT DEFAULT NULL,
  direct_freekicks_order TINYINT DEFAULT NULL,
  corners_and_indirect_freekicks_order TINYINT DEFAULT NULL,
  last_gw_points      INT DEFAULT NULL COMMENT 'Most recent completed GW points',
  last_gw_minutes     INT DEFAULT NULL COMMENT 'Most recent completed GW minutes',
  avg_points_last3    DECIMAL(5,2) DEFAULT NULL,
  avg_points_last6    DECIMAL(5,2) DEFAULT NULL,
  avg_minutes_last3   DECIMAL(6,2) DEFAULT NULL,
  avg_minutes_last6   DECIMAL(6,2) DEFAULT NULL,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS fixtures (
  id               INT PRIMARY KEY,
  gameweek         INT NOT NULL,
  team_home_id     INT NOT NULL,
  team_away_id     INT NOT NULL,
  difficulty_home  TINYINT DEFAULT 3,
  difficulty_away  TINYINT DEFAULT 3,
  kickoff_time     DATETIME DEFAULT NULL,
  finished         BOOLEAN DEFAULT FALSE,
  score_home       TINYINT DEFAULT NULL,
  score_away       TINYINT DEFAULT NULL,
  FOREIGN KEY (team_home_id) REFERENCES teams(id),
  FOREIGN KEY (team_away_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS player_fotmob_data (
  player_id       INT PRIMARY KEY,
  fotmob_id       INT DEFAULT NULL,
  season_rating   DECIMAL(4,2) DEFAULT NULL,
  xg_total        DECIMAL(6,3) DEFAULT NULL,
  xa_total        DECIMAL(6,3) DEFAULT NULL,
  xgot_total      DECIMAL(6,3) DEFAULT NULL,
  matches_played  INT DEFAULT 0,
  recent_matches  JSON DEFAULT NULL     COMMENT 'Last 10 match stats',
  heatmap_touches JSON DEFAULT NULL     COMMENT 'Touch positions [{x,y}]',
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS predictions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  player_id   INT NOT NULL,
  gameweek    INT NOT NULL,
  xpts        DECIMAL(5,2) DEFAULT 0  COMMENT 'Expected points (decimal)',
  likely_pts  INT DEFAULT 0           COMMENT 'Most likely whole number outcome',
  min_pts     INT DEFAULT 0,
  max_pts     INT DEFAULT 0,
  xg_prob     DECIMAL(4,3) DEFAULT 0,
  xa_prob     DECIMAL(4,3) DEFAULT 0,
  cs_prob     DECIMAL(4,3) DEFAULT 0,
  mins_prob   DECIMAL(4,3) DEFAULT 0,
  avg_bonus   DECIMAL(4,2) DEFAULT 0,
  fdr         TINYINT DEFAULT 3,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY  uniq_player_gw (player_id, gameweek),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS player_gameweek_history (
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
);
