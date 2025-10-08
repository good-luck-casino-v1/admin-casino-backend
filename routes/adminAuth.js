const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../config/db');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();
const jwt = require('jsonwebtoken');


// setup nodemailer transporter (Zoho)
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.zoho.in",
  port: parseInt(process.env.EMAIL_PORT) || 465,
  secure: true, // SSL for 465
  auth: {
    user: process.env.EMAIL_USER, // full email
    pass: process.env.EMAIL_PASS  // Zoho App Password
  },
  tls: {
    rejectUnauthorized: false
  }
});

transporter.verify((err, success) => {
  if (err) {
    console.error("SMTP connection failed:", err);
  } else {
    console.log(" SMTP connected and ready");
  }
});
console.log("EMAIL_USER:", process.env.EMAIL_USER);
console.log("EMAIL_PASS:", process.env.EMAIL_PASS ? "LOADED" : "MISSING");


// Admin Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log("Login called for:", email);

    const [admins] = await db.execute('SELECT * FROM admin WHERE email = ?', [email]);
    if (admins.length === 0) {
      return res.status(400).json({ success: false, message: 'Email not found' });
    }

    const admin = admins[0];
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Incorrect password' });
    }

    // ✅ Generate a JWT
    const token = jwt.sign(
      { id: admin.id, email: admin.email },
      process.env.JWT_SECRET || '636a1bdbd96cb4d15882d9df2c373f90',
      { expiresIn: '30d' }
    );

    // Exclude password before sending admin data
    const { password: _, ...adminData } = admin;

    // ✅ Send token along with admin info
    res.json({
      success: true,
      message: 'Login successful',
      token, // ✅ Added this line
      admin: adminData,
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// Forgot Password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Check admin exists
    const [admins] = await db.execute('SELECT id FROM admin WHERE email = ?', [email]);

    if (admins.length === 0) {
      return res.status(404).json({ success: false, message: 'Email not found' });
    }

    const admin = admins[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = Date.now() + 3600000; // 1 hour

    await db.execute(
      'UPDATE admin SET reset_token = ?, reset_token_expiry = ? WHERE id = ?',
      [resetToken, resetExpires, admin.id]
    );

    const resetLink = `${process.env.FRONTEND_URL}/admin/reset-password?token=${resetToken}`;

  console.log("Generated Reset Link:", resetLink);

    //  Use the top-level transporter (Zoho)
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Admin Password Reset Request',
      html: `
        <h2>Password Reset Request</h2>
        <p>You requested a password reset for your admin account.</p>
        <p><a href="${resetLink}" style="background:#28a745;color:#fff;padding:10px 15px;text-decoration:none;border-radius:5px;">
          Reset Password
        </a></p>
        <p>This link is valid for 1 hour.</p>
      `
    });

    res.json({ success: true, message: 'Password reset link sent to your email' });

  } catch (err) {
    console.error('Forgot Password Error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    const [admins] = await db.execute(
      'SELECT id, reset_token_expiry FROM admin WHERE reset_token = ?',
      [token]
    );

    if (admins.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid token' });
    }

    const admin = admins[0];

    if (admin.reset_token_expiry < Date.now()) {
      return res.status(400).json({ success: false, message: 'Token expired' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.execute(
      'UPDATE admin SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?',
      [hashedPassword, admin.id]
    );

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('Reset Password Error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});



module.exports = router;