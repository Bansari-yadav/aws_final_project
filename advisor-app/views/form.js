
'use strict';

function renderForm() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Weather Advisor</title>

  <style>
    body {
      font-family: Arial, sans-serif;
      background: #f3f6fa;
      margin: 0;
      padding: 40px 16px;
    }

    .container {
      max-width: 650px;
      margin: auto;
      background: white;
      padding: 30px;
      border-radius: 12px;
      box-shadow: 0 4px 20px #0001;
    }

    h1 { color: #17365d; }

    label {
      display: block;
      margin-top: 18px;
      font-weight: bold;
    }

    input, select {
      display: block;
      width: 100%;
      box-sizing: border-box;
      padding: 12px;
      margin-top: 6px;
      border: 1px solid #ccc;
      border-radius: 6px;
    }

    button {
      background: #1769aa;
      color: white;
      padding: 13px;
      border: none;
      border-radius: 6px;
      margin-top: 24px;
      cursor: pointer;
      width: 100%;
    }

    .note {
      color: #555;
      font-size: 13px;
      line-height: 1.6;
      margin-top: 20px;
    }
  </style>
</head>

<body>
  <main class="container">

    <h1>Weather Advisor</h1>

    <p>
      Get personalized morning and night weather
      forecasts with AI-powered recommendations.
    </p>

    <form method="POST" action="/report">

      <label for="date">Forecast Date</label>
      <input
        type="date"
        id="date"
        name="date"
        required
      >

      <label for="zip">US ZIP Code</label>
      <input
        type="text"
        id="zip"
        name="zip"
        pattern="[0-9]{5}"
        maxlength="5"
        placeholder="60616"
        required
      >

      <label for="gender">Clothing Category</label>
      <select id="gender" name="gender" required>
        <option value="neutral">Neutral</option>
        <option value="menswear">Menswear</option>
        <option value="womenswear">Womenswear</option>
      </select>

      <label for="email">Email Address</label>
      <input
        type="email"
        id="email"
        name="email"
        maxlength="254"
        placeholder="name@example.com"
        autocomplete="email"
        required
      >

      <button type="submit">
        Generate Weather Report
      </button>
    </form>

    <p class="note">
      Supports five-digit US ZIP codes only.
      The clothing category is used only to tailor advice.
      Weather facts and clothing category may be sent to
      Google Gemini. Your email address is not sent to Gemini.

      Generating a report does not send an email.
      You can separately request email delivery
      after reviewing the report.
    </p>

  </main>
</body>
</html>
  `;
}

module.exports = { renderForm };
