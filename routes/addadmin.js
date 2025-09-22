const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db'); // Database configuration

// POST /api/adminadd/add
router.post('/add', async (req, res) => {
  const { name, mobile, email, password } = req.body;
  
  // Input validation
  if (!name || !mobile || !email || !password) {
    return res.status(400).json({ message: 'All fields are required' });
  }
  
  // Normalize email (trim and lowercase)
  const normalizedEmail = email.trim().toLowerCase();
  
  try {
    // Check if admin with this email already exists
    const [existingAdmin] = await db.query(
      'SELECT * FROM admin WHERE email = ?', 
      [normalizedEmail]
    );
    
    if (existingAdmin.length > 0) {
      return res.status(409).json({ message: 'Admin with this email already exists' });
    }
    
    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Insert the new admin into the database
    const [result] = await db.query(
      `INSERT INTO admin (name, mobile, email, password, admin_type)
       VALUES (?, ?, ?, ?, 'admin')`,
      [name.trim(), mobile.trim(), normalizedEmail, hashedPassword]
    );
    
    res.status(201).json({ 
      message: 'Admin added successfully',
      adminId: result.insertId 
    });
    
  } catch (error) {
    console.error('Error in add admin route:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;