const { Resend } = require('resend');

let resend;
function getClient() {
  if (!resend && process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

/**
 * Sends a game reminder email to a player.
 * Silently skips if RESEND_API_KEY is not configured.
 */
async function sendReminderEmail({ to, playerName, teamName, sessionDate, playTime, location, teamSlug, isTest = false }) {
  const client = getClient();
  if (!client || !to) return;

  const dateLabel = formatSessionDate(sessionDate);
  const teamUrl = `${process.env.APP_URL || 'http://localhost:3000'}/t/${teamSlug}`;
  const subjectPrefix = isTest ? '[TEST] ' : '';

  try {
    await client.emails.send({
      from: process.env.EMAIL_FROM || 'Badminton <noreply@example.com>',
      to,
      subject: `${subjectPrefix}🏸 Reminder: ${teamName} plays ${dateLabel}`,
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0fdf4;margin:0;padding:20px;">
          <div style="max-width:480px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
            <div style="background:#16a34a;padding:24px;color:white;">
              <div style="font-size:28px;margin-bottom:4px;">🏸</div>
              <h1 style="margin:0;font-size:20px;font-weight:700;">${teamName}</h1>
              <p style="margin:4px 0 0;opacity:0.85;font-size:14px;">${isTest ? 'Test notification' : 'Game reminder'}</p>
            </div>
            <div style="padding:24px;">
              <p style="margin:0 0 8px;color:#374151;">Hi <strong>${playerName}</strong>,</p>
              <p style="margin:0 0 20px;color:#374151;">
                Your game is coming up on <strong>${dateLabel} at ${playTime}</strong>${location ? ` at <strong>${location}</strong>` : ''}.
              </p>
              <p style="margin:0 0 16px;color:#374151;">Please mark whether you can make it:</p>
              <a href="${teamUrl}"
                 style="display:block;background:#16a34a;color:white;text-align:center;padding:14px 24px;border-radius:10px;text-decoration:none;font-size:16px;font-weight:600;">
                Mark My Attendance →
              </a>
            </div>
            <div style="padding:16px 24px;border-top:1px solid #f0f0f0;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                You received this because you are a member of ${teamName}.
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
    });
    console.log(`[email] Reminder sent to ${to} for ${teamName} on ${sessionDate}`);
  } catch (err) {
    console.error(`[email] Failed to send to ${to}:`, err.message);
  }
}

function formatSessionDate(dateStr) {
  // dateStr = "YYYY-MM-DD"; add T12:00:00 to avoid timezone off-by-one
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

module.exports = { sendReminderEmail };
