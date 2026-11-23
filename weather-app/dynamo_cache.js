
'use strict';

const {
  DynamoDBClient
} = require('@aws-sdk/client-dynamodb');

const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand
} = require('@aws-sdk/lib-dynamodb');

const REGION = process.env.AWS_REGION || 'us-east-2';

const TABLE_NAME =
  process.env.WEATHER_CACHE_TABLE ||
  'weather-advisor-cache';

const CACHE_SECONDS = Number(
  process.env.CACHE_SECONDS || 900
);

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION })
);

function currentSeconds() {
  return Math.floor(Date.now() / 1000);
}

function makeCacheKey(zip, date) {
  return `weather-report:v1:${zip}:${date}`;
}

async function readCachedReport(zip, date) {
  const result = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: makeCacheKey(zip, date)
      }
    })
  );

  const item = result.Item;

  if (!item) {
    return null;
  }

  if (
    typeof item.expiresAt !== 'number' ||
    item.expiresAt <= currentSeconds()
  ) {
    return null;
  }

  return item.report || null;
}

async function saveCachedReport(zip, date, report) {
  if (!Number.isFinite(CACHE_SECONDS) ||
      CACHE_SECONDS <= 0) {
    throw new Error('Invalid cache duration');
  }

  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: makeCacheKey(zip, date),
        report,
        createdAt: currentSeconds(),
        expiresAt: currentSeconds() + CACHE_SECONDS
      }
    })
  );
}

module.exports = {
  makeCacheKey,
  readCachedReport,
  saveCachedReport
};
