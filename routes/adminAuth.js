const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../config/db');
const nodemailer = require('nodemailer');

// Admin Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log("called");
    // Check if admin exists
    const [admins] = await pool.execute(
      'SELECT * FROM admin WHERE email = ?',
      [email]
    );
    
    if (admins.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email not found' 
      });
    }
    
    const admin = admins[0];
    
    // Check password
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(400).json({ 
        success: false, 
        message: 'Incorrect password' 
      });
    }
    
    // Return admin data (excluding password)
    const { password: _, ...adminData } = admin;
    
    res.json({
      success: true,
      message: 'Login successful',
      admin: adminData
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// Forgot Password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    // Check if admin exists
    const [admins] = await pool.execute(
      'SELECT * FROM admin WHERE email = ?',
      [email]
    );
    
    if (admins.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email not found' 
      });
    }
    
    // Generate reset token (in a real app, use a proper token generation)
    const resetToken = Math.random().toString(36).substring(2, 15);
    const resetExpires = new Date(Date.now() + 3600000); // 1 hour
    
    // Save token to database (you would need a password_resets table)
    // For simplicity, we'll just send an email
    
    // Send email
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset Request',
      text: `You requested a password reset. Please use this token: ${resetToken}`,
      html: `<p>You requested a password reset. Please use this token: <strong>${resetToken}</strong></p>`
    };
    
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error(error);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to send email' 
        });
      }
      
      res.json({
        success: true,
        message: 'Password reset link sent to your email'
      });
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

module.exports = router;