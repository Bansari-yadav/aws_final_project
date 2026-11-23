'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SNSClient,
  ListSubscriptionsByTopicCommand,
  PublishCommand,
  CreateTopicCommand,
  SubscribeCommand
} = require('@aws-sdk/client-sns');

const {
  DynamoDBDocumentClient,
  UpdateCommand
} = require('@aws-sdk/lib-dynamodb');

const {
  sendWeatherEmail,
  topicForRecipient
} = require('./sns_email');

const EMAIL_A = 'bansari2204@gmail.com';
const EMAIL_B = 'byadav1@hawk.illinoistech.edu';

const TOPIC_A = topicForRecipient(EMAIL_A);
const TOPIC_B = topicForRecipient(EMAIL_B);

function makeReport(marker) {
  return {
    date: '2026-11-19',
    location: {
      city: marker,
      state: 'IL',
      zip: '60616'
    },
    morning: {
      temperatureMinF: 40,
      temperatureMaxF: 50,
      windMph: 10,
      visibilityMiles: 9,
      uvIndex: 2,
      humidityPercent: 60,
      rain: 'No',
      snow: 'No'
    },
    night: {
      temperatureMinF: 35,
      temperatureMaxF: 45,
      windMph: 7,
      visibilityMiles: 8,
      uvIndex: 0,
      humidityPercent: 70,
      rain: 'No',
      snow: 'No'
    }
  };
}

function makeAdvice(marker) {
  return {
    source: 'gemini',
    advice: {
      morning: {
        road_conditions: `${marker} morning road advice`,
        dressing: `${marker} morning clothing`,
        accessories: `${marker} morning accessories`
      },
      night: {
        road_conditions: `${marker} night road advice`,
        dressing: `${marker} night clothing`,
        accessories: `${marker} night accessories`
      }
    }
  };
}

/*
 * Intercept both AWS clients.
 *
 * If an unexpected AWS request occurs, fail immediately.
 * No real SNS or DynamoDB network request is permitted.
 */
async function withMockedAWS(subscriptions, callback) {
  const originalSNS = SNSClient.prototype.send;
  const originalDB = DynamoDBDocumentClient.prototype.send;

  const publishes = [];
  const reservations = [];
  const checks = [];
  const created = [];
  const subscribeRequests = [];

  SNSClient.prototype.send = async function (command) {
    if (command instanceof ListSubscriptionsByTopicCommand) {
      const topicArn = command.input.TopicArn;
      checks.push(topicArn);

      return {
        Subscriptions: subscriptions[topicArn] || []
      };
    }

    if (command instanceof CreateTopicCommand) {
      created.push(command.input);
      return { TopicArn: `arn:aws:sns:us-east-2:587104705562:${command.input.Name}` };
    }

    if (command instanceof SubscribeCommand) {
      subscribeRequests.push(command.input);
      return { SubscriptionArn: 'pending confirmation' };
    }

    if (command instanceof PublishCommand) {
      publishes.push(command.input);

      return {
        MessageId: `mock-message-${publishes.length}`
      };
    }

    throw new Error('Unexpected SNS command');
  };

  DynamoDBDocumentClient.prototype.send = async function (command) {
    if (!(command instanceof UpdateCommand)) {
      throw new Error('Unexpected DynamoDB command');
    }

    reservations.push(command.input);

    return {
      Attributes: {
        requestCount: 1
      }
    };
  };

  try {
    return await callback({
      publishes,
      reservations,
      checks,
      created,
      subscribeRequests
    });
  } finally {
    SNSClient.prototype.send = originalSNS;
    DynamoDBDocumentClient.prototype.send = originalDB;
  }
}

function confirmed(email, topicArn) {
  return {
    TopicArn: topicArn,
    Protocol: 'email',
    Endpoint: email,
    SubscriptionArn: `${topicArn}:mock-confirmed`
  };
}

function validSubscriptions() {
  return {
    [TOPIC_A]: [confirmed(EMAIL_A, TOPIC_A)],
    [TOPIC_B]: [confirmed(EMAIL_B, TOPIC_B)]
  };
}

test('publishes Recipient A report only to Topic A', async () => {
  await withMockedAWS(validSubscriptions(), async (aws) => {
    const result = await sendWeatherEmail({
      email: EMAIL_A,
      consent: true,
      report: makeReport('RECIPIENT_A_REPORT'),
      adviceResult: makeAdvice('RECIPIENT_A_REPORT')
    });

    assert.equal(result.sent, true);
    assert.equal(aws.publishes.length, 1);
    assert.equal(aws.publishes[0].TopicArn, TOPIC_A);
    assert.deepEqual(aws.checks, [TOPIC_A]);
    assert.equal(aws.reservations.length, 1);

    assert.match(
      aws.publishes[0].Message,
      /RECIPIENT_A_REPORT/
    );
  });
});

test('publishes Recipient B report only to Topic B', async () => {
  await withMockedAWS(validSubscriptions(), async (aws) => {
    const result = await sendWeatherEmail({
      email: EMAIL_B,
      consent: true,
      report: makeReport('RECIPIENT_B_REPORT'),
      adviceResult: makeAdvice('RECIPIENT_B_REPORT')
    });

    assert.equal(result.sent, true);
    assert.equal(aws.publishes.length, 1);
    assert.equal(aws.publishes[0].TopicArn, TOPIC_B);
    assert.deepEqual(aws.checks, [TOPIC_B]);
    assert.equal(aws.reservations.length, 1);

    assert.match(
      aws.publishes[0].Message,
      /RECIPIENT_B_REPORT/
    );
  });
});

test('keeps both recipients reports isolated', async () => {
  await withMockedAWS(validSubscriptions(), async (aws) => {
    await sendWeatherEmail({
      email: EMAIL_A,
      consent: true,
      report: makeReport('PRIVATE_A_ONLY'),
      adviceResult: makeAdvice('PRIVATE_A_ONLY')
    });

    await sendWeatherEmail({
      email: EMAIL_B,
      consent: true,
      report: makeReport('PRIVATE_B_ONLY'),
      adviceResult: makeAdvice('PRIVATE_B_ONLY')
    });

    assert.equal(aws.publishes.length, 2);

    const sentA = aws.publishes.find(
      item => item.TopicArn === TOPIC_A
    );

    const sentB = aws.publishes.find(
      item => item.TopicArn === TOPIC_B
    );

    assert.ok(sentA);
    assert.ok(sentB);

    assert.match(sentA.Message, /PRIVATE_A_ONLY/);
    assert.doesNotMatch(sentA.Message, /PRIVATE_B_ONLY/);

    assert.match(sentB.Message, /PRIVATE_B_ONLY/);
    assert.doesNotMatch(sentB.Message, /PRIVATE_A_ONLY/);

    assert.equal(aws.reservations.length, 2);
  });
});

test('rejects wrong subscriber before publishing', async () => {
  const subscriptions = {
    [TOPIC_A]: [confirmed(EMAIL_B, TOPIC_A)]
  };

  await withMockedAWS(subscriptions, async (aws) => {
    await assert.rejects(
      sendWeatherEmail({
        email: EMAIL_A,
        consent: true,
        report: makeReport('PRIVATE_A'),
        adviceResult: makeAdvice('PRIVATE_A')
      }),
      /not confirmed or isolated/
    );

    assert.equal(aws.publishes.length, 0);
    assert.equal(aws.reservations.length, 0);
  });
});

test('new recipient gets isolated confirmation request, never a report before confirmation', async () => {
  await withMockedAWS(validSubscriptions(), async (aws) => {
    const response = await sendWeatherEmail({
      email: 'unknown@example.com',
      consent: true,
      report: makeReport('PRIVATE_UNKNOWN'),
      adviceResult: makeAdvice('PRIVATE_UNKNOWN')
    });
    assert.equal(response.sent, false);
    assert.equal(response.confirmationRequired, true);
    assert.equal(aws.created.length, 1);
    assert.match(aws.created[0].Name, /^weather-advisor-user-[a-f0-9]{64}$/);
    assert.equal(aws.subscribeRequests.length, 1);
    assert.equal(aws.subscribeRequests[0].Endpoint, 'unknown@example.com');
    assert.equal(aws.subscribeRequests[0].Protocol, 'email');
    assert.equal(aws.publishes.length, 0);
    assert.equal(aws.reservations.length, 1);
  });
});

test('rejects missing consent without publishing', async () => {
  await withMockedAWS(validSubscriptions(), async (aws) => {
    await assert.rejects(
      sendWeatherEmail({
        email: EMAIL_B,
        consent: false,
        report: makeReport('NO_CONSENT'),
        adviceResult: makeAdvice('NO_CONSENT')
      }),
      /Email consent is required/
    );

    assert.equal(aws.publishes.length, 0);
    assert.equal(aws.reservations.length, 0);
  });
});
