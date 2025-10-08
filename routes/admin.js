const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/adminAuth');
const db = require('../config/db');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../public/images/admin');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Get current admin
router.get('/current', async (req, res) => {
  try {
    // Assuming you have middleware to authenticate and get admin ID
    const adminId = req.admin.id;
    const [admin] = await req.db.query(
      'SELECT id, email, admin_type, name, mobile, photo FROM admin WHERE id = ?',
      [adminId]
    );
    
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }
    
    res.json(admin);
  } catch (error) {
    console.error('Error fetching admin:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update admin profile
router.put('/update', upload.single('photo'), async (req, res) => {
  try {
    const { name, mobile, email } = req.body;
    console.log(name, mobile, email);
    
    // Get current admin data
    const [currentAdmin] = await req.db.query(
      'SELECT photo FROM admin WHERE email = ?',
      [email]
    );
    
    if (!currentAdmin) {
      return res.status(404).json({ message: 'Admin not found' });
    }
    
    // Prepare update data
    const updateData = { name, mobile, email };
    
    // Handle photo update if new photo is provided
    if (req.file) {
      updateData.photo = req.file.filename;
      
      // Delete old photo if exists
      if (currentAdmin.photo) {
        const oldPhotoPath = path.join(__dirname, '../../frontend/public/images/admin', currentAdmin.photo);
        if (fs.existsSync(oldPhotoPath)) {
          fs.unlinkSync(oldPhotoPath);
        }
      }
    }
    
    // Update admin in database
    await req.db.query(
      'UPDATE admin SET ? WHERE email = ?',
      [updateData, email]
    );
    
    // Get updated admin data to return to frontend
    const [updatedAdmin] = await req.db.query(
      'SELECT email, admin_type, name, mobile, photo FROM admin WHERE email = ?',
      [email]
    );
    
    res.json({ admin: updatedAdmin });
  } catch (error) {
    console.error('Error updating admin profile:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Change password - Updated to use email instead of admin ID
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const email = req.user?.email; // Extract from token instead of client input

    console.log('Password change request for:', email);

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const [rows] = await db.query('SELECT id, password FROM admin WHERE email = ?', [email]);
    const admin = rows[0];

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const isMatch = await bcrypt.compare(oldPassword, admin.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid old password' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await db.query('UPDATE admin SET password = ? WHERE email = ?', [hashedPassword, email]);
    console.log('Password updated successfully for:', email);

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;