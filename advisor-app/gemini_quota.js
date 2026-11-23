
'use strict';

const {
  DynamoDBClient
} = require('@aws-sdk/client-dynamodb');

const {
  DynamoDBDocumentClient,
  UpdateCommand
} = require('@aws-sdk/lib-dynamodb');

const REGION = process.env.AWS_REGION || 'us-east-2';

const TABLE_NAME =
  process.env.GEMINI_USAGE_TABLE ||
  'weather-advisor-usage';

const DAILY_LIMIT = Number(
  process.env.GEMINI_DAILY_LIMIT || 20
);

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION })
);

/**
 * Return the current UTC date in YYYY-MM-DD format.
 */
function utcDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Generate the DynamoDB key for a single UTC day.
 */
function usageKey(date = utcDate()) {
  return `gemini-requests:v1:${date}`;
}

/**
 * Set TTL to midnight UTC two days after the usage date.
 */
function expirationSeconds(date) {
  const expiration = new Date(`${date}T00:00:00Z`);

  if (Number.isNaN(expiration.getTime())) {
    throw new Error('Invalid expiration date');
  }

  expiration.setUTCDate(expiration.getUTCDate() + 2);

  return Math.floor(expiration.getTime() / 1000);
}

/**
 * Atomically reserve one Gemini request.
 *
 * - Uses the actual current UTC date.
 * - Allows at most DAILY_LIMIT reservations per day.
 * - Prevents simultaneous requests from exceeding the limit.
 * - Stores TTL using the expiresAt attribute.
 * - Does not call Gemini.
 *
 * The caller must fail closed if DynamoDB is unavailable.
 */
async function reserveGeminiRequest() {
  if (!Number.isInteger(DAILY_LIMIT) || DAILY_LIMIT < 1) {
    throw new Error('Invalid Gemini daily limit');
  }

  // FIX: Always define date before using it.
  // Production callers cannot override this date.
  const date = utcDate();

  try {
    const result = await db.send(
      new UpdateCommand({
        TableName: TABLE_NAME,

        Key: {
          pk: usageKey(date)
        },

        UpdateExpression:
          'SET #count = if_not_exists(#count, :zero) + :one, ' +
          '#expiresAt = :expiresAt',

        ConditionExpression:
          'attribute_not_exists(#count) OR #count < :limit',

        ExpressionAttributeNames: {
          '#count': 'requestCount',
          '#expiresAt': 'expiresAt'
        },

        ExpressionAttributeValues: {
          ':zero': 0,
          ':one': 1,
          ':limit': DAILY_LIMIT,
          ':expiresAt': expirationSeconds(date)
        },

        ReturnValues: 'UPDATED_NEW'
      })
    );

    return {
      allowed: true,
      date,
      count: result.Attributes.requestCount,
      limit: DAILY_LIMIT
    };

  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      return {
        allowed: false,
        date,
        count: DAILY_LIMIT,
        limit: DAILY_LIMIT
      };
    }

    // Do not allow Gemini requests when quota
    // verification fails.
    throw error;
  }
}

module.exports = {
  utcDate,
  usageKey,
  expirationSeconds,
  reserveGeminiRequest
};
