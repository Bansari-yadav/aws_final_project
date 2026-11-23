
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SNSClient
} = require('@aws-sdk/client-sns');

const {
  verifyTopicRecipient
} = require('./sns_email');

const {
  emailHash,
  emailUsageKey,
  expirationSeconds
} = require('./email_rate_limit');

const TOPIC =
  'arn:aws:sns:us-east-2:587104705562:weather-advisor-final-reports';

const EMAIL = 'bansari2204@gmail.com';

function subscription(email, arn = `${TOPIC}:test-subscription`) {
  return {
    TopicArn: TOPIC,
    Protocol: 'email',
    Endpoint: email,
    SubscriptionArn: arn
  };
}

// Replace AWS network calls with simulated responses.
// These tests never contact SNS or DynamoDB.
async function withMockedSubscriptions(pages, callback) {
  const originalSend = SNSClient.prototype.send;
  let callCount = 0;

  SNSClient.prototype.send = async () => {
    const page = pages[callCount++];

    if (!page) {
      throw new Error('Unexpected SNS request');
    }

    return page;
  };

  try {
    return await callback();
  } finally {
    SNSClient.prototype.send = originalSend;
  }
}

test('accepts exactly one confirmed approved recipient', async () => {
  await withMockedSubscriptions(
    [{ Subscriptions: [subscription(EMAIL)] }],
    async () => {
      assert.equal(await verifyTopicRecipient(EMAIL), true);
    }
  );
});

test('rejects an incorrect subscriber', async () => {
  await withMockedSubscriptions(
    [{ Subscriptions: [subscription('other@example.com')] }],
    async () => {
      await assert.rejects(
        verifyTopicRecipient(EMAIL),
        /not confirmed or isolated/
      );
    }
  );
});

test('rejects multiple subscribers', async () => {
  await withMockedSubscriptions(
    [{
      Subscriptions: [
        subscription(EMAIL),
        subscription('other@example.com')
      ]
    }],
    async () => {
      await assert.rejects(
        verifyTopicRecipient(EMAIL),
        /exactly one subscription/
      );
    }
  );
});

test('rejects an unconfirmed subscription', async () => {
  await withMockedSubscriptions(
    [{
      Subscriptions: [
        subscription(EMAIL, 'PendingConfirmation')
      ]
    }],
    async () => {
      await assert.rejects(
        verifyTopicRecipient(EMAIL),
        /not confirmed or isolated/
      );
    }
  );
});

test('rejects empty SNS subscription list', async () => {
  await withMockedSubscriptions(
    [{ Subscriptions: [] }],
    async () => {
      await assert.rejects(
        verifyTopicRecipient(EMAIL),
        /exactly one subscription/
      );
    }
  );
});

test('checks every SNS pagination page', async () => {
  await withMockedSubscriptions(
    [
      {
        Subscriptions: [subscription(EMAIL)],
        NextToken: 'next-page'
      },
      {
        Subscriptions: [
          subscription('other@example.com')
        ]
      }
    ],
    async () => {
      await assert.rejects(
        verifyTopicRecipient(EMAIL),
        /exactly one subscription/
      );
    }
  );
});

test('does not expose email in DynamoDB key', () => {
  const key = emailUsageKey(EMAIL, '2026-11-19');

  assert.equal(key.includes('@'), false);
  assert.equal(key.includes(EMAIL), false);
  assert.match(key, /^email-requests:v1:2026-11-19:[a-f0-9]{64}$/);
});

test('normalizes email before hashing', () => {
  assert.equal(
    emailHash('BANSARI2204@GMAIL.COM'),
    emailHash('bansari2204@gmail.com')
  );
});

test('sets expiration two days after UTC date', () => {
  assert.equal(
    expirationSeconds('2026-11-19'),
    Math.floor(Date.parse('2026-11-21T00:00:00Z') / 1000)
  );
});
