
const getBaseTemplate = (content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EduHive</title>
  <style>
    body { font-family: Arial, sans-serif; color: #222; }
    .wrap { max-width: 600px; margin: 0 auto; padding: 16px; }
    h1, h2, h3 { margin: 0 0 12px; font-weight: 600; }
    p { margin: 0 0 12px; }
    .otp { font-size: 22px; font-weight: 700; letter-spacing: 3px; }
    .muted { color: #666; }
    .divider { border-top: 1px solid #eee; margin: 16px 0; }
    .btn { display: inline-block; background: #10b981; color: #fff; padding: 10px 16px; text-decoration: none; border-radius: 4px; }
    .list { padding-left: 18px; }
    .mono { font-family: 'Courier New', monospace; }
  </style>
  </head>
<body>
  <div class="wrap">
    ${content}
  </div>
</body>
</html>`;

const getOtpTemplate = ({ otp, title, message, expiryMin = 10 }) => {
  const t = title || 'Email Verification';
  const m = message || 'Use the code below to verify your email.';
  const content = `
    <h2>${t}</h2>
    <p>${m}</p>
    <p class="otp mono">${otp}</p>
    <p class="muted">Expires in ${expiryMin} minutes.</p>
  `;
  return getBaseTemplate(content);
};

const getWelcomeTemplate = ({ name, dashboardUrl }) => {
  const n = name ? `, ${name}` : '';
  const url = dashboardUrl || 'https://eduhive.com';
  const content = `
    <h2>Welcome to EduHive${n}</h2>
    <p>Your account has been verified.</p>
    <p>Start learning now.</p>
    <p><a class="btn" href="${url}">Go to Dashboard</a></p>
  `;
  return getBaseTemplate(content);
};

const getPurchaseTemplate = ({ name, courseTitle, amount, transactionId, date }) => {
  const n = name ? `, ${name}` : '';
  const d = date || new Date().toLocaleDateString();
  const content = `
    <h2>Purchase Confirmed${n}</h2>
    <p>You have enrolled in <strong>${courseTitle}</strong>.</p>
    <div class="divider"></div>
    <p><strong>Total Paid:</strong> ₹${amount}</p>
    <p><strong>Transaction ID:</strong> <span class="mono">${transactionId}</span></p>
    <p><strong>Date:</strong> ${d}</p>
    <p><a class="btn" href="https://eduhive.com/my-courses">Access Course</a></p>
  `;
  return getBaseTemplate(content);
};

const getActionConfirmationTemplate = ({ title, message, otp, details }) => {
  const t = title || 'Confirmation Required';
  const m = message || 'Enter the code to confirm this action.';
  const content = `
    <h2>${t}</h2>
    <p>${m}</p>
    ${details ? `<p class="muted">${details}</p>` : ''}
    <p class="otp mono">${otp}</p>
    <p class="muted">Expires in 10 minutes.</p>
  `;
  return getBaseTemplate(content);
};

module.exports = {
  getOtpTemplate,
  getWelcomeTemplate,
  getPurchaseTemplate,
  getActionConfirmationTemplate,
  getPremiumEmailTemplate: (props) => {
    if (props.otp) return getOtpTemplate(props);
    return getActionConfirmationTemplate(props);
  }
};
