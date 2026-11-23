
'use strict';

/**
 * Convert a timestamp into local date and hour.
 * This handles timezone offsets and daylight saving time.
 */
function getLocalDateHour(timestamp, timezone) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid timestamp');
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map(p => [p.type, p.value])
  );

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour)
  };
}

/**
 * Select NWS hourly forecast records for Morning and Night.
 */
function selectPeriodHours(periods, selectedDate, timezone) {
  const morning = [];
  const night = [];

  for (const period of periods) {
    const local = getLocalDateHour(
      period.startTime,
      timezone
    );

    if (local.date !== selectedDate) {
      continue;
    }

    if (local.hour >= 6 && local.hour < 12) {
      morning.push(period);
    }

    if (local.hour >= 18 && local.hour < 24) {
      night.push(period);
    }
  }

  return { morning, night };
}

module.exports = {
  getLocalDateHour,
  selectPeriodHours
};
