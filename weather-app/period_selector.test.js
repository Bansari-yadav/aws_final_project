
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getLocalDateHour,
  selectPeriodHours
} = require('./period_selector');

test('selects six Morning and six Night hours', () => {
  const periods = [];

  for (let hour = 0; hour < 24; hour++) {
    const time = new Date(
      Date.UTC(2026, 10, 18, hour + 6)
    ).toISOString();

    periods.push({
      startTime: time,
      temperature: hour
    });
  }

  const result = selectPeriodHours(
    periods,
    '2026-11-18',
    'America/Chicago'
  );

  assert.equal(result.morning.length, 6);
  assert.equal(result.night.length, 6);

  assert.deepEqual(
    result.morning.map(p => p.temperature),
    [6, 7, 8, 9, 10, 11]
  );

  assert.deepEqual(
    result.night.map(p => p.temperature),
    [18, 19, 20, 21, 22, 23]
  );
});

test('handles daylight saving time conversion', () => {
  const before = getLocalDateHour(
    '2026-11-01T06:30:00Z',
    'America/Chicago'
  );

  const after = getLocalDateHour(
    '2026-11-01T07:30:00Z',
    'America/Chicago'
  );

  assert.equal(before.hour, 1);
  assert.equal(after.hour, 1);
});

test('returns empty periods when forecast is missing', () => {
  const result = selectPeriodHours(
    [],
    '2026-11-18',
    'America/Chicago'
  );

  assert.equal(result.morning.length, 0);
  assert.equal(result.night.length, 0);
});
