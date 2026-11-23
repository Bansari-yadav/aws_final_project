
'use strict';

const express = require('express');
const crypto = require('node:crypto');

const {
  SSMClient,
  GetParameterCommand
} = require('@aws-sdk/client-ssm');

const {
  DynamoDBClient
} = require('@aws-sdk/client-dynamodb');

const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand
} = require('@aws-sdk/lib-dynamodb');

const { renderForm } = require('./views/form');
const { generateReportAdvice } = require('./gemini_report');
const { sendWeatherEmail } = require('./sns_email');

const app = express();

app.disable('x-powered-by');

app.use(express.urlencoded({
  extended: false,
  limit: '4kb'
}));

const PORT = Number(process.env.PORT || 3001);

const WEATHER_URL =
  process.env.WEATHER_URL || 'http://localhost:3000';

const REGION = process.env.AWS_REGION || 'us-east-2';

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

const KEY_PARAM =
  process.env.GEMINI_KEY_PARAM ||
  '/itmo-444-544/gemini-api-key';

const KEY_CACHE_MS =
  Number(process.env.KEY_CACHE_SECONDS || 300) * 1000;

const REPORT_TABLE =
  process.env.REPORT_TABLE || 'weather-advisor-cache';

const REPORT_TTL_SECONDS = 15 * 60;

const ssm = new SSMClient({ region: REGION });

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION })
);

let cachedKey = { value: null, at: 0 };

function log(event, fields = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...fields
  }));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function validEmail(email) {
  return (
    email.length > 0 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function validateInputs(body) {
  const zip = String(body.zip ?? '');
  const date = String(body.date ?? '');
  const gender = String(body.gender ?? '');
  const email = normalizeEmail(body.email);

  if (!/^\d{5}$/.test(zip)) {
    return {
      error: 'Only five-digit US ZIP codes are supported.'
    };
  }

  if (!validCalendarDate(date)) {
    return {
      error: 'Select a valid calendar date.'
    };
  }

  if (!['neutral', 'menswear', 'womenswear'].includes(gender)) {
    return {
      error: 'Select a valid clothing category.'
    };
  }

  if (!validEmail(email)) {
    return {
      error: 'Enter a valid email address.'
    };
  }

  return { zip, date, gender, email };
}

function recipientDigest(token, email) {
  return crypto.createHash('sha256')
    .update(token)
    .update('\0')
    .update(normalizeEmail(email))
    .digest('hex');
}

function validToken(token) {
  return typeof token === 'string' &&
    /^[a-f0-9]{64}$/.test(token);
}

async function saveReport(report, adviceResult, email) {
  const token = crypto.randomBytes(32).toString('hex');

  const expiresAt =
    Math.floor(Date.now() / 1000) + REPORT_TTL_SECONDS;

  await db.send(new PutCommand({
    TableName: REPORT_TABLE,
    Item: {
      pk: `report:v1:${token}`,
      recipientDigest: recipientDigest(token, email),
      report,
      adviceResult,
      expiresAt
    },
    ConditionExpression: 'attribute_not_exists(pk)'
  }));

  return token;
}

async function loadReport(token) {
  if (!validToken(token)) {
    return null;
  }

  const response = await db.send(new GetCommand({
    TableName: REPORT_TABLE,
    Key: { pk: `report:v1:${token}` }
  }));

  const item = response.Item;

  if (!item || Number(item.expiresAt) <= Date.now() / 1000) {
    return null;
  }

  if (!item.report || !item.adviceResult ||
      !item.recipientDigest) {
    return null;
  }

  return item;
}

function sameRecipient(token, email, savedDigest) {
  if (
    typeof savedDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(savedDigest)
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(recipientDigest(token, email), 'hex'),
    Buffer.from(savedDigest, 'hex')
  );
}

async function getApiKey() {
  if (
    cachedKey.value &&
    Date.now() - cachedKey.at < KEY_CACHE_MS
  ) {
    return cachedKey.value;
  }

  const result = await ssm.send(new GetParameterCommand({
    Name: KEY_PARAM,
    WithDecryption: true
  }));

  const key = result.Parameter?.Value;

  if (!key) {
    throw new Error('Gemini API key unavailable');
  }

  cachedKey = { value: key, at: Date.now() };
  return key;
}

function fallbackLegacyAdvice(forecast) {
  const temp = forecast.temperature;

  if (typeof temp !== 'number') {
    return 'Check the latest forecast before choosing clothing.';
  }

  if (temp <= 32) {
    return 'Wear a heavy coat, gloves and a hat.';
  }

  if (temp <= 50) {
    return 'Wear a warm jacket and layered clothing.';
  }

  if (temp <= 68) {
    return 'Wear a light jacket or sweater.';
  }

  if (temp <= 80) {
    return 'Wear comfortable, lightweight clothing.';
  }

  return 'Wear breathable clothing and carry water.';
}

// Preserve the original Lab06 advice endpoint.
app.get('/advice', async (req, res) => {
  const zip = String(req.query.zip ?? '');

  if (!/^\d{5}$/.test(zip)) {
    return res.status(400).json({
      error: 'invalid_zip',
      message: 'Enter a five-digit US ZIP code.'
    });
  }

  try {
    const response = await fetch(
      `${WEATHER_URL}/weather?zip=${zip}`,
      { signal: AbortSignal.timeout(20000) }
    );

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'weather_unavailable'
      });
    }

    const weather = await response.json();

    if (!weather.forecast) {
      return res.status(503).json({
        error: 'invalid_weather_response'
      });
    }

    return res.json({
      ...weather,
      advice: fallbackLegacyAdvice(weather.forecast),
      source: 'fallback'
    });

  } catch (error) {
    log('legacy_advice_error', { reason: error.name });

    return res.status(503).json({
      error: 'weather_service_unavailable'
    });
  }
});

function display(value, suffix = '') {
  if (value === null || value === undefined) {
    return 'Not available';
  }

  return escapeHtml(value) + suffix;
}

function temperature(period) {
  if (
    period.temperatureMinF == null ||
    period.temperatureMaxF == null
  ) {
    return 'Not available';
  }

  return (
    display(period.temperatureMinF) +
    '–' +
    display(period.temperatureMaxF) +
    ' °F'
  );
}

function tableRow(label, morning, night) {
  return `<tr>
    <td>${escapeHtml(label)}</td>
    <td>${morning}</td>
    <td>${night}</td>
  </tr>`;
}

function htmlPage(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #f3f6fa;
      padding: 30px 16px;
      margin: 0;
    }
    main {
      max-width: 1000px;
      margin: auto;
      padding: 30px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 20px #0001;
    }
    h1, h2 { color: #17365d; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    th, td {
      padding: 12px;
      border: 1px solid #ddd;
      text-align: left;
      vertical-align: top;
    }
    th { background: #e7f0fa; }
    tr:nth-child(even) { background: #f8fafc; }
    .email-panel {
      margin-top: 26px;
      padding: 20px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
    }
    .email-panel label { display: block; margin: 12px 0; }
    .email-panel input[type=email] {
      width: 100%;
      box-sizing: border-box;
      padding: 10px;
    }
    button {
      background: #1769aa;
      color: white;
      padding: 12px 20px;
      border: 0;
      border-radius: 6px;
      cursor: pointer;
    }
    .note { color: #555; line-height: 1.5; }
    .status {
      background: #eef4fa;
      padding: 12px;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`;
}

function renderError(message) {
  return htmlPage('Weather Advisor Error', `
    <h1>Unable to Complete Request</h1>
    <p>${escapeHtml(message)}</p>
    <a href="/">Return to Weather Advisor</a>
  `);
}

function renderReport(
  report,
  adviceResult,
  token,
  email,
  emailStatus = 'Email has not been requested.'
) {
  const morning = report.morning;
  const night = report.night;
  const advice = adviceResult.advice;

  const rows = [
    tableRow(
      'Temperature',
      temperature(morning),
      temperature(night)
    ),
    tableRow(
      'Wind Speed',
      display(morning.windMph, ' mph'),
      display(night.windMph, ' mph')
    ),
    tableRow(
      'Visibility',
      display(morning.visibilityMiles, ' miles'),
      display(night.visibilityMiles, ' miles')
    ),
    tableRow(
      'UV Index',
      display(morning.uvIndex),
      display(night.uvIndex)
    ),
    tableRow(
      'Humidity',
      display(morning.humidityPercent, '%'),
      display(night.humidityPercent, '%')
    ),
    tableRow(
      'Rain',
      display(morning.rain),
      display(night.rain)
    ),
    tableRow(
      'Snow',
      display(morning.snow),
      display(night.snow)
    ),
    tableRow(
      'Suggested Road Conditions',
      display(advice.morning.road_conditions),
      display(advice.night.road_conditions)
    ),
    tableRow(
      'Suggested Dressing',
      display(advice.morning.dressing),
      display(advice.night.dressing)
    ),
    tableRow(
      'Suggested Accessories',
      display(advice.morning.accessories),
      display(advice.night.accessories)
    )
  ].join('');

  const emailForm = token ? `
    <section class="email-panel">
      <h2>Send Report to Email</h2>

      <p class="note">
        Email sending is optional. Reports expire after
        15 minutes. The address must match the address
        entered when this report was generated.
      </p>

      <form method="POST" action="/send-report">
        <input type="hidden"
               name="reportToken"
               value="${escapeHtml(token)}">

        <label for="email">Report recipient</label>
        <input type="email"
               name="email"
               id="email"
               maxlength="254"
               value="${escapeHtml(email)}"
               required>

        <label>
          <input type="checkbox"
                 name="emailConsent"
                 value="yes"
                 required>
          I consent to receive this weather report by email.
        </label>

        <button type="submit">Send Report to Email</button>
      </form>

      <p class="note">
        First-time users receive an AWS SNS subscription confirmation email.
        Click the confirmation link, then click Send Report to Email again.
        If the report expires after 15 minutes, generate a new one.
      </p>
    </section>
  ` : '';

  return htmlPage('Weather Advisor Report', `
    <h1>Weather Advisor Report</h1>

    <p><strong>Location:</strong>
      ${escapeHtml(report.location.city)},
      ${escapeHtml(report.location.state)}
    </p>

    <p><strong>ZIP:</strong>
      ${escapeHtml(report.location.zip)}
    </p>

    <p><strong>Date:</strong>
      ${escapeHtml(report.date)}
    </p>

    <p><strong>Timezone:</strong>
      ${escapeHtml(report.timezone)}
    </p>

    <table>
      <thead>
        <tr>
          <th>Weather Item</th>
          <th>Morning (6 AM–12 PM)</th>
          <th>Night (6 PM–12 AM)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <p class="note">
      Weather sources: National Weather Service and Open-Meteo.
      <strong>Advice source:</strong>
      ${escapeHtml(adviceResult.source)}.
    </p>

    <p class="status">${escapeHtml(emailStatus)}</p>

    ${emailForm}

    <p><a href="/">Generate Another Report</a></p>
  `);
}

app.get('/', (req, res) => {
  res.type('html').send(renderForm());
});

app.post('/report', async (req, res) => {
  const input = validateInputs(req.body);

  if (input.error) {
    return res.status(400).type('html').send(
      renderError(input.error)
    );
  }

  try {
    const params = new URLSearchParams({
      zip: input.zip,
      date: input.date
    });

    const weatherResponse = await fetch(
      `${WEATHER_URL}/weather?${params.toString()}`,
      { signal: AbortSignal.timeout(25000) }
    );

    if (!weatherResponse.ok) {
      const errorData = await weatherResponse.json()
        .catch(() => ({}));

      const status =
        weatherResponse.status >= 500 ? 503 :
        weatherResponse.status === 404 ? 404 : 400;

      return res.status(status).type('html').send(
        renderError(
          errorData.message ||
          'Unable to generate the weather report.'
        )
      );
    }

    const report = await weatherResponse.json();

    if (
      !report.location ||
      !report.morning ||
      !report.night
    ) {
      throw new Error('Invalid weather response');
    }

    // Gemini supplies advice, never weather measurements.
    const adviceResult = await generateReportAdvice(
      report,
      input.gender,
      getApiKey
    );

    // Save without storing the plaintext email or gender.
    const token = await saveReport(
      report,
      adviceResult,
      input.email
    );

    // Report generation does NOT send an email.
    return res.type('html').send(
      renderReport(
        report,
        adviceResult,
        token,
        input.email
      )
    );

  } catch (error) {
    log('report_failed', { reason: error.name });

    return res.status(503).type('html').send(
      renderError('Unable to generate the weather report.')
    );
  }
});

app.post('/send-report', async (req, res) => {
  const token = String(req.body.reportToken ?? '');
  const email = normalizeEmail(req.body.email);
  const consent = req.body.emailConsent === 'yes';

  if (!validToken(token) || !validEmail(email)) {
    return res.status(400).type('html').send(
      renderError('Invalid email request.')
    );
  }

  if (!consent) {
    return res.status(400).type('html').send(
      renderError('Email consent is required.')
    );
  }

  try {
    const saved = await loadReport(token);

    if (!saved) {
      return res.status(410).type('html').send(
        renderError(
          'This report has expired. Generate a new report.'
        )
      );
    }

    if (!sameRecipient(
      token,
      email,
      saved.recipientDigest
    )) {
      return res.status(403).type('html').send(
        renderError(
          'The email address does not match the report recipient.'
        )
      );
    }

    let emailStatus;

    if (process.env.ENABLE_SNS_EMAIL !== 'true') {
      emailStatus = 'Email delivery is currently disabled.';
    } else {
      try {
        const result = await sendWeatherEmail({
          email,
          consent,
          report: saved.report,
          adviceResult: saved.adviceResult
        });

        if (result.confirmationRequired) {
          emailStatus =
            'Check your inbox for the AWS subscription confirmation link. ' +
            'Confirm it, then click Send Report to Email again. ' +
            'If your report expires, generate a new one.';
          log('email_confirmation_required');
        } else {
          emailStatus =
            'Email accepted by SNS. Check your inbox. ' +
            'Final delivery is not guaranteed.';
          log('email_publish_accepted', {
            messageId: result.messageId
          });
        }

      } catch (error) {
        log('email_delivery_failed', {
          reason: error.name
        });

        emailStatus =
          'The report was generated, but email could ' +
          'not be sent. Check the recipient subscription ' +
          'and sending limits.';
      }
    }

    return res.type('html').send(
      renderReport(
        saved.report,
        saved.adviceResult,
        token,
        email,
        emailStatus
      )
    );

  } catch (error) {
    log('send_report_failed', { reason: error.name });

    return res.status(503).type('html').send(
      renderError(
        'Email service is temporarily unavailable.'
      )
    );
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    log('advisor_started', {
      port: PORT,
      model: GEMINI_MODEL
    });
  });
}

module.exports = {
  app,
  validateInputs,
  escapeHtml,
  recipientDigest,
  sameRecipient,
  renderReport
};
