const cron = require('node-cron');
const db = require('../database');
const { getNextSessionDate, isInSeason, formatDate } = require('../utils/session');
const { sendReminderEmail } = require('./email');
const { sendReminderSMS } = require('./sms');

/**
 * Checks every team to see if a reminder should be sent right now.
 *
 * Each team has separate reminder windows for email and SMS
 * (reminder_hours_email / reminder_hours_sms). The cron runs every 30 minutes,
 * so a channel fires when the hours-until-game falls in its [hours, hours-0.5) window.
 *
 * Players are skipped if:
 *  - They already received a reminder on that channel (email_sent / sms_sent)
 *  - They already responded In or Out for this session
 *  - Their reminder_pref excludes the channel ('none', 'email', 'sms', 'both')
 */
async function checkAndSendReminders() {
  const teams = db.prepare('SELECT * FROM teams').all();
  const now = new Date();

  for (const team of teams) {
    const sessionDate = getNextSessionDate(team.day_of_week, team.play_time);
    if (!isInSeason(sessionDate, team.season_start, team.season_end)) continue;

    const [hh, mm] = team.play_time.split(':').map(Number);
    const gameTime = new Date(sessionDate);
    gameTime.setHours(hh, mm, 0, 0);

    const hoursUntilGame = (gameTime - now) / (1000 * 60 * 60);

    const emailInWindow = team.reminder_hours_email > 0 &&
      hoursUntilGame <= team.reminder_hours_email &&
      hoursUntilGame >  team.reminder_hours_email - 0.5;

    const smsInWindow = team.reminder_hours_sms > 0 &&
      hoursUntilGame <= team.reminder_hours_sms &&
      hoursUntilGame >  team.reminder_hours_sms - 0.5;

    if (!emailInWindow && !smsInWindow) continue;

    const dateStr = formatDate(sessionDate);
    const session = db.prepare(
      'SELECT * FROM sessions WHERE team_id = ? AND session_date = ?'
    ).get(team.id, dateStr);
    if (!session) continue;

    const players = db.prepare(`
      SELECT p.*,
             COALESCE(gp.reminder_pref, 'both') AS reminder_pref,
             COALESCE(rs.email_sent, 0)          AS email_sent,
             COALESCE(rs.sms_sent,   0)          AS sms_sent
      FROM players p
      LEFT JOIN global_players gp ON gp.id = p.global_player_id
      LEFT JOIN reminders_sent rs ON rs.session_id = ? AND rs.player_id = p.id
      WHERE p.team_id = ? AND p.active = 1 AND p.role = 'regular'
        AND NOT EXISTS (
          SELECT 1 FROM responses r
          WHERE r.session_id = ? AND r.player_id = p.id AND r.status != 'pending'
        )
    `).all(session.id, team.id, session.id);

    for (const player of players) {
      const pref = player.reminder_pref || 'both';
      const sendEmail = emailInWindow && !player.email_sent &&
        (pref === 'email' || pref === 'both') && player.email;
      const sendSms = smsInWindow && !player.sms_sent &&
        (pref === 'sms' || pref === 'both') && player.phone;

      if (!sendEmail && !sendSms) continue;

      const args = {
        playerName:  player.name,
        teamName:    team.name,
        sessionDate: session.session_date,
        playTime:    team.play_time,
        location:    team.location,
        teamSlug:    team.slug,
      };

      if (sendEmail) await sendReminderEmail({ ...args, to: player.email });
      if (sendSms)   await sendReminderSMS({ ...args, to: player.phone });

      db.prepare(`
        INSERT INTO reminders_sent (session_id, player_id, email_sent, sms_sent)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(session_id, player_id)
        DO UPDATE SET email_sent = email_sent OR excluded.email_sent,
                      sms_sent   = sms_sent   OR excluded.sms_sent
      `).run(session.id, player.id, sendEmail ? 1 : 0, sendSms ? 1 : 0);
    }
  }
}

// Run every 30 minutes
cron.schedule('*/30 * * * *', () => {
  checkAndSendReminders().catch(err => console.error('[scheduler] Error:', err.message));
});

console.log('[scheduler] Reminder scheduler started (runs every 30 min)');

module.exports = { checkAndSendReminders };
