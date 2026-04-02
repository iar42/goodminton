const express = require('express');
const router = express.Router();
const db = require('../database');
const { getNextSessionDate, isInSeason, formatDate } = require('../utils/session');

/**
 * Returns the YYYY-MM-DD start/end of the current season for a team.
 */
function getCurrentSeasonRange(team) {
  const today = new Date();
  const year = today.getFullYear();
  const [sm, sd] = team.season_start.split('-').map(Number);
  const [em, ed] = team.season_end.split('-').map(Number);
  const wraps = (sm * 100 + sd) > (em * 100 + ed);

  let startYear, endYear;
  if (!wraps) {
    startYear = year;
    endYear = year;
  } else {
    const cv = (today.getMonth() + 1) * 100 + today.getDate();
    const sv = sm * 100 + sd;
    if (cv >= sv) {
      startYear = year;
      endYear = year + 1;
    } else {
      startYear = year - 1;
      endYear = year;
    }
  }

  return {
    start: `${startYear}-${team.season_start}`,
    end: `${endYear}-${team.season_end}`,
  };
}

/**
 * Finds or creates the current week's session for a team.
 * Also ensures every active player has a response row, and auto-marks
 * vacationing players as 'out'.
 */
function getOrCreateSession(team) {
  const sessionDate = getNextSessionDate(team.day_of_week);
  const inSeason = isInSeason(sessionDate, team.season_start, team.season_end);

  if (!inSeason) {
    return { inSeason: false, sessionDate };
  }

  const dateStr = formatDate(sessionDate);

  // Upsert session row
  db.prepare(
    'INSERT OR IGNORE INTO sessions (team_id, session_date) VALUES (?, ?)'
  ).run(team.id, dateStr);

  const session = db.prepare(
    'SELECT * FROM sessions WHERE team_id = ? AND session_date = ?'
  ).get(team.id, dateStr);

  // Ensure every active player has a response row (handles newly added players)
  const players = db.prepare(
    'SELECT id FROM players WHERE team_id = ? AND active = 1'
  ).all(team.id);

  const upsertResponse = db.prepare(
    'INSERT OR IGNORE INTO responses (session_id, player_id, status) VALUES (?, ?, ?)'
  );
  for (const p of players) {
    upsertResponse.run(session.id, p.id, 'pending');
  }

  // Auto-mark vacationing players as 'out' (only overrides 'pending')
  db.prepare(`
    UPDATE responses SET status = 'out', updated_at = CURRENT_TIMESTAMP
    WHERE session_id = ?
      AND status = 'pending'
      AND player_id IN (
        SELECT player_id FROM vacations
        WHERE start_date <= ? AND end_date >= ?
      )
  `).run(session.id, dateStr, dateStr);

  return { inSeason: true, session, sessionDate };
}

// ── GET /api/t/:slug/session ──────────────────────────────────────────────────
router.get('/t/:slug/session', (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE slug = ?').get(req.params.slug);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const { inSeason, session, sessionDate } = getOrCreateSession(team);

  const teamPublic = {
    id: team.id,
    name: team.name,
    description: team.description,
    location: team.location,
    play_time: team.play_time,
    day_of_week: team.day_of_week,
    min_players: team.min_players,
  };

  if (!inSeason) {
    return res.json({
      team: teamPublic,
      inSeason: false,
      seasonStart: team.season_start,
      seasonEnd: team.season_end,
      sessionDate: formatDate(sessionDate),
    });
  }

  const players = db.prepare(`
    SELECT p.id, p.name, p.role,
           COALESCE(r.status, 'pending') AS status,
           r.updated_at
    FROM players p
    LEFT JOIN responses r ON r.player_id = p.id AND r.session_id = ?
    WHERE p.team_id = ? AND p.active = 1
    ORDER BY p.role ASC, p.name COLLATE NOCASE
  `).all(session.id, team.id);

  const confirmed = players.filter(p => p.status === 'in').length;
  const declined  = players.filter(p => p.status === 'out').length;
  const pending   = players.filter(p => p.status === 'pending').length;

  res.json({
    team: teamPublic,
    inSeason: true,
    session: { id: session.id, date: session.session_date },
    players,
    confirmed,
    declined,
    pending,
  });
});

// ── POST /api/t/:slug/response ────────────────────────────────────────────────
router.post('/t/:slug/response', (req, res) => {
  const { sessionId, playerId, status } = req.body;

  if (!['in', 'out', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const team = db.prepare('SELECT * FROM teams WHERE slug = ?').get(req.params.slug);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const player = db.prepare(
    'SELECT id FROM players WHERE id = ? AND team_id = ? AND active = 1'
  ).get(playerId, team.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const session = db.prepare(
    'SELECT id FROM sessions WHERE id = ? AND team_id = ?'
  ).get(sessionId, team.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  db.prepare(`
    INSERT INTO responses (session_id, player_id, status, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(session_id, player_id)
    DO UPDATE SET status = excluded.status, updated_at = CURRENT_TIMESTAMP
  `).run(sessionId, playerId, status);

  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'in'      THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN status = 'out'     THEN 1 ELSE 0 END) AS declined,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
    FROM responses WHERE session_id = ?
  `).get(sessionId);

  res.json({ success: true, ...counts });
});

// ── GET /api/t/:slug/attendance ───────────────────────────────────────────────
// Returns per-player 'in' counts for the current season.
router.get('/t/:slug/attendance', (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE slug = ?').get(req.params.slug);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const range = getCurrentSeasonRange(team);

  const rows = db.prepare(`
    SELECT p.id, p.name,
           COUNT(CASE WHEN r.status = 'in' THEN 1 END) AS played,
           COUNT(CASE WHEN r.status IN ('in','out') THEN 1 END) AS responded,
           COUNT(s.id) AS total_sessions
    FROM players p
    LEFT JOIN responses r ON r.player_id = p.id
    LEFT JOIN sessions s ON s.id = r.session_id
                        AND s.team_id = ?
                        AND s.session_date >= ?
                        AND s.session_date <= ?
    WHERE p.team_id = ? AND p.active = 1
    GROUP BY p.id
    ORDER BY played DESC, p.name COLLATE NOCASE
  `).all(team.id, range.start, range.end, team.id);

  res.json({ attendance: rows, seasonStart: range.start, seasonEnd: range.end });
});

// ── GET /api/t/:slug/vacations ────────────────────────────────────────────────
router.get('/t/:slug/vacations', (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE slug = ?').get(req.params.slug);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const today = formatDate(new Date());
  const vacations = db.prepare(`
    SELECT v.id, v.player_id, v.start_date, v.end_date, v.note, p.name AS player_name
    FROM vacations v
    JOIN players p ON p.id = v.player_id
    WHERE p.team_id = ? AND v.end_date >= ?
    ORDER BY v.start_date ASC
  `).all(team.id, today);

  res.json(vacations);
});

// ── POST /api/t/:slug/vacations ───────────────────────────────────────────────
router.post('/t/:slug/vacations', (req, res) => {
  const { playerId, start_date, end_date, note } = req.body;

  const team = db.prepare('SELECT * FROM teams WHERE slug = ?').get(req.params.slug);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  if (!playerId || !start_date || !end_date) {
    return res.status(400).json({ error: 'playerId, start_date, and end_date are required' });
  }
  if (start_date > end_date) {
    return res.status(400).json({ error: 'start_date must be before end_date' });
  }

  const player = db.prepare(
    'SELECT id FROM players WHERE id = ? AND team_id = ? AND active = 1'
  ).get(playerId, team.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const result = db.prepare(
    'INSERT INTO vacations (player_id, start_date, end_date, note) VALUES (?, ?, ?, ?)'
  ).run(playerId, start_date, end_date, note || null);

  // Auto-mark any upcoming sessions in this vacation window as 'out'
  db.prepare(`
    UPDATE responses SET status = 'out', updated_at = CURRENT_TIMESTAMP
    WHERE player_id = ?
      AND status = 'pending'
      AND session_id IN (
        SELECT id FROM sessions WHERE team_id = ? AND session_date >= ? AND session_date <= ?
      )
  `).run(playerId, team.id, start_date, end_date);

  res.json(db.prepare('SELECT * FROM vacations WHERE id = ?').get(result.lastInsertRowid));
});

// ── DELETE /api/t/:slug/vacations/:id ────────────────────────────────────────
router.delete('/t/:slug/vacations/:id', (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE slug = ?').get(req.params.slug);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  // Verify the vacation belongs to a player on this team
  const vacation = db.prepare(`
    SELECT v.id FROM vacations v
    JOIN players p ON p.id = v.player_id
    WHERE v.id = ? AND p.team_id = ?
  `).get(req.params.id, team.id);
  if (!vacation) return res.status(404).json({ error: 'Vacation not found' });

  db.prepare('DELETE FROM vacations WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
