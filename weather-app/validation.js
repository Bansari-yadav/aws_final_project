
'use strict';

/**
 * Checks whether a postal code has exactly five US ZIP digits.
 * This checks the format, not whether the ZIP actually exists.
 */
function isValidUSZip(zip) {
  return typeof zip === 'string' && /^[0-9]{5}$/.test(zip);
}

/**
 * Checks that a date is a real calendar date.
 * Accepts only YYYY-MM-DD.
 */
function parseISODate(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);

  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

/**
 * Validates a calendar date against seven local calendar days.
 * todayISO must be calculated in the ZIP location's timezone.
 */
function isValidForecastDate(selectedISO, todayISO) {
  const selected = parseISODate(selectedISO);
  const today = parseISODate(todayISO);

  if (!selected || !today) {
    return false;
  }

  const dayDifference =
    (selected.getTime() - today.getTime()) / 86400000;

  return dayDifference >= 0 && dayDifference <= 6;
}

module.exports = {
  isValidUSZip,
  parseISODate,
  isValidForecastDate
};
