const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'badminton.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS global_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    location TEXT,
    day_of_week INTEGER NOT NULL,       -- 0=Sunday ... 6=Saturday
    play_time TEXT NOT NULL,             -- HH:MM (24h)
    season_start TEXT NOT NULL,          -- MM-DD  e.g. "09-01"
    season_end TEXT NOT NULL,            -- MM-DD  e.g. "05-31"
    min_players INTEGER NOT NULL DEFAULT 4,
    reminder_hours REAL NOT NULL DEFAULT 24,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    global_player_id INTEGER,
    role TEXT NOT NULL DEFAULT 'regular',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (global_player_id) REFERENCES global_players(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    session_date TEXT NOT NULL,          -- YYYY-MM-DD
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    UNIQUE(team_id, session_date)
  );

  CREATE TABLE IF NOT EXISTS responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- 'in' | 'out' | 'pending'
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    UNIQUE(session_id, player_id)
  );

  CREATE TABLE IF NOT EXISTS reminders_sent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    UNIQUE(session_id, player_id)
  );

  CREATE TABLE IF NOT EXISTS vacations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    start_date TEXT NOT NULL,   -- YYYY-MM-DD
    end_date TEXT NOT NULL,     -- YYYY-MM-DD
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
  );
`);

// ── Schema migrations (idempotent) ───────────────────────────────────────────
// Add columns to players if upgrading from an older schema
for (const col of [
  "ALTER TABLE players ADD COLUMN global_player_id INTEGER REFERENCES global_players(id) ON DELETE SET NULL",
  "ALTER TABLE players ADD COLUMN role TEXT NOT NULL DEFAULT 'regular'",
]) {
  try { db.exec(col); } catch (_) { /* column already exists */ }
}

// Migrate existing players (global_player_id IS NULL) into global_players
const unmigrated = db.prepare('SELECT * FROM players WHERE global_player_id IS NULL').all();
if (unmigrated.length) {
  const insertGlobal = db.prepare(
    'INSERT INTO global_players (name, email, phone) VALUES (?, ?, ?)'
  );
  const linkPlayer = db.prepare(
    'UPDATE players SET global_player_id = ? WHERE id = ?'
  );
  const migrate = db.transaction(() => {
    for (const p of unmigrated) {
      const r = insertGlobal.run(p.name, p.email, p.phone);
      linkPlayer.run(r.lastInsertRowid, p.id);
    }
  });
  migrate();
}

module.exports = db;
