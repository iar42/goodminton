const express = require('express');
const router = express.Router();
const db = require('../database');

function getCurrentSeasonRange(team) {
  const today = new Date();
  const year = today.getFullYear();
  const [sm, sd] = team.season_start.split('-').map(Number);
  const [em, ed] = team.season_end.split('-').map(Number);
  const wraps = (sm * 100 + sd) > (em * 100 + ed);
  let startYear, endYear;
  if (!wraps) {
    startYear = year; endYear = year;
  } else {
    const cv = (today.getMonth() + 1) * 100 + today.getDate();
    if (cv >= sm * 100 + sd) { startYear = year; endYear = year + 1; }
    else { startYear = year - 1; endYear = year; }
  }
  return { start: `${startYear}-${team.season_start}`, end: `${endYear}-${team.season_end}` };
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.adminAuthenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

router.post('/api/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.adminAuthenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

router.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

router.get('/api/me', (req, res) => {
  res.json({ authenticated: !!req.session.adminAuthenticated });
});

// ── Teams ─────────────────────────────────────────────────────────────────────

router.get('/api/teams', requireAuth, (req, res) => {
  const teams = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM players WHERE team_id = t.id AND active = 1) AS player_count
    FROM teams t
    ORDER BY t.name COLLATE NOCASE
  `).all();
  res.json(teams);
});

router.post('/api/teams', requireAuth, (req, res) => {
  const { name, slug, description, location, day_of_week, play_time,
          season_start, season_end, min_players, reminder_hours } = req.body;

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: 'Slug must be lowercase letters, numbers, and hyphens only' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO teams
        (name, slug, description, location, day_of_week, play_time, season_start, season_end, min_players, reminder_hours)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, slug, description || null, location || null,
           day_of_week, play_time, season_start, season_end,
           min_players || 4, reminder_hours || 24);
    res.json(db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'That URL slug is already taken' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/api/teams/:id', requireAuth, (req, res) => {
  const { name, slug, description, location, day_of_week, play_time,
          season_start, season_end, min_players, reminder_hours } = req.body;

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: 'Slug must be lowercase letters, numbers, and hyphens only' });
  }

  try {
    db.prepare(`
      UPDATE teams SET
        name=?, slug=?, description=?, location=?, day_of_week=?, play_time=?,
        season_start=?, season_end=?, min_players=?, reminder_hours=?
      WHERE id=?
    `).run(name, slug, description || null, location || null,
           day_of_week, play_time, season_start, season_end,
           min_players, reminder_hours, req.params.id);
    res.json(db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'That URL slug is already taken' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/teams/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM teams WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Global player inventory ───────────────────────────────────────────────────

router.get('/api/inventory', requireAuth, (req, res) => {
  const players = db.prepare(`
    SELECT gp.*,
      (SELECT COUNT(*) FROM players p WHERE p.global_player_id = gp.id AND p.active = 1) AS team_count
    FROM global_players gp
    ORDER BY gp.name COLLATE NOCASE
  `).all();

  // Attach team memberships to each player
  const memberships = db.prepare(`
    SELECT p.global_player_id, p.role, t.name AS team_name, t.id AS team_id
    FROM players p
    JOIN teams t ON t.id = p.team_id
    WHERE p.active = 1 AND p.global_player_id IS NOT NULL
    ORDER BY t.name COLLATE NOCASE
  `).all();

  const membershipMap = {};
  for (const m of memberships) {
    if (!membershipMap[m.global_player_id]) membershipMap[m.global_player_id] = [];
    membershipMap[m.global_player_id].push({ teamId: m.team_id, teamName: m.team_name, role: m.role });
  }

  res.json(players.map(p => ({ ...p, teams: membershipMap[p.id] || [] })));
});

router.post('/api/inventory', requireAuth, (req, res) => {
  const { name, email, phone } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  const result = db.prepare(
    'INSERT INTO global_players (name, email, phone) VALUES (?, ?, ?)'
  ).run(name.trim(), email || null, phone || null);

  const gp = db.prepare('SELECT * FROM global_players WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ...gp, teams: [] });
});

router.put('/api/inventory/:id', requireAuth, (req, res) => {
  const { name, email, phone } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  db.prepare(
    'UPDATE global_players SET name=?, email=?, phone=? WHERE id=?'
  ).run(name.trim(), email || null, phone || null, req.params.id);

  // Sync name/email/phone to all linked team player rows
  db.prepare(
    'UPDATE players SET name=?, email=?, phone=? WHERE global_player_id=?'
  ).run(name.trim(), email || null, phone || null, req.params.id);

  const gp = db.prepare('SELECT * FROM global_players WHERE id = ?').get(req.params.id);
  res.json(gp);
});

router.delete('/api/inventory/:id', requireAuth, (req, res) => {
  // Removing from inventory does not remove team memberships — those stay as standalone players
  db.prepare('UPDATE players SET global_player_id = NULL WHERE global_player_id = ?').run(req.params.id);
  db.prepare('DELETE FROM global_players WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Players ───────────────────────────────────────────────────────────────────

router.get('/api/teams/:id/players', requireAuth, (req, res) => {
  const players = db.prepare(`
    SELECT * FROM players WHERE team_id = ? ORDER BY name COLLATE NOCASE
  `).all(req.params.id);
  res.json(players);
});

// Add a player to a team — either from inventory (globalPlayerId) or brand new
router.post('/api/teams/:id/players', requireAuth, (req, res) => {
  const { globalPlayerId, role, name, email, phone } = req.body;

  let resolvedName, resolvedEmail, resolvedPhone, resolvedGlobalId;

  if (globalPlayerId) {
    const gp = db.prepare('SELECT * FROM global_players WHERE id = ?').get(globalPlayerId);
    if (!gp) return res.status(404).json({ error: 'Player not found in inventory' });

    // Check not already on this team
    const existing = db.prepare(
      'SELECT id FROM players WHERE team_id = ? AND global_player_id = ?'
    ).get(req.params.id, globalPlayerId);
    if (existing) return res.status(400).json({ error: 'Player is already on this team' });

    resolvedName = gp.name;
    resolvedEmail = gp.email;
    resolvedPhone = gp.phone;
    resolvedGlobalId = gp.id;
  } else {
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    resolvedName = name.trim();
    resolvedEmail = email || null;
    resolvedPhone = phone || null;

    // Also create a global player entry for the new person
    const result = db.prepare(
      'INSERT INTO global_players (name, email, phone) VALUES (?, ?, ?)'
    ).run(resolvedName, resolvedEmail, resolvedPhone);
    resolvedGlobalId = result.lastInsertRowid;
  }

  const playerRole = ['regular', 'backup'].includes(role) ? role : 'regular';

  const result = db.prepare(`
    INSERT INTO players (team_id, name, email, phone, global_player_id, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.id, resolvedName, resolvedEmail, resolvedPhone, resolvedGlobalId, playerRole);

  res.json(db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/api/players/:id', requireAuth, (req, res) => {
  const { name, email, phone, active, role } = req.body;
  const playerRole = ['regular', 'backup'].includes(role) ? role : 'regular';

  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  db.prepare(
    'UPDATE players SET name=?, email=?, phone=?, active=?, role=? WHERE id=?'
  ).run(name.trim(), email || null, phone || null, active ? 1 : 0, playerRole, req.params.id);

  // Sync contact info to global player
  if (player.global_player_id) {
    db.prepare(
      'UPDATE global_players SET name=?, email=?, phone=? WHERE id=?'
    ).run(name.trim(), email || null, phone || null, player.global_player_id);
    // Sync to all other teams this person is on
    db.prepare(
      'UPDATE players SET name=?, email=?, phone=? WHERE global_player_id=? AND id != ?'
    ).run(name.trim(), email || null, phone || null, player.global_player_id, req.params.id);
  }

  res.json(db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id));
});

router.delete('/api/players/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Sessions ──────────────────────────────────────────────────────────────────

router.get('/api/teams/:id/sessions', requireAuth, (req, res) => {
  const sessions = db.prepare(`
    SELECT s.id, s.session_date,
      SUM(CASE WHEN r.status = 'in'      THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN r.status = 'out'     THEN 1 ELSE 0 END) AS declined,
      SUM(CASE WHEN r.status = 'pending' THEN 1 ELSE 0 END) AS pending
    FROM sessions s
    LEFT JOIN responses r ON r.session_id = s.id
    WHERE s.team_id = ?
    GROUP BY s.id
    ORDER BY s.session_date DESC
    LIMIT 30
  `).all(req.params.id);
  res.json(sessions);
});

router.get('/api/sessions/:sessionId/responses', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT p.name, p.role, r.status, r.updated_at
    FROM responses r
    JOIN players p ON p.id = r.player_id
    WHERE r.session_id = ? AND r.status != 'pending'
    ORDER BY r.updated_at ASC
  `).all(req.params.sessionId);
  res.json(rows);
});

// ── Attendance ────────────────────────────────────────────────────────────────

router.get('/api/teams/:id/attendance', requireAuth, (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const range = getCurrentSeasonRange(team);

  const rows = db.prepare(`
    SELECT p.id, p.name, p.role,
           COUNT(CASE WHEN r.status = 'in' THEN 1 END) AS played,
           COUNT(s.id) AS total_sessions
    FROM players p
    LEFT JOIN responses r ON r.player_id = p.id
    LEFT JOIN sessions s ON s.id = r.session_id
                        AND s.team_id = ?
                        AND s.session_date >= ?
                        AND s.session_date <= ?
    WHERE p.team_id = ? AND p.active = 1
    GROUP BY p.id
    ORDER BY p.role ASC, played DESC, p.name COLLATE NOCASE
  `).all(team.id, range.start, range.end, team.id);

  res.json({ attendance: rows, seasonStart: range.start, seasonEnd: range.end });
});

// ── Vacations ─────────────────────────────────────────────────────────────────

router.get('/api/teams/:id/vacations', requireAuth, (req, res) => {
  const vacations = db.prepare(`
    SELECT v.id, v.player_id, v.start_date, v.end_date, v.note, p.name AS player_name
    FROM vacations v
    JOIN players p ON p.id = v.player_id
    WHERE p.team_id = ?
    ORDER BY v.start_date ASC
  `).all(req.params.id);
  res.json(vacations);
});

router.delete('/api/vacations/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM vacations WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
