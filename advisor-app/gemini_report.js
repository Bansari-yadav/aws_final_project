
'use strict';

const {
  buildAdvicePrompt,
  validateGeminiAdvice,
  fallbackAdvice
} = require('./advice_service');

const {
  reserveGeminiRequest
} = require('./gemini_quota');

const {
  readCachedAdvice,
  saveCachedAdvice
} = require('./advice_cache');

const GEMINI_API_BASE =
  process.env.GEMINI_API_BASE ||
  'https://generativelanguage.googleapis.com';

const GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  'gemini-3.1-flash-lite';

/**
 * Request structured advice from Gemini.
 * The API key is retrieved by the existing SSM function.
 */
async function requestGeminiAdvice(report, gender, getApiKey) {
  const prompt = buildAdvicePrompt(report, gender);
  const apiKey = await getApiKey();

  const url =
    `${GEMINI_API_BASE}/v1beta/models/` +
    `${encodeURIComponent(GEMINI_MODEL)}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text:
            'You are a weather safety advisor. ' +
            'Generate practical advice only. ' +
            'Do not invent weather measurements. ' +
            'Return exactly two JSON objects named ' +
            'morning and night. Each must contain ' +
            'road_conditions, dressing and accessories. ' +
            'Each value must be a short plain-text sentence. ' +
            'Do not include URLs, HTML or markdown.'
        }]
      },
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: 700
      }
    }),
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`Gemini HTTP ${response.status}`);
  }

  const data = await response.json();

  const rawText = (
    data.candidates?.[0]?.content?.parts || []
  )
    .map(part => part.text || '')
    .join('')
    .trim();

  if (!rawText) {
    throw new Error('Empty Gemini response');
  }

  let advice;

  try {
    advice = JSON.parse(rawText);
  } catch {
    throw new Error('Gemini returned invalid JSON');
  }

  if (!validateGeminiAdvice(advice)) {
    throw new Error('Gemini advice failed validation');
  }

  return advice;
}

/**
 * Generate advice using:
 * 1. DynamoDB cached advice
 * 2. Atomic daily Gemini quota
 * 3. Live Gemini request
 * 4. Rule-based fallback
 */
async function generateReportAdvice(report, gender, getApiKey) {

  // STEP 1: Check cached Gemini recommendations.
  // Fail closed if the cache cannot be checked.
  try {
    const cachedAdvice = await readCachedAdvice(
      report,
      gender,
      GEMINI_MODEL
    );

    if (cachedAdvice) {
      console.log('gemini_advice_cache_hit');

      return {
        advice: cachedAdvice,
        source: 'gemini',
        model: GEMINI_MODEL,
        cached: true
      };
    }

    console.log('gemini_advice_cache_miss');

  } catch (error) {
    console.warn('gemini_advice_cache_read_failed', {
      reason: error.name,
      message: error.message
    });

    return {
      advice: fallbackAdvice(report),
      source: 'fallback',
      model: null,
      cached: false
    };
  }

  // STEP 2: Reserve quota before calling Gemini.
  let reservation;

  try {
    reservation = await reserveGeminiRequest();
  } catch (error) {
    console.warn('gemini_quota_unavailable', {
      reason: error.name,
      message: error.message
    });

    return {
      advice: fallbackAdvice(report),
      source: 'fallback',
      model: null,
      cached: false
    };
  }

  if (!reservation.allowed) {
    console.warn('gemini_daily_limit_reached', {
      date: reservation.date,
      limit: reservation.limit
    });

    return {
      advice: fallbackAdvice(report),
      source: 'fallback',
      model: null,
      cached: false
    };
  }

  console.log('gemini_quota_reserved', {
    date: reservation.date,
    count: reservation.count,
    limit: reservation.limit
  });

  // STEP 3: Generate Gemini recommendations.
  try {
    const advice = await requestGeminiAdvice(
      report,
      gender,
      getApiKey
    );

    // STEP 4: Cache successful Gemini advice.
    // A cache write failure must not discard valid advice.
    try {
      await saveCachedAdvice(
        report,
        gender,
        GEMINI_MODEL,
        advice
      );

      console.log('gemini_advice_cache_saved');

    } catch (cacheError) {
      console.warn('gemini_advice_cache_write_failed', {
        reason: cacheError.name,
        message: cacheError.message
      });
    }

    return {
      advice,
      source: 'gemini',
      model: GEMINI_MODEL,
      cached: false
    };

  } catch (error) {
    // Never log API keys or personal email addresses.
    console.warn('gemini_report_fallback', {
      reason: error.name,
      message: error.message
    });

    return {
      advice: fallbackAdvice(report),
      source: 'fallback',
      model: null,
      cached: false
    };
  }
}

module.exports = {
  requestGeminiAdvice,
  generateReportAdvice
};
