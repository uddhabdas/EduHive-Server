const axios = require('axios');

async function sendEmail(to, subject, html) {
  try {
    const res = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { email: process.env.SMTP_FROM, name: process.env.SMTP_FROM_NAME || 'EduHive' },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      },
      {
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    console.log('Email sent:', res.data);
    return { success: true };
  } catch (err) {
    const msg = (err && err.response && err.response.data) || err.message || 'Unknown error';
    console.error('Brevo API Email Error:', msg);
    return { success: false, error: typeof msg === 'string' ? msg : JSON.stringify(msg) };
  }
}

module.exports = { sendEmail };

