
'use strict';

const crypto = require('node:crypto');

const {
  SNSClient,
  PublishCommand,
  ListSubscriptionsByTopicCommand,
  CreateTopicCommand,
  SubscribeCommand
} = require('@aws-sdk/client-sns');

const {
  reserveEmailRequest
} = require('./email_rate_limit');

const REGION = process.env.AWS_REGION || 'us-east-2';

const TOPIC_ARN =
  process.env.SNS_TOPIC_ARN ||
  'arn:aws:sns:us-east-2:587104705562:weather-advisor-final-reports';

const TEST_RECIPIENT =
  process.env.SNS_TEST_RECIPIENT ||
  'bansari2204@gmail.com';

const SECOND_TOPIC_ARN =
  process.env.SNS_SECOND_TOPIC_ARN ||
  'arn:aws:sns:us-east-2:587104705562:weather-advisor-recipient-b';

const SECOND_RECIPIENT =
  process.env.SNS_SECOND_RECIPIENT ||
  'byadav1@hawk.illinoistech.edu';

const sns = new SNSClient({ region: REGION });

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateEmail(email) {
  return typeof email === 'string' &&
    email.length > 0 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Select the recipient's dedicated SNS topic.
 * Unknown addresses are rejected instead of broadcast.
 */
function topicForRecipient(email) {
  const recipient = normalizeEmail(email);

  if (!validateEmail(recipient)) {
    throw new Error('Invalid email address');
  }

  if (recipient === normalizeEmail(TEST_RECIPIENT)) {
    return TOPIC_ARN;
  }

  if (recipient === normalizeEmail(SECOND_RECIPIENT)) {
    return SECOND_TOPIC_ARN;
  }

  throw new Error(
    'Email recipient does not have an approved SNS subscription'
  );
}

/**
 * Each new email receives an account-scoped dedicated SNS topic.
 * SNS never publishes a report until that email confirms its subscription.
 * Do not include plaintext email in a topic name.
 */
function registrationTopicName(email) {
  const recipient = normalizeEmail(email);
  if (!validateEmail(recipient)) throw new Error('Invalid email address');
  const digest = crypto.createHash('sha256').update(recipient).digest('hex');
  return `weather-advisor-user-${digest}`;
}

async function getSubscriptions(topicArn) {
  const subscriptions = [];
  let nextToken;
  do {
    const page = await sns.send(new ListSubscriptionsByTopicCommand({
      TopicArn: topicArn, NextToken: nextToken
    }));
    subscriptions.push(...(page.Subscriptions || []));
    nextToken = page.NextToken;
  } while (nextToken);
  return subscriptions;
}

async function ensureRecipientReady(email) {
  const recipient = normalizeEmail(email);
  let knownTopic;
  try {
    knownTopic = topicForRecipient(recipient);
  } catch (error) {
    if (!validateEmail(recipient)) throw error;
  }

  if (knownTopic) {
    await verifyTopicRecipient(recipient, knownTopic);
    return { topicArn: knownTopic, ready: true };
  }

  // Reserve quota before creating a new topic or triggering any subscription email.
  // The same recipient's daily limit protects repeat registration attempts.
  const reservation = await reserveEmailRequest(recipient);
  if (!reservation.allowed) throw new Error('Daily email limit reached');

  const topicName = registrationTopicName(recipient);
  const response = await sns.send(new CreateTopicCommand({ Name: topicName }));
  const topicArn = response.TopicArn;
  if (!topicArn || !topicArn.endsWith(`:${topicName}`)) {
    throw new Error('Could not create isolated recipient topic');
  }
  const subscriptions = await getSubscriptions(topicArn);
  if (subscriptions.length === 0) {
    await sns.send(new SubscribeCommand({
      TopicArn: topicArn,
      Protocol: 'email',
      Endpoint: recipient,
      ReturnSubscriptionArn: true
    }));
    return { topicArn, ready: false, confirmationRequired: true };
  }
  if (subscriptions.length !== 1) {
    throw new Error('Recipient topic is not isolated');
  }
  const subscription = subscriptions[0];
  if (subscription.Protocol !== 'email' ||
      normalizeEmail(subscription.Endpoint) !== recipient ||
      subscription.TopicArn !== topicArn) {
    throw new Error('Recipient topic has an unexpected subscriber');
  }
  if (!subscription.SubscriptionArn ||
      subscription.SubscriptionArn === 'PendingConfirmation') {
    return { topicArn, ready: false, confirmationRequired: true };
  }
  return { topicArn, ready: true, reservation };
}

/**
 * Check every subscriber on the selected topic.
 * A topic must have exactly one confirmed email subscriber,
 * and that subscriber must be the requested recipient.
 */
async function verifyTopicRecipient(email, selectedTopicArn) {
  const recipient = normalizeEmail(email);
  const topicArn = selectedTopicArn || topicForRecipient(recipient);
  const subscribers = await getSubscriptions(topicArn);

  if (subscribers.length !== 1) {
    throw new Error(
      'Recipient SNS topic must have exactly one subscription'
    );
  }

  const subscription = subscribers[0];

  const confirmed =
    Boolean(subscription.SubscriptionArn) &&
    subscription.SubscriptionArn !== 'PendingConfirmation';

  const correctRecipient =
    subscription.Protocol === 'email' &&
    normalizeEmail(subscription.Endpoint) === recipient;

  const correctTopic =
    subscription.TopicArn === topicArn;

  if (!confirmed || !correctRecipient || !correctTopic) {
    throw new Error(
      'Recipient SNS subscription is not confirmed or isolated'
    );
  }

  return true;
}

/**
 * Convert Morning/Night weather data into readable text.
 */
function formatWeatherEmail(report, adviceResult) {
  if (!report || !report.morning || !report.night) {
    throw new Error('Invalid weather report');
  }

  if (!adviceResult || !adviceResult.advice ||
      !adviceResult.advice.morning ||
      !adviceResult.advice.night) {
    throw new Error('Invalid advice result');
  }

  const lines = [
    'WEATHER ADVISOR REPORT',
    '',
    `Date: ${report.date}`,
    `Location: ${report.location?.city || 'Unknown'}, ` +
      `${report.location?.state || ''}`,
    `ZIP: ${report.location?.zip || 'Not available'}`,
    ''
  ];

  for (const [label, key] of [
    ['MORNING', 'morning'],
    ['NIGHT', 'night']
  ]) {
    const weather = report[key];
    const advice = adviceResult.advice[key];

    lines.push(
      `${label} FORECAST`,
      `Temperature: ${weather.temperatureMinF ?? 'N/A'} - ` +
        `${weather.temperatureMaxF ?? 'N/A'} F`,
      `Wind: ${weather.windMph ?? 'N/A'} mph`,
      `Visibility: ${weather.visibilityMiles ?? 'N/A'} miles`,
      `UV Index: ${weather.uvIndex ?? 'N/A'}`,
      `Humidity: ${weather.humidityPercent ?? 'N/A'}%`,
      `Rain: ${weather.rain ?? 'N/A'}`,
      `Snow: ${weather.snow ?? 'N/A'}`,
      `Road Advice: ${advice.road_conditions || 'N/A'}`,
      `Clothing: ${advice.dressing || 'N/A'}`,
      `Accessories: ${advice.accessories || 'N/A'}`,
      ''
    );
  }

  lines.push(
    `Advice source: ${adviceResult.source || 'Unknown'}`,
    '',
    'Forecast conditions may change.',
    'Check official weather alerts before travelling.'
  );

  return lines.join('\n');
}

/**
 * Publish to exactly one approved recipient's SNS topic.
 *
 * Both topics require confirmed subscriptions.
 * The daily limit is enforced with DynamoDB.
 */
async function sendWeatherEmail({
  email,
  consent,
  report,
  adviceResult
}) {
  const recipient = normalizeEmail(email);

  if (!validateEmail(recipient)) {
    throw new Error('Invalid email address');
  }

  if (consent !== true) {
    throw new Error('Email consent is required');
  }

  const message = formatWeatherEmail(
    report,
    adviceResult
  );

  // Unknown addresses initiate a one-time SNS confirmation handshake.
  // Do not send the weather report until confirmation is complete.
  const recipientState = await ensureRecipientReady(recipient);
  if (!recipientState.ready) {
    return { sent: false, confirmationRequired: true };
  }
  const topicArn = recipientState.topicArn;
  const reservation = recipientState.reservation ||
    await reserveEmailRequest(recipient);
  if (!reservation.allowed) throw new Error('Daily email limit reached');

  const result = await sns.send(
    new PublishCommand({
      TopicArn: topicArn,
      Subject: 'Your Weather Advisor Report',
      Message: message
    })
  );

  if (!result.MessageId) {
    throw new Error('SNS did not return a message ID');
  }

  return {
    sent: true,
    messageId: result.MessageId,
    dailyCount: reservation.count,
    dailyLimit: reservation.limit
  };
}

module.exports = {
  normalizeEmail,
  validateEmail,
  topicForRecipient,
  formatWeatherEmail,
  verifyTopicRecipient,
  registrationTopicName,
  ensureRecipientReady,
  sendWeatherEmail
};
