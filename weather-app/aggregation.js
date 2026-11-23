
'use strict';

/**
 * Return a rounded average, or null if no values exist.
 */
function average(values) {
  const valid = values.filter(
    value => typeof value === 'number' &&
      Number.isFinite(value)
  );

  if (valid.length === 0) return null;

  const sum = valid.reduce((total, value) => total + value, 0);
  return Math.round((sum / valid.length) * 10) / 10;
}

/**
 * Extract numeric wind speed from NWS values such as:
 * "5 mph", "10 mph", or "5 to 10 mph".
 * For ranges, use the higher sustained wind speed.
 */
function parseWindSpeed(value) {
  if (typeof value !== 'string') return null;

  const match = value.match(
    /^(\d+(?:\.\d+)?)(?:\s+to\s+(\d+(?:\.\d+)?))?\s+mph$/i
  );

  if (!match) return null;

  return Number(match[2] || match[1]);
}

/**
 * Aggregate NWS hourly values for one period.
 */
function aggregateWeather(periods) {
  if (!Array.isArray(periods) || periods.length === 0) {
    return {
      temperatureMin: null,
      temperatureMax: null,
      temperatureAverage: null,
      windSpeed: null,
      humidity: null,
      precipitationChance: null
    };
  }

  const numbers = key => periods
    .map(period => period[key])
    .filter(value =>
      typeof value === 'number' && Number.isFinite(value)
    );

  const temperatures = numbers('temperature');

  const winds = periods
    .map(period => parseWindSpeed(period.windSpeed))
    .filter(value => value !== null);

  const humidities = periods
    .map(period => period.relativeHumidity?.value)
    .filter(value =>
      typeof value === 'number' && Number.isFinite(value)
    );

  const precipitation = periods
    .map(period => period.probabilityOfPrecipitation?.value)
    .filter(value =>
      typeof value === 'number' && Number.isFinite(value)
    );

  return {
    temperatureMin: temperatures.length
      ? Math.min(...temperatures) : null,

    temperatureMax: temperatures.length
      ? Math.max(...temperatures) : null,

    temperatureAverage: average(temperatures),

    windSpeed: winds.length
      ? Math.max(...winds) : null,

    humidity: average(humidities),

    precipitationChance: precipitation.length
      ? Math.max(...precipitation) : null
  };
}

module.exports = {
  average,
  parseWindSpeed,
  aggregateWeather
};
