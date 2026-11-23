
'use strict';

const {
  getCoordinates,
  getNWSForecast,
  getSupplementaryForecast
} = require('./weather_clients');

const {
  selectPeriodHours
} = require('./period_selector');

const {
  aggregateWeather
} = require('./aggregation');

const {
  classifyRain,
  classifySnow,
  classifyPeriod
} = require('./precipitation');

const MILES_PER_METER = 1 / 1609.344;

function average(values) {
  const nums = values.filter(
    x => typeof x === 'number' && Number.isFinite(x)
  );

  if (!nums.length) return null;

  return Math.round(
    nums.reduce((a, b) => a + b, 0) / nums.length * 10
  ) / 10;
}

function maximum(values) {
  const nums = values.filter(
    x => typeof x === 'number' && Number.isFinite(x)
  );

  return nums.length ? Math.max(...nums) : null;
}

function minimum(values) {
  const nums = values.filter(
    x => typeof x === 'number' && Number.isFinite(x)
  );

  return nums.length ? Math.min(...nums) : null;
}

// Select Open-Meteo hourly records using its local timestamps.
function selectMeteoHours(data, date, startHour, endHour) {
  const hourly = data.hourly || {};
  const selected = [];

  for (let i = 0; i < (hourly.time || []).length; i++) {
    const time = hourly.time[i];
    const localDate = time.slice(0, 10);
    const hour = Number(time.slice(11, 13));

    if (
      localDate === date &&
      hour >= startHour &&
      hour < endHour
    ) {
      selected.push({
        temperature: hourly.temperature_2m?.[i] ?? null,
        humidity: hourly.relative_humidity_2m?.[i] ?? null,
        wind: hourly.wind_speed_10m?.[i] ?? null,
        visibility: hourly.visibility?.[i] ?? null,
        uv: hourly.uv_index?.[i] ?? null,
        rain: hourly.rain?.[i] ?? null,
        snowfall: hourly.snowfall?.[i] ?? null,
        precipitationChance:
          hourly.precipitation_probability?.[i] ?? null
      });
    }
  }

  return selected;
}

function summarizePeriod(nwsPeriods, meteoPeriods) {
  const nws = aggregateWeather(nwsPeriods);

  const meteoValues = key =>
    meteoPeriods.map(p => p[key]);

  const visibilityMeters = minimum(
    meteoValues('visibility')
  );

  // Require all six hours for reliable peak-intensity labels.
  const completeMeteo = meteoPeriods.length === 6;

  const rainValues = meteoValues('rain');
  const snowValues = meteoValues('snowfall');

  return {
    temperatureMinF: nws.temperatureMin ??
      minimum(meteoValues('temperature')),

    temperatureMaxF: nws.temperatureMax ??
      maximum(meteoValues('temperature')),

    windMph: nws.windSpeed ??
      maximum(meteoValues('wind')),

    humidityPercent: nws.humidity ??
      average(meteoValues('humidity')),

    visibilityMiles: visibilityMeters === null
      ? null
      : Math.round(
          visibilityMeters * MILES_PER_METER * 10
        ) / 10,

    uvIndex: maximum(meteoValues('uv')),

    precipitationChancePercent:
      nws.precipitationChance ??
      maximum(meteoValues('precipitationChance')),

    rain: completeMeteo
      ? classifyPeriod(rainValues, classifyRain)
      : 'Not available',

    snow: completeMeteo
      ? classifyPeriod(snowValues, classifySnow)
      : 'Not available',

    nwsHours: nwsPeriods.length,
    supplementaryHours: meteoPeriods.length
  };
}

async function buildWeatherReport(zip, date) {
  const location = await getCoordinates(zip);

  const [nws, meteo] = await Promise.all([
    getNWSForecast(
      location.latitude, location.longitude
    ),
    getSupplementaryForecast(
      location.latitude, location.longitude
    )
  ]);

  if (!nws.timezone || nws.timezone !== meteo.timezone) {
    throw new Error('Weather source timezone mismatch');
  }

  const nwsPeriods = selectPeriodHours(
    nws.periods,
    date,
    nws.timezone
  );

  const morningMeteo = selectMeteoHours(
    meteo, date, 6, 12
  );

  const nightMeteo = selectMeteoHours(
    meteo, date, 18, 24
  );

  return {
    location,
    date,
    timezone: nws.timezone,
    morning: summarizePeriod(
      nwsPeriods.morning, morningMeteo
    ),
    night: summarizePeriod(
      nwsPeriods.night, nightMeteo
    ),
    sources: [
      'National Weather Service',
      'Open-Meteo'
    ]
  };
}

module.exports = {
  selectMeteoHours,
  summarizePeriod,
  buildWeatherReport
};
