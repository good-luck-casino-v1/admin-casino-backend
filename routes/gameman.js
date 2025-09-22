const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const pool = require('../config/db');
const router = express.Router();

// Middleware for this router
router.use(cors());
router.use(bodyParser.json());

// Get all games with optional filters
router.get('/', async (req, res) => {
  try {
    const { category, status } = req.query;
    let query = 'SELECT * FROM games';
    const params = [];
    
    // Build WHERE clause based on filters
    const conditions = [];
    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY created_at DESC';
    
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ message: 'Error fetching games' });
  }
});

// Get game count
router.get('/count', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT COUNT(*) as count FROM games');
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
    const [rows] = await pool.query('SELECT * FROM games WHERE id = ?', [id]);
    
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
router.post('/', async (req, res) => {
  const { name, category, min_bet, max_bet, image_url, status, rpt, game_uid } = req.body;
  
  // Validate required fields
  if (!name || !category) {
    return res.status(400).json({ message: 'Name and category are required' });
  }
  
  try {
    const [result] = await pool.query(
      `INSERT INTO games (name, category, min_bet, max_bet, image_url, status, rpt, gameUid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        category,
        min_bet || 1.00,
        max_bet || 1000.00,
        image_url || null,
        status || 'active',
        rpt || 0.00,
        game_uid || null
      ]
    );
    
    // Return the newly created game
    const [newGame] = await pool.query('SELECT * FROM games WHERE id = ?', [result.insertId]);
    res.status(201).json(newGame[0]);
  } catch (error) {
    console.error('Error creating game:', error);
    res.status(500).json({ message: 'Error creating game' });
  }
});

// Update a game
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, category, min_bet, max_bet, image_url, status, rpt, game_uid } = req.body;
  
  try {
    // Check if game exists
    const [existingGame] = await pool.query('SELECT * FROM games WHERE id = ?', [id]);
    
    if (existingGame.length === 0) {
      return res.status(404).json({ message: 'Game not found' });
    }
    
    // Build update query
    const updateFields = [];
    const params = [];
    
    if (name !== undefined) {
      updateFields.push('name = ?');
      params.push(name);
    }
    if (category !== undefined) {
      updateFields.push('category = ?');
      params.push(category);
    }
    if (min_bet !== undefined) {
      updateFields.push('min_bet = ?');
      params.push(min_bet);
    }
    if (max_bet !== undefined) {
      updateFields.push('max_bet = ?');
      params.push(max_bet);
    }
    if (image_url !== undefined) {
      updateFields.push('image_url = ?');
      params.push(image_url);
    }
    if (status !== undefined) {
      updateFields.push('status = ?');
      params.push(status);
    }
    if (rpt !== undefined) {
      updateFields.push('rpt = ?');
      params.push(rpt);
    }
    if (game_uid !== undefined) {
      updateFields.push('game_uid = ?');
      params.push(game_uid);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }
    
    params.push(id);
    
    const query = `UPDATE games SET ${updateFields.join(', ')} WHERE id = ?`;
    
    await pool.query(query, params);
    
    // Return the updated game
    const [updatedGame] = await pool.query('SELECT * FROM games WHERE id = ?', [id]);
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
    // Check if game exists
    const [existingGame] = await pool.query('SELECT * FROM games WHERE id = ?', [id]);
    
    if (existingGame.length === 0) {
      return res.status(404).json({ message: 'Game not found' });
    }
    
    await pool.query('UPDATE games SET status = ? WHERE id = ?', [status, id]);
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
    // Check if game exists
    const [existingGame] = await pool.query('SELECT * FROM games WHERE id = ?', [id]);
    
    if (existingGame.length === 0) {
      return res.status(404).json({ message: 'Game not found' });
    }
    
    await pool.query('DELETE FROM games WHERE id = ?', [id]);
    res.json({ message: 'Game deleted successfully' });
  } catch (error) {
    console.error('Error deleting game:', error);
    res.status(500).json({ message: 'Error deleting game' });
  }
});

module.exports = router;