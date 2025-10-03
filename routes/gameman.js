const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const db = require('../config/db');

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: process.env.SPACES_REGION,
  endpoint: process.env.SPACES_ENDPOINT,
  forcePathStyle: false,
  credentials: {
    accessKeyId: process.env.SPACES_KEY_ADMIN,
    secretAccessKey: process.env.SPACES_SECRET_ADMIN
  }
});

// Debug env
console.log("Loaded S3 Config:", {
  region: process.env.SPACES_REGION,
  endpoint: process.env.SPACES_ENDPOINT,
  bucket: process.env.SPACES_BUCKET,
  key: process.env.SPACES_KEY_ADMIN ? "✔️" : "❌",
  secret: process.env.SPACES_SECRET_ADMIN ? "✔️" : "❌"
});

const router = express.Router();

// Middleware
router.use(cors());
router.use(bodyParser.json());

// ---------------- MULTER MEMORY STORAGE (for S3) ----------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: function (req, file, cb) {
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  }
});

// ---------------- ROUTES ----------------

// Get all games with optional filters
router.get('/', async (req, res) => {
  try {
    const { category, status } = req.query;
    let query = 'SELECT * FROM games';
    const params = [];

    const conditions = [];
    if (category) { conditions.push('category = ?'); params.push(category); }
    if (status) { conditions.push('status = ?'); params.push(status); }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC';
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ message: 'Error fetching games' });
  }
});

// Get game count
router.get('/count', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT COUNT(*) as count FROM games');
    res.json({ count: rows[0].count });
  } catch (error) {
    console.error('Error fetching game count:', error);
    res.status(500).json({ message: 'Error fetching game count' });
  }
});

// Get a specific game by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await db.query('SELECT * FROM games WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Game not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching game:', error);
    res.status(500).json({ message: 'Error fetching game' });
  }
});

// Create a new game
router.post('/ins', upload.single('image'), async (req, res) => {
  try {
    const { name, gameCode, providerCode, category, bet_amount, status } = req.body;
    if (!name || !category) {
      return res.status(400).json({ message: 'Name and category are required' });
    }

    let image_url = null;
    let image_filename = null;

    if (req.file) {
      const key = `games/${Date.now()}-${req.file.originalname}`;
      await s3.send(new PutObjectCommand({
        Bucket: process.env.SPACES_BUCKET,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        ACL: 'public-read'
      }));
      image_filename = key;
      image_url = `${process.env.SPACES_ENDPOINT.replace("https://", `https://${process.env.SPACES_BUCKET}.`)}/${key}`;
    }

    const [result] = await db.query(
      `INSERT INTO games (name, gameCode, providerCode, category, bet_amount, image_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, gameCode || null, providerCode || null, category, bet_amount || 100.00, image_url, status || 'active']
    );

    const [newGame] = await db.query('SELECT * FROM games WHERE id = ?', [result.insertId]);
    res.status(201).json(newGame[0]);
  } catch (error) {
    console.error('Error creating game:', error);
    res.status(500).json({ message: 'Error creating game' });
  }
});

// Update a game
router.put('/:id', upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const { name, gameCode, providerCode, category, bet_amount } = req.body;

  try {
    const [existingGame] = await db.query('SELECT * FROM games WHERE id = ?', [id]);
    if (existingGame.length === 0) {
      return res.status(404).json({ message: 'Game not found' });
    }

    const updateFields = [];
    const params = [];

    if (name !== undefined) { updateFields.push('name = ?'); params.push(name); }
    if (gameCode !== undefined) { updateFields.push('gameCode = ?'); params.push(gameCode); }
    if (providerCode !== undefined) { updateFields.push('providerCode = ?'); params.push(providerCode); }
    if (category !== undefined) { updateFields.push('category = ?'); params.push(category); }
    if (bet_amount !== undefined) { updateFields.push('bet_amount = ?'); params.push(bet_amount); }

    if (req.file) {
      const key = `games/${Date.now()}-${req.file.originalname}`;
      await s3.send(new PutObjectCommand({
        Bucket: process.env.SPACES_BUCKET,
        Key: key,
        Body: req.file.buffer,
        ACL: 'public-read',
        ContentType: req.file.mimetype
      }));
      const image_url = `${process.env.SPACES_ENDPOINT.replace("https://", `https://${process.env.SPACES_BUCKET}.`)}/${key}`;
      updateFields.push('image_url = ?');
      params.push(image_url);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    params.push(id);
    const query = `UPDATE games SET ${updateFields.join(', ')} WHERE id = ?`;
    await db.query(query, params);

    const [updatedGame] = await db.query('SELECT * FROM games WHERE id = ?', [id]);
    res.json(updatedGame[0]);
  } catch (error) {
    console.error('Error updating game:', error);
    res.status(500).json({ message: 'Error updating game' });
  }
});

// Update game status
router.put('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status || (status !== 'active' && status !== 'inactive')) {
    return res.status(400).json({ message: 'Valid status (active/inactive) is required' });
  }

  try {
    const [existingGame] = await db.query('SELECT * FROM games WHERE id = ?', [id]);
    if (existingGame.length === 0) {
      return res.status(404).json({ message: 'Game not found' });
    }

    await db.query('UPDATE games SET status = ? WHERE id = ?', [status, id]);
    res.json({ message: `Game ${status} successfully` });
  } catch (error) {
    console.error('Error updating game status:', error);
    res.status(500).json({ message: 'Error updating game status' });
  }
});

// Delete a game
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [existingGame] = await db.query('SELECT * FROM games WHERE id = ?', [id]);
    if (existingGame.length === 0) {
      return res.status(404).json({ message: 'Game not found' });
    }

    // Delete from S3
    if (existingGame[0].image_url) {
      const key = existingGame[0].image_url.split('/').slice(-2).join('/');
      await s3.send(new DeleteObjectCommand({
        Bucket: process.env.SPACES_BUCKET,
        Key: key
      }));
    }

    await db.query('DELETE FROM games WHERE id = ?', [id]);
    res.json({ message: 'Game deleted successfully' });
  } catch (error) {
    console.error('Error deleting game:', error);
    res.status(500).json({ message: 'Error deleting game' });
  }
});

module.exports = router;
