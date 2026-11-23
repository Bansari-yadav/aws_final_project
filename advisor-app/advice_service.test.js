
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validAdvice,
  validateGeminiAdvice,
  buildAdvicePrompt,
  fallbackForPeriod,
  fallbackAdvice
} = require('./advice_service');

const sampleReport = {
  morning: {
    temperatureMinF: 35,
    temperatureMaxF: 48,
    windMph: 12,
    visibilityMiles: 8,
    uvIndex: 2,
    humidityPercent: 70,
    rain: 'Mild',
    snow: 'No'
  },
  night: {
    temperatureMinF: 29,
    temperatureMaxF: 38,
    windMph: 8,
    visibilityMiles: 10,
    uvIndex: 0,
    humidityPercent: 75,
    rain: 'No',
    snow: 'No'
  }
};

test('accepts valid advice', () => {
  assert.equal(
    validAdvice('Wear a warm jacket.'),
    true
  );
});

test('rejects invalid advice', () => {
  assert.equal(validAdvice(''), false);
  assert.equal(validAdvice(123), false);
  assert.equal(
    validAdvice('<script>alert(1)</script>'),
    false
  );
  assert.equal(
    validAdvice('A'.repeat(301)),
    false
  );
});

test('validates structured Gemini output', () => {
  const result = {
    morning: {
      road_conditions: 'Watch for wet roads.',
      dressing: 'Wear a warm jacket.',
      accessories: 'Carry an umbrella.'
    },
    night: {
      road_conditions: 'Check conditions before driving.',
      dressing: 'Wear a heavy coat.',
      accessories: 'Carry gloves and a scarf.'
    }
  };

  assert.equal(validateGeminiAdvice(result), true);
  assert.equal(validateGeminiAdvice({}), false);
});

test('prompt excludes personal email information', () => {
  const prompt = buildAdvicePrompt(
    sampleReport,
    'neutral'
  );

  assert.equal(prompt.includes('@'), false);
  assert.equal(prompt.includes('temperatureMinF'), true);
  assert.equal(prompt.includes('neutral'), true);
});

test('rejects invalid clothing categories', () => {
  assert.throws(() => {
    buildAdvicePrompt(sampleReport, 'invalid');
  });
});

test('generates wet-road fallback advice', () => {
  const advice = fallbackForPeriod(
    sampleReport.morning
  );

  assert.match(advice.road_conditions, /Rain/);
  assert.match(advice.accessories, /umbrella/);
});

test('generates cold-weather fallback advice', () => {
  const advice = fallbackForPeriod(
    sampleReport.night
  );

  assert.match(advice.dressing, /winter coat/);
  assert.match(advice.accessories, /gloves/);
});

test('generates both Morning and Night advice', () => {
  const result = fallbackAdvice(sampleReport);

  assert.equal(validAdvice(result.morning.dressing), true);
  assert.equal(validAdvice(result.night.dressing), true);

  assert.equal(validateGeminiAdvice(result), true);
});
