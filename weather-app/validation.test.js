
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isValidUSZip,
  parseISODate,
  isValidForecastDate
} = require('./validation');

test('accepts valid five-digit US ZIP formats', () => {
  assert.equal(isValidUSZip('60616'), true);
  assert.equal(isValidUSZip('10001'), true);
  assert.equal(isValidUSZip('00501'), true);
});

test('rejects invalid and non-US postal codes', () => {
  const invalidCodes = [
    'M5V 3L9',
    'SW1A 1AA',
    '1234',
    '123456',
    'ABCDE',
    '',
    '123456789012345',
    '12 345'
  ];

  for (const code of invalidCodes) {
    assert.equal(isValidUSZip(code), false);
  }
});

test('rejects impossible calendar dates', () => {
  assert.equal(parseISODate('2026-02-30'), null);
  assert.equal(parseISODate('2026-13-01'), null);
  assert.equal(parseISODate('not-a-date'), null);
});

test('accepts the seven-day forecast window', () => {
  const today = '2026-11-16';

  assert.equal(isValidForecastDate('2026-11-16', today), true);
  assert.equal(isValidForecastDate('2026-11-18', today), true);
  assert.equal(isValidForecastDate('2026-11-22', today), true);
});

test('rejects dates outside the seven-day window', () => {
  const today = '2026-11-16';

  assert.equal(isValidForecastDate('2026-11-15', today), false);
  assert.equal(isValidForecastDate('2026-11-23', today), false);
  assert.equal(isValidForecastDate('2026-02-30', today), false);
});
