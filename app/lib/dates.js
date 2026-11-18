// Dates. Canvas exports write UTC times without a zone marker; the site
// shows them in Pacific time.
export const TIME_ZONE = 'America/Los_Angeles';

export function parseDate(text) {
  if (!text) return null;
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pacificYear(date) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric' }).format(date));
}

// "Thu, Oct 16, 11:59 PM", with the year added when it is not this year.
export function formatDate(text, now = new Date()) {
  const date = parseDate(text);
  if (!date) return '';
  const options = { timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  if (pacificYear(date) !== pacificYear(now)) options.year = 'numeric';
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

// A Date whose UTC fields hold the Pacific wall-clock time, for spreadsheet
// cells, which have no time zone.
export function pacificWallClock(text) {
  const date = parseDate(text);
  if (!date) return null;
  const parts = {};
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  });
  for (const p of format.formatToParts(date)) parts[p.type] = Number(p.value);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
}

// True once the unlock time has passed (or when there is none).
export function isOpen(unlockAt, now = new Date()) {
  const date = parseDate(unlockAt);
  return !date || date <= now;
}
