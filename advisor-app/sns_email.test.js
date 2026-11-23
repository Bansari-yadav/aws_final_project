
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateEmail,
  formatWeatherEmail,
  sendWeatherEmail,
  registrationTopicName
} = require('./sns_email');

const report = {
  date: '2026-11-19',
  location: {
    city: 'Chicago',
    state: 'IL',
    zip: '60616'
  },
  morning: {
    temperatureMinF: 42,
    temperatureMaxF: 51,
    windMph: 12,
    visibilityMiles: 10,
    uvIndex: 2,
    humidityPercent: 65,
    rain: 'Mild',
    snow: 'No'
  },
  night: {
    temperatureMinF: 38,
    temperatureMaxF: 45,
    windMph: 8,
    visibilityMiles: 9,
    uvIndex: 0,
    humidityPercent: 72,
    rain: 'No',
    snow: 'No'
  }
};

const adviceResult = {
  source: 'gemini',
  advice: {
    morning: {
      road_conditions: 'Drive carefully on wet roads.',
      dressing: 'Wear a light jacket.',
      accessories: 'Carry an umbrella.'
    },
    night: {
      road_conditions: 'Roads should be mostly dry.',
      dressing: 'Wear a warm jacket.',
      accessories: 'Bring gloves.'
    }
  }
};

test('accepts a valid email', () => {
  assert.equal(validateEmail('student@example.com'), true);
});

test('rejects an invalid email', () => {
  assert.equal(validateEmail('invalid-email'), false);
});

test('formats Morning and Night weather reports', () => {
  const message = formatWeatherEmail(report, adviceResult);

  assert.match(message, /WEATHER ADVISOR REPORT/);
  assert.match(message, /MORNING FORECAST/);
  assert.match(message, /NIGHT FORECAST/);
  assert.match(message, /Road Advice:/);
  assert.match(message, /Clothing:/);
  assert.match(message, /Accessories:/);
});

test('includes weather measurements and advice', () => {
  const message = formatWeatherEmail(report, adviceResult);

  assert.match(message, /Temperature: 42 - 51 F/);
  assert.match(message, /Wind: 12 mph/);
  assert.match(message, /Carry an umbrella/);
});

test('rejects missing consent without sending email', async () => {
  await assert.rejects(
    sendWeatherEmail({
      email: 'bansari2204@gmail.com',
      consent: false,
      report,
      adviceResult
    }),
    /Email consent is required/
  );
});

test('new recipient receives deterministic private topic name, not plaintext email', () => {
  const topic = registrationTopicName('Other@Example.com');
  assert.match(topic, /^weather-advisor-user-[a-f0-9]{64}$/);
  assert.equal(topic, registrationTopicName('other@example.com'));
  assert.doesNotMatch(topic, /other|example|@/);
});

test('rejects an invalid weather report', () => {
  assert.throws(
    () => formatWeatherEmail({}, adviceResult),
    /Invalid weather report/
  );
});
