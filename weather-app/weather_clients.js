
'use strict';

const ZIP_API = process.env.ZIP_API_BASE ||
  'https://api.zippopotam.us';

const NWS_API = process.env.NWS_API_BASE ||
  'https://api.weather.gov';

const METEO_API = process.env.OPEN_METEO_API_BASE ||
  'https://api.open-meteo.com';

const USER_AGENT = process.env.NWS_USER_AGENT ||
  '(Weather Advisor Student Project, student@example.com)';

async function fetchJSON(url, headers = {}) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

// Convert ZIP into coordinates.
async function getCoordinates(zip) {
  if (!/^[0-9]{5}$/.test(zip)) {
    throw new Error('Invalid US ZIP code');
  }

  const response = await fetch(
    `${ZIP_API}/us/${zip}`,
    { signal: AbortSignal.timeout(8000) }
  );

  if (response.status === 404) {
    throw new Error('ZIP code not found');
  }

  if (!response.ok) {
    throw new Error(`ZIP API HTTP ${response.status}`);
  }

  const data = await response.json();
  const place = data.places?.[0];

  if (!place) {
    throw new Error('ZIP code not found');
  }

  return {
    zip,
    city: place['place name'],
    state: place['state abbreviation'],
    latitude: Number(place.latitude),
    longitude: Number(place.longitude)
  };
}

// Obtain NWS hourly forecasts.
async function getNWSForecast(latitude, longitude) {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'application/geo+json'
  };

  const point = await fetchJSON(
    `${NWS_API}/points/${latitude},${longitude}`,
    headers
  );

  const hourlyURL = point.properties?.forecastHourly;

  if (!hourlyURL) {
    throw new Error('NWS hourly forecast unavailable');
  }

  const hourly = await fetchJSON(hourlyURL, headers);

  return {
    timezone: point.properties?.timeZone,
    periods: hourly.properties?.periods || []
  };
}

// Get supplementary weather information.
async function getSupplementaryForecast(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: [
      'temperature_2m',
      'relative_humidity_2m',
      'wind_speed_10m',
      'visibility',
      'uv_index',
      'precipitation_probability',
      'rain',
      'snowfall'
    ].join(','),
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'mm',
    timezone: 'auto',
    forecast_days: '7'
  });

  return fetchJSON(
    `${METEO_API}/v1/forecast?${params}`
  );
}

module.exports = {
  getCoordinates,
  getNWSForecast,
  getSupplementaryForecast
};
