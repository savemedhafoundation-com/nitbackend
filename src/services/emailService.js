/**
 * Placeholder service for transactional emails.
 * Replace the mock implementation with your preferred provider (SendGrid, SES, etc.).
 */
const sendEmail = async ({ to, subject, text, html }) => {
  console.log('Email dispatched (mock):', {
    to,
    subject,
    text,
    html,
  });

  return Promise.resolve();
};

module.exports = {
  sendEmail,
};
