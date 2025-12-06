const nodemailer = require('nodemailer');

/**
 * Get SMTP settings from environment variables
 * Supports Gmail, Brevo (formerly Sendinblue), SendGrid, and other SMTP providers
 */
async function getSmtpSettings() {
  const host = process.env.SMTP_HOST || '';
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const secure = process.env.SMTP_SECURE === 'true';
  
  // Auto-detect secure setting based on port if not explicitly set
  let isSecure = secure;
  if (!process.env.SMTP_SECURE) {
    isSecure = port === 465;
  }

  return {
    host,
    port,
    user,
    pass,
    from: process.env.SMTP_FROM || user,
    fromName: process.env.SMTP_FROM_NAME || 'EduHive',
    secure: isSecure,
  };
}

/**
 * Create nodemailer transporter with production-safe settings
 * Includes connection timeout and proper error handling
 */
async function createTransporter() {
  const settings = await getSmtpSettings();
  
  if (!settings.host || !settings.user || !settings.pass) {
    console.warn('SMTP not fully configured');
    return null;
  }

  // Base transporter configuration
  const transporterConfig = {
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: {
      user: settings.user,
      pass: settings.pass,
    },
    // Connection timeout to prevent hanging (10 seconds)
    connectionTimeout: 10000,
    // Socket timeout for operations
    socketTimeout: 10000,
    // Greeting timeout
    greetingTimeout: 10000,
    // Retry attempts
    pool: false,
    // Disable automatic TLS upgrade for better compatibility
    requireTLS: false,
    // Ignore TLS certificate errors (useful for some providers)
    tls: {
      rejectUnauthorized: false,
    },
  };

  // Provider-specific configurations
  const hostLower = settings.host.toLowerCase();
  
  // Brevo (formerly Sendinblue) configuration
  if (hostLower.includes('brevo') || hostLower.includes('smtp-relay.sendinblue.com')) {
    transporterConfig.port = 587;
    transporterConfig.secure = false;
    transporterConfig.requireTLS = true;
  }
  
  // SendGrid configuration
  if (hostLower.includes('sendgrid') || hostLower.includes('smtp.sendgrid.net')) {
    transporterConfig.port = 587;
    transporterConfig.secure = false;
    transporterConfig.requireTLS = true;
  }
  
  // Gmail configuration - use port 587 with secure:false for better Render compatibility
  if (hostLower.includes('gmail') || hostLower.includes('google')) {
    transporterConfig.port = 587;
    transporterConfig.secure = false;
    transporterConfig.requireTLS = true;
  }

  try {
    const transporter = nodemailer.createTransport(transporterConfig);
    return transporter;
  } catch (error) {
    console.error('Failed to create email transporter:', error.message);
    return null;
  }
}

/**
 * Check if SMTP is configured
 */
async function isSmtpConfigured() {
  const settings = await getSmtpSettings();
  return !!(settings.host && settings.user && settings.pass);
}

/**
 * Get email sender info
 */
async function getEmailFrom() {
  const settings = await getSmtpSettings();
  return {
    from: settings.from,
    fromName: settings.fromName,
  };
}

/**
 * Safely send an email with comprehensive error handling
 * Returns { success: boolean, error?: string }
 */
async function sendEmail(options) {
  try {
    const transporter = await createTransporter();
    if (!transporter) {
      return {
        success: false,
        error: 'SMTP not configured',
      };
    }

    const { from, fromName } = await getEmailFrom();
    const mailOptions = {
      from: fromName ? `${fromName} <${from}>` : from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    };

    // Send with timeout protection
    const info = await Promise.race([
      transporter.sendMail(mailOptions),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Email send timeout')), 15000)
      ),
    ]);

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    const errorMessage = error.message || 'Unknown error';
    console.error('Email send error:', errorMessage);
    
    // Log more details for debugging
    if (error.code) {
      console.error('Error code:', error.code);
    }
    if (error.command) {
      console.error('Failed command:', error.command);
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

module.exports = {
  getSmtpSettings,
  createTransporter,
  isSmtpConfigured,
  getEmailFrom,
  sendEmail, // New safe email sending function
};

