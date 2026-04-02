const cron = require('node-cron');
const db = require('../database');
const { getNextSessionDate, isInSeason, formatDate } = require('../utils/session');
const { sendReminderEmail } = require('./email');
const { sendReminderSMS } = require('./sms');

/**
 * Checks every team to see if a reminder should be sent right now.
 * A reminder fires once per session when we're within the configured
 * reminder_hours window before game time.
 *
 * The cron runs every 30 minutes, so the detection window is 30 min wide —
 * any team whose reminder_hours falls in the current 30-min slot gets notified.
 */
async function checkAndSendReminders() {
  const teams = db.prepare('SELECT * FROM teams').all();
  const now = new Date();

  for (const team of teams) {
    const sessionDate = getNextSessionDate(team.day_of_week);
    if (!isInSeason(sessionDate, team.season_start, team.season_end)) continue;

    // Build the exact game datetime
    const [hh, mm] = team.play_time.split(':').map(Number);
    const gameTime = new Date(sessionDate);
    gameTime.setHours(hh, mm, 0, 0);

    const hoursUntilGame = (gameTime - now) / (1000 * 60 * 60);

    // Window: [reminder_hours, reminder_hours - 0.5)
    // So a 24h reminder fires when we're 23.5–24h away from the game.
    if (hoursUntilGame > team.reminder_hours || hoursUntilGame <= team.reminder_hours - 0.5) continue;

    const dateStr = formatDate(sessionDate);
    const session = db.prepare(
      'SELECT * FROM sessions WHERE team_id = ? AND session_date = ?'
    ).get(team.id, dateStr);
    if (!session) continue;

    // Only regular (non-backup) players who haven't received a reminder yet
    const players = db.prepare(`
      SELECT p.* FROM players p
      WHERE p.team_id = ? AND p.active = 1 AND p.role = 'regular'
        AND NOT EXISTS (
          SELECT 1 FROM reminders_sent rs
          WHERE rs.session_id = ? AND rs.player_id = p.id
        )
    `).all(team.id, session.id);

    for (const player of players) {
      const args = {
        playerName: player.name,
        teamName:   team.name,
        sessionDate: session.session_date,
        playTime:   team.play_time,
        location:   team.location,
        teamSlug:   team.slug,
      };

      if (player.email) await sendReminderEmail({ ...args, to: player.email });
      if (player.phone) await sendReminderSMS({ ...args, to: player.phone });

      // Record that reminder was sent (prevents duplicates across cron runs)
      db.prepare(
        'INSERT OR IGNORE INTO reminders_sent (session_id, player_id) VALUES (?, ?)'
      ).run(session.id, player.id);
    }
  }
}

// Run every 30 minutes
cron.schedule('*/30 * * * *', () => {
  checkAndSendReminders().catch(err => console.error('[scheduler] Error:', err.message));
});

console.log('[scheduler] Reminder scheduler started (runs every 30 min)');

module.exports = { checkAndSendReminders };
