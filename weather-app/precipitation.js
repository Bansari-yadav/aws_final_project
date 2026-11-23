
'use strict';

// Project thresholds for hourly precipitation intensity.
const HEAVY_RAIN_MM_H = 7.6;
const HEAVY_SNOW_CM_H = 2.54;

/**
 * Classify one hourly precipitation amount.
 * Missing measurements must not be treated as zero.
 */
function classifyAmount(value, heavyThreshold) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return 'Not available';
  }

  if (value === 0) return 'No';
  if (value >= heavyThreshold) return 'Heavy';
  return 'Mild';
}

function classifyRain(mmPerHour) {
  return classifyAmount(mmPerHour, HEAVY_RAIN_MM_H);
}

function classifySnow(cmPerHour) {
  return classifyAmount(cmPerHour, HEAVY_SNOW_CM_H);
}

/**
 * Classify a period using its highest hourly intensity.
 * The input contains hourly forecast amounts.
 */
function classifyPeriod(values, classify) {
  if (!Array.isArray(values) || values.length === 0) {
    return 'Not available';
  }

  if (!values.every(v =>
    typeof v === 'number' &&
    Number.isFinite(v) &&
    v >= 0
  )) {
    return 'Not available';
  }

  return classify(Math.max(...values));
}

module.exports = {
  classifyRain,
  classifySnow,
  classifyPeriod
};
