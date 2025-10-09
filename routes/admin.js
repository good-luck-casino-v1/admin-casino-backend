// routes/admin.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const AWS = require('aws-sdk');
const path = require('path');
const { authenticateToken } = require('../middleware/adminAuth');
const db = require('../config/db');

//  Configure DigitalOcean Spaces
const spacesEndpoint = new AWS.Endpoint(process.env.SPACES_ENDPOINT.replace('https://', ''));
const s3 = new AWS.S3({
  endpoint: spacesEndpoint,
  accessKeyId: process.env.SPACES_KEY_ADMIN,
  secretAccessKey: process.env.SPACES_SECRET_ADMIN,
  region: process.env.SPACES_REGION,
});


//  Use in-memory storage for S3 uploads
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  },
});


//  Update admin profile — now uploads to Spaces
router.put('/update', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    const { name, mobile, email } = req.body;
    const adminId = req.admin.id;

    // Fetch current admin
    const [rows] = await db.query('SELECT photo FROM admin WHERE id = ?', [adminId]);
    const currentAdmin = rows[0];
    if (!currentAdmin) return res.status(404).json({ message: 'Admin not found' });

    let photoUrl = currentAdmin.photo;

    // If new file uploaded, upload to Spaces
    if (req.file) {
      const fileExt = path.extname(req.file.originalname);
      const fileName = `admin/${adminId}-${Date.now()}${path.extname(req.file.originalname)}`;


      const uploadParams = {
  Bucket: process.env.SPACES_BUCKET,
  Key: fileName,
  Body: req.file.buffer,
  ACL: 'public-read',
  ContentType: req.file.mimetype,
};
const uploadResult = await s3.upload(uploadParams).promise();
console.log('Uploaded to Spaces:', uploadResult.Location);
photoUrl = uploadResult.Location;


      //  Delete old photo if exists in Spaces
      if (currentAdmin.photo && currentAdmin.photo.includes(process.env.SPACES_CDN)) {
        const oldKey = currentAdmin.photo.split(`${process.env.SPACES_CDN}/`)[1];
        if (oldKey) {
          try {
            await s3.deleteObject({
              Bucket: process.env.SPACES_BUCKET,
              Key: oldKey
            }).promise();
          } catch (err) {
            console.warn('Old photo deletion failed:', err.message);
          }
        }
      }
    }

    //  Update DB
    await db.query(
      'UPDATE admin SET name = ?, mobile = ?, email = ?, photo = ? WHERE id = ?',
      [name, mobile, email, photoUrl, adminId]
    );

    const [updatedRows] = await db.query(
      'SELECT id, email, admin_type, name, mobile, photo FROM admin WHERE id = ?',
      [adminId]
    );

    res.json({ admin: updatedRows[0] });
  } catch (error) {
    console.error('Error updating profile:', error);
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