
'use strict';

/**
 * Validate a recommendation from Gemini.
 * Only short plain-text recommendations are accepted.
 */
function validAdvice(value) {
  return (
    typeof value === 'string' &&
    value.trim().length >= 5 &&
    value.length <= 300 &&
    !/[<>]/.test(value) &&
    !/[\u0000-\u001F\u007F]/.test(value) &&
    !/https?:\/\//i.test(value)
  );
}

/**
 * Check the structure of Gemini's JSON response.
 */
function validateGeminiAdvice(data) {
  if (!data || typeof data !== 'object' ||
      Array.isArray(data)) {
    return false;
  }

  for (const period of ['morning', 'night']) {
    const advice = data[period];

    if (!advice || typeof advice !== 'object' ||
        Array.isArray(advice)) {
      return false;
    }

    for (const field of [
      'road_conditions',
      'dressing',
      'accessories'
    ]) {
      if (!validAdvice(advice[field])) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Build a prompt containing weather facts only.
 * Never include the user's email address.
 */
function buildAdvicePrompt(report, gender) {
  const allowed = ['neutral', 'menswear', 'womenswear'];

  if (!allowed.includes(gender)) {
    throw new Error('Invalid clothing category');
  }

  function facts(period) {
    return {
      temperatureMinF: period.temperatureMinF ?? null,
      temperatureMaxF: period.temperatureMaxF ?? null,
      windMph: period.windMph ?? null,
      visibilityMiles: period.visibilityMiles ?? null,
      uvIndex: period.uvIndex ?? null,
      humidityPercent: period.humidityPercent ?? null,
      rain: period.rain ?? 'Not available',
      snow: period.snow ?? 'Not available'
    };
  }

  return JSON.stringify({
    instructions: [
      'Generate practical weather-related advice.',
      'Use only the supplied weather facts.',
      'Never invent or change measured weather values.',
      'Return JSON with morning and night objects.',
      'Each object must have road_conditions, dressing, accessories.',
      'Each value must be a short plain-text sentence.',
      'Do not include markdown, URLs, or additional keys.',
      'If information is missing, avoid assumptions.'
    ],
    clothingCategory: gender,
    morning: facts(report.morning),
    night: facts(report.night)
  });
}

/**
 * Rule-based fallback for when Gemini fails.
 */
function fallbackForPeriod(period) {
  const temp = period.temperatureMinF;
  const wind = period.windMph;
  const visibility = period.visibilityMiles;

  const rain = period.rain;
  const snow = period.snow;

  let road = 'Check local road conditions before traveling.';

  if (snow === 'Heavy' || snow === 'Mild') {
    road = 'Snow may make roads slippery. Drive carefully.';
  } else if (rain === 'Heavy' || rain === 'Mild') {
    road = 'Rain may make roads wet. Allow extra braking distance.';
  } else if (typeof visibility === 'number' &&
             visibility < 3) {
    road = 'Reduced visibility is possible. Slow down while driving.';
  }

  if (typeof wind === 'number' && wind >= 30) {
    road += ' Watch for strong crosswinds.';
  }

  let dressing =
    'Check the temperature before selecting clothing.';

  if (typeof temp === 'number') {
    if (temp <= 32) {
      dressing = 'Wear a heavy winter coat, gloves and a hat.';
    } else if (temp <= 50) {
      dressing = 'Wear a warm jacket and layered clothing.';
    } else if (temp <= 68) {
      dressing = 'Wear a light jacket or sweater.';
    } else if (temp <= 80) {
      dressing = 'Wear comfortable, lightweight clothing.';
    } else {
      dressing = 'Wear light, breathable clothing.';
    }
  }

  let accessories =
    'Carry water and check the latest forecast.';

  if (rain === 'Heavy' || rain === 'Mild') {
    accessories = 'Carry an umbrella and waterproof footwear.';
  } else if (snow === 'Heavy' || snow === 'Mild') {
    accessories = 'Carry gloves, a hat and winter accessories.';
  } else if (typeof temp === 'number' && temp <= 32) {
    accessories = 'Carry gloves, a scarf and a warm hat.';
  } else if (typeof period.uvIndex === 'number' &&
             period.uvIndex >= 3) {
    accessories = 'Carry sunscreen and sunglasses.';
  }

  return {
    road_conditions: road,
    dressing,
    accessories
  };
}

function fallbackAdvice(report) {
  return {
    morning: fallbackForPeriod(report.morning),
    night: fallbackForPeriod(report.night)
  };
}

module.exports = {
  validAdvice,
  validateGeminiAdvice,
  buildAdvicePrompt,
  fallbackForPeriod,
  fallbackAdvice
};
