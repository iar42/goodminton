/**
 * Returns the date of the next (or current) occurrence of dayOfWeek.
 * If today IS the game day, returns today.
 * @param {number} dayOfWeek  0=Sunday … 6=Saturday
 * @returns {Date}  midnight local time
 */
function getNextSessionDate(dayOfWeek) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayDay = today.getDay();
  let daysUntil = dayOfWeek - todayDay;
  if (daysUntil < 0) daysUntil += 7;
  const d = new Date(today);
  d.setDate(today.getDate() + daysUntil);
  return d;
}

/**
 * Checks whether a given date falls within the team's season.
 * Handles seasons that wrap the year-end (e.g. Sept–May).
 * @param {Date}   date
 * @param {string} seasonStart  "MM-DD"
 * @param {string} seasonEnd    "MM-DD"
 */
function isInSeason(date, seasonStart, seasonEnd) {
  const [sm, sd] = seasonStart.split('-').map(Number);
  const [em, ed] = seasonEnd.split('-').map(Number);
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const sv = sm * 100 + sd;  // e.g. 901  (Sep 1)
  const ev = em * 100 + ed;  // e.g. 531  (May 31)
  const cv = m * 100 + d;    // current date value

  if (sv <= ev) {
    // Season within the same calendar year (e.g. Mar–Oct)
    return cv >= sv && cv <= ev;
  } else {
    // Season wraps year-end (e.g. Sept–May)
    return cv >= sv || cv <= ev;
  }
}

/**
 * Formats a Date as "YYYY-MM-DD" using local time.
 */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = { getNextSessionDate, isInSeason, formatDate };
