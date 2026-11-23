
'use strict';

const express = require('express');

const {
  buildWeatherReport
} = require('./report_builder');

const {
  readCachedReport,
  saveCachedReport
} = require('./dynamo_cache');

const {
  isValidUSZip,
  parseISODate,
  isValidForecastDate
} = require('./validation');

const {
  getCoordinates,
  getNWSForecast
} = require('./weather_clients');

const app = express();

const PORT = Number(process.env.PORT || 3000);

const log = (event, fields = {}) => {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...fields
  }));
};


/**
 * Return today's date in the forecast location's
 * own timezone, using YYYY-MM-DD format.
 */
function localToday(timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}


/**
 * Homepage and ALB health-check endpoint.
 */
app.get('/', (req, res) => {
  res.json({
    service: 'weather',
    status: 'ok',
    usage: '/weather?zip=60616&date=YYYY-MM-DD',
    storage: 'dynamodb',
    sources: [
      'National Weather Service',
      'Open-Meteo'
    ]
  });
});


/**
 * Generate a Morning and Night weather report.
 *
 * Weather measurements come only from weather
 * providers, never from Gemini.
 *
 * DynamoDB stores cached weather reports.
 */
app.get('/weather', async (req, res) => {
  const zip = String(req.query.zip ?? '');
  const date = String(req.query.date ?? '');

  // Validate US ZIP code.
  if (!isValidUSZip(zip)) {
    return res.status(400).json({
      error: 'invalid_zip',
      message:
        'This service supports five-digit US ZIP codes only.'
    });
  }

  // Validate calendar date.
  if (!parseISODate(date)) {
    return res.status(400).json({
      error: 'invalid_date',
      message:
        'Enter a real date in YYYY-MM-DD format.'
    });
  }

  try {
    // Resolve the requested ZIP code.
    const location = await getCoordinates(zip);

    // Retrieve the location's timezone from NWS.
    const nws = await getNWSForecast(
      location.latitude,
      location.longitude
    );

    if (!nws.timezone) {
      throw new Error(
        'Location timezone unavailable'
      );
    }

    const today = localToday(nws.timezone);

    // Only allow today and the next six days.
    if (!isValidForecastDate(date, today)) {
      return res.status(400).json({
        error: 'date_out_of_range',
        message:
          'Select today or one of the next six days.'
      });
    }

    // ------------------------------------------
    // Step 1: Read DynamoDB weather cache.
    // ------------------------------------------

    let report = null;

    try {
      report = await readCachedReport(
        zip,
        date
      );

      if (report) {
        log('weather_cache_hit', {
          zip,
          date
        });
      }

    } catch (error) {
      log('weather_cache_read_failed', {
        reason: error.name
      });
    }

    // ------------------------------------------
    // Step 2: Generate report on cache miss.
    // ------------------------------------------

    if (!report) {
      log('weather_cache_miss', {
        zip,
        date
      });

      report = await buildWeatherReport(
        zip,
        date
      );

      // ----------------------------------------
      // Step 3: Save report in DynamoDB.
      // ----------------------------------------

      try {
        await saveCachedReport(
          zip,
          date,
          report
        );

        log('weather_cache_saved', {
          zip,
          date
        });

      } catch (error) {
        log('weather_cache_write_failed', {
          reason: error.name
        });
      }
    }

    // ------------------------------------------
    // Step 4: Return weather report.
    // ------------------------------------------

    return res.json(report);

  } catch (error) {

    if (error.message === 'ZIP code not found') {
      return res.status(404).json({
        error: 'zip_not_found',
        message: 'ZIP code not found.'
      });
    }

    log('weather_report_failed', {
      reason: error.name,
      message: error.message
    });

    return res.status(503).json({
      error: 'weather_unavailable',
      message:
        'Weather data is currently unavailable.'
    });
  }
});


/**
 * Start the Weather service.
 */
app.listen(PORT, () => {
  log('weather_started', {
    port: PORT,
    storage: 'dynamodb'
  });
});
