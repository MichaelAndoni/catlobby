// mailer.js — nodemailer email helper
'use strict';

const nodemailer = require('nodemailer');
require('dotenv').config();

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

async function sendVerificationEmail(toEmail, username, verifyUrl) {
  const t = getTransporter();
  await t.sendMail({
    from:    process.env.EMAIL_FROM || '"Cat Lobby" <noreply@catlobby.com>',
    to:      toEmail,
    subject: '🐱 Verify your Cat Lobby account',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#1a1025;color:#f0e6ff;border-radius:16px;padding:32px">
        <h1 style="font-size:28px;margin:0 0 8px">🐱 Cat Lobby</h1>
        <p style="color:#9b8ab0;margin:0 0 24px">Your cozy digging adventure awaits!</p>
        <hr style="border:none;border-top:1px solid #3d2060;margin:0 0 24px">
        <p style="font-size:16px">Hey <strong>${username}</strong>! Thanks for signing up.</p>
        <p>Click the button below to verify your email address and save your progress forever:</p>
        <div style="text-align:center;margin:32px 0">
          <a href="${verifyUrl}"
             style="background:linear-gradient(135deg,#c77dff,#ff9de2);color:#1a0030;text-decoration:none;
                    padding:14px 32px;border-radius:12px;font-weight:800;font-size:16px;display:inline-block">
            ✓ Verify My Account
          </a>
        </div>
        <p style="color:#9b8ab0;font-size:13px">This link expires in 24 hours. If you didn't sign up, you can ignore this email.</p>
        <p style="color:#9b8ab0;font-size:12px;margin-top:24px;word-break:break-all">
          Or copy this link: <a href="${verifyUrl}" style="color:#c77dff">${verifyUrl}</a>
        </p>
      </div>
    `,
  });
}

module.exports = { sendVerificationEmail };
