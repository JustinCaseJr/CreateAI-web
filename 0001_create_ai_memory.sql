CREATE TABLE IF NOT EXISTS user_memory (
  user_id TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  memory_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, memory_key)
);
CREATE INDEX IF NOT EXISTS idx_user_memory_updated ON user_memory(user_id, updated_at);


CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  messages_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
