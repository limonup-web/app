CREATE TABLE IF NOT EXISTS stations (
  station_no TEXT PRIMARY KEY,
  sequence INTEGER,
  station_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS stations_active_sequence_idx ON stations (is_active, sequence);

CREATE TABLE IF NOT EXISTS station_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_no TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS station_audit_logs_station_idx ON station_audit_logs (station_no, created_at);
