
'use strict';

const crypto = require('node:crypto');

const {
  DynamoDBClient
} = require('@aws-sdk/client-dynamodb');

const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand
} = require('@aws-sdk/lib-dynamodb');

const {
  validateGeminiAdvice
} = require('./advice_service');

const REGION = process.env.AWS_REGION || 'us-east-2';

const TABLE_NAME =
  process.env.WEATHER_CACHE_TABLE ||
  'weather-advisor-cache';

const ADVICE_CACHE_SECONDS = Number(
  process.env.ADVICE_CACHE_SECONDS || 900
);

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION })
);

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Generate a deterministic cache key.
 *
 * Include the full weather report so updated forecasts
 * produce different cache keys.
 *
 * Include clothing category because advice depends on it.
 *
 * Never include the user's email address.
 */
function makeAdviceCacheKey(report, clothingCategory, model) {
  const relevant = {
    report,
    clothingCategory,
    model
  };

  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(relevant))
    .digest('hex');

  return `gemini-advice:v1:${digest}`;
}

/**
 * Return valid cached advice or null.
 *
 * DynamoDB TTL deletion is asynchronous,
 * so expiration must also be checked here.
 */
async function readCachedAdvice(
  report,
  clothingCategory,
  model
) {
  const pk = makeAdviceCacheKey(
    report,
    clothingCategory,
    model
  );

  const result = await db.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk }
    })
  );

  const item = result.Item;

  if (!item) {
    return null;
  }

  if (
    typeof item.expiresAt !== 'number' ||
    item.expiresAt <= nowSeconds()
  ) {
    return null;
  }

  if (!validateGeminiAdvice(item.advice)) {
    return null;
  }

  return item.advice;
}

/**
 * Save only successfully validated Gemini advice.
 * Never cache fallback recommendations.
 */
async function saveCachedAdvice(
  report,
  clothingCategory,
  model,
  advice
) {
  if (!validateGeminiAdvice(advice)) {
    throw new Error('Cannot cache invalid Gemini advice');
  }

  if (
    !Number.isInteger(ADVICE_CACHE_SECONDS) ||
    ADVICE_CACHE_SECONDS <= 0
  ) {
    throw new Error('Invalid advice cache duration');
  }

  const createdAt = nowSeconds();

  await db.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: makeAdviceCacheKey(
          report,
          clothingCategory,
          model
        ),
        advice,
        model,
        createdAt,
        expiresAt: createdAt + ADVICE_CACHE_SECONDS
      }
    })
  );
}

module.exports = {
  makeAdviceCacheKey,
  readCachedAdvice,
  saveCachedAdvice
};
