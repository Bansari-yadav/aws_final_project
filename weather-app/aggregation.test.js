
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  average,
  parseWindSpeed,
  aggregateWeather
} = require('./aggregation');

test('calculates average correctly', () => {
  assert.equal(average([10, 20, 30]), 20);
  assert.equal(average([38, 39, 41, 43, 45, 47]), 42.2);
  assert.equal(average([]), null);
});

test('parses NWS wind speed', () => {
  assert.equal(parseWindSpeed('5 mph'), 5);
  assert.equal(parseWindSpeed('5 to 10 mph'), 10);
  assert.equal(parseWindSpeed('unknown'), null);
});

test('aggregates hourly weather data', () => {
  const periods = [
    {
      temperature: 38,
      windSpeed: '5 mph',
      relativeHumidity: { value: 70 },
      probabilityOfPrecipitation: { value: 10 }
    },
    {
      temperature: 42,
      windSpeed: '10 mph',
      relativeHumidity: { value: 60 },
      probabilityOfPrecipitation: { value: 30 }
    },
    {
      temperature: 46,
      windSpeed: '8 mph',
      relativeHumidity: { value: 50 },
      probabilityOfPrecipitation: { value: 20 }
    }
  ];

  const result = aggregateWeather(periods);

  assert.equal(result.temperatureMin, 38);
  assert.equal(result.temperatureMax, 46);
  assert.equal(result.temperatureAverage, 42);
  assert.equal(result.windSpeed, 10);
  assert.equal(result.humidity, 60);
  assert.equal(result.precipitationChance, 30);
});

test('handles missing weather values safely', () => {
  const result = aggregateWeather([]);

  assert.equal(result.temperatureAverage, null);
  assert.equal(result.windSpeed, null);
  assert.equal(result.humidity, null);
});
