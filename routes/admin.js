const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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
router.post('/change-password', async (req, res) => {
  try {
    const { oldPassword, newPassword, email } = req.body;
    console.log(email);
    console.log('Password change request received for email:', email);
    
    // Validate inputs
    if (!oldPassword || !newPassword || !email) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    
    // Get admin with password using email
    const [rows] = await req.db.query(
  'SELECT id, password FROM admin WHERE email = ?',
  [email]
);
const admin = rows[0]; // Extract first row from result array

console.log(admin);
console.log("password", admin?.password); // Optional chaining for safety

if (!admin) {
  console.log('Admin not found for email:', email);
  return res.status(404).json({ message: 'Admin not found' });
}

if (!admin.password) {
  console.log('Password field is missing for admin:', email);
  return res.status(500).json({ message: 'Admin password data is missing' });
}

    
    console.log('Admin found, comparing passwords');
    
    // Check if old password matches
    const isMatch = await bcrypt.compare(oldPassword, admin.password);
    if (!isMatch) {
      console.log('Old password does not match for admin:', email);
      return res.status(400).json({ message: 'Invalid old password' });
    }
    
    console.log('Password match successful, hashing new password');
    
    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Update password using email
    await req.db.query(
      'UPDATE admin SET password = ? WHERE email = ?',
      [hashedPassword, email]
    );
    
    console.log('Password updated successfully for admin:', email);
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;