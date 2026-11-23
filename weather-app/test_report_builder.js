
'use strict';

const {
  buildWeatherReport
} = require('./report_builder');

// Use tomorrow in Chicago to avoid hardcoded past dates.
function chicagoTomorrow() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  const [year, month, day] = today.split('-').map(Number);

  return new Date(
    Date.UTC(year, month - 1, day + 1)
  ).toISOString().slice(0, 10);
}

async function main() {
  try {
    const date = chicagoTomorrow();

    console.log('Generating real weather report...');
    console.log('ZIP: 60616');
    console.log('Date:', date);

    const report = await buildWeatherReport('60616', date);

    console.log('\nLOCATION');
    console.log(report.location);

    console.log('\nMORNING REPORT');
    console.table(report.morning);

    console.log('\nNIGHT REPORT');
    console.table(report.night);

    console.log('\nSOURCES');
    console.log(report.sources);

  } catch (error) {
    console.error('Report failed:', error.message);
    process.exitCode = 1;
  }
}

main();
