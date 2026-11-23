
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyRain,
  classifySnow,
  classifyPeriod
} = require('./precipitation');

test('classifies rain correctly', () => {
  assert.equal(classifyRain(0), 'No');
  assert.equal(classifyRain(1), 'Mild');
  assert.equal(classifyRain(10), 'Heavy');
});

test('checks rain threshold boundaries', () => {
  assert.equal(classifyRain(7.59), 'Mild');
  assert.equal(classifyRain(7.6), 'Heavy');
  assert.equal(classifyRain(7.61), 'Heavy');
});

test('classifies snow correctly', () => {
  assert.equal(classifySnow(0), 'No');
  assert.equal(classifySnow(1), 'Mild');
  assert.equal(classifySnow(3), 'Heavy');
});

test('checks snow threshold boundaries', () => {
  assert.equal(classifySnow(2.53), 'Mild');
  assert.equal(classifySnow(2.54), 'Heavy');
  assert.equal(classifySnow(2.55), 'Heavy');
});

test('does not invent missing weather values', () => {
  assert.equal(classifyRain(null), 'Not available');
  assert.equal(classifySnow(undefined), 'Not available');
  assert.equal(classifyRain(-1), 'Not available');
  assert.equal(classifySnow(NaN), 'Not available');
});

test('classifies a period using peak hourly intensity', () => {
  assert.equal(
    classifyPeriod([0, 1, 3, 8, 2, 0], classifyRain),
    'Heavy'
  );

  assert.equal(
    classifyPeriod([0, 0, 0], classifySnow),
    'No'
  );

  assert.equal(
    classifyPeriod([0, null, 1], classifyRain),
    'Not available'
  );
});
