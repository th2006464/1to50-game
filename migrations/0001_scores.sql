-- 1to50 世界排行榜(对应原版 RankWorldLayer)
CREATE TABLE IF NOT EXISTS one_to_fifty_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  player_name TEXT NOT NULL DEFAULT '匿名玩家',
  time_seconds REAL NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_one_to_fifty_scores_time ON one_to_fifty_scores(time_seconds ASC);
