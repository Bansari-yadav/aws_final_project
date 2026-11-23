
const {
  getCoordinates,
  getNWSForecast,
  getSupplementaryForecast
} = require('./weather_clients');

async function main() {
  try {
    console.log('STEP 1: ZIP lookup');

    const location = await getCoordinates('60616');
    console.log(location);

    console.log('\nSTEP 2: NWS forecast');

    const nws = await getNWSForecast(
      location.latitude,
      location.longitude
    );

    console.log('Timezone:', nws.timezone);
    console.log('NWS hourly periods:', nws.periods.length);
    console.log('First NWS period:', nws.periods[0]);

    console.log('\nSTEP 3: Open-Meteo forecast');

    const meteo = await getSupplementaryForecast(
      location.latitude,
      location.longitude
    );

    console.log('Timezone:', meteo.timezone);
    console.log('Hourly records:', meteo.hourly.time.length);

    console.log('First hourly values:', {
      time: meteo.hourly.time[0],
      temperature: meteo.hourly.temperature_2m[0],
      humidity: meteo.hourly.relative_humidity_2m[0],
      visibility: meteo.hourly.visibility[0],
      uv: meteo.hourly.uv_index[0]
    });

  } catch (error) {
    console.error('Test failed:', error.message);
    process.exitCode = 1;
  }
}

main();
