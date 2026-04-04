let twilioClient;

function getClient() {
  if (!twilioClient &&
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN) {
    const twilio = require('twilio');
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

/**
 * Sends a game reminder SMS to a player.
 * Silently skips if Twilio credentials are not configured.
 */
async function sendReminderSMS({ to, playerName, teamName, sessionDate, playTime, teamSlug, isTest = false }) {
  const client = getClient();
  if (!client || !to || !process.env.TWILIO_FROM_NUMBER) return;

  const dateLabel = formatSessionDate(sessionDate);
  const teamUrl = `${process.env.APP_URL || 'http://localhost:3000'}/t/${teamSlug}`;
  const testPrefix = isTest ? '[TEST] ' : '';

  try {
    await client.messages.create({
      from: process.env.TWILIO_FROM_NUMBER,
      to,
      body: `${testPrefix}🏸 ${teamName} plays ${dateLabel} at ${playTime}. Mark attendance: ${teamUrl}`,
    });
    console.log(`[sms] Reminder sent to ${to} for ${teamName} on ${sessionDate}`);
  } catch (err) {
    console.error(`[sms] Failed to send to ${to}:`, err.message);
  }
}

function formatSessionDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

module.exports = { sendReminderSMS };
