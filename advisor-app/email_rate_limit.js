
'use strict';

const crypto = require('node:crypto');

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

const DAILY_EMAIL_LIMIT = Number(
  process.env.EMAIL_DAILY_LIMIT || 5
);

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION })
);

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Hash the email so that DynamoDB partition keys
 * do not contain personal email addresses.
 */
function emailHash(email) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();

  if (
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new Error('Invalid email address');
  }

  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex');
}

function emailUsageKey(email, date = utcDate()) {
  return `email-requests:v1:${date}:${emailHash(email)}`;
}

function expirationSeconds(date) {
  const expiration = new Date(`${date}T00:00:00Z`);

  if (Number.isNaN(expiration.getTime())) {
    throw new Error('Invalid date');
  }

  expiration.setUTCDate(expiration.getUTCDate() + 2);

  return Math.floor(expiration.getTime() / 1000);
}

/**
 * Atomically reserve one email delivery attempt.
 *
 * Counts attempts, including unsuccessful SNS sends.
 * This prevents repeated failures from bypassing
 * the daily limit.
 */
async function reserveEmailRequest(email) {
  if (
    !Number.isInteger(DAILY_EMAIL_LIMIT) ||
    DAILY_EMAIL_LIMIT < 1
  ) {
    throw new Error('Invalid email daily limit');
  }

  const date = utcDate();
  const pk = emailUsageKey(email, date);

  try {
    const result = await db.send(
      new UpdateCommand({
        TableName: TABLE_NAME,

        Key: { pk },

        UpdateExpression:
          'SET #count = if_not_exists(#count, :zero) + :one, ' +
          '#expiresAt = :expiration',

        ConditionExpression:
          'attribute_not_exists(#count) OR #count < :limit',

        ExpressionAttributeNames: {
          '#count': 'requestCount',
          '#expiresAt': 'expiresAt'
        },

        ExpressionAttributeValues: {
          ':zero': 0,
          ':one': 1,
          ':limit': DAILY_EMAIL_LIMIT,
          ':expiration': expirationSeconds(date)
        },

        ReturnValues: 'UPDATED_NEW'
      })
    );

    return {
      allowed: true,
      date,
      count: result.Attributes.requestCount,
      limit: DAILY_EMAIL_LIMIT
    };

  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      return {
        allowed: false,
        date,
        count: DAILY_EMAIL_LIMIT,
        limit: DAILY_EMAIL_LIMIT
      };
    }

    // Fail closed if DynamoDB is unavailable.
    throw error;
  }
}

module.exports = {
  emailHash,
  emailUsageKey,
  expirationSeconds,
  reserveEmailRequest
};
