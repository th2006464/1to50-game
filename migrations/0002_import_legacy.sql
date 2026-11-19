-- Track imported record IDs so repeated imports preserve every original score.
ALTER TABLE one_to_fifty_scores ADD COLUMN legacy_score_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_to_fifty_legacy_score ON one_to_fifty_scores(legacy_score_id);
