const express = require('express');
const router = express.Router();
const db = require('../config/db'); // Database connection (promise )

// GET /api/payment-gateways - Get all payment methods
router.get('/', async (req, res) => {
  try {
    const [results] = await db.query('SELECT * FROM payment_gateways ORDER BY id');
    res.status(200).json(results);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/payment-gateways/names - Get gateway names for download tab
router.get('/names', async (req, res) => {
  try {
    const [results] = await db.query('SELECT name FROM payment_gateways ORDER BY name');
    res.status(200).json(results);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/payment-transactions - Get all transactions
router.get('/pay', async (req, res) => {
    console.log("Fetching all payment transactions");
  try {
    const [results] = await db.query('SELECT * FROM payment_transactions ORDER BY created_at DESC');
    res.status(200).json(results);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/payment-transactions/by-gateway/:gatewayName - Get transactions for a specific gateway
router.get('/by-gateway/:gatewayName', async (req, res) => {
  try {
    const { gatewayName } = req.params;
    const [results] = await db.query(
      'SELECT * FROM payment_transactions WHERE name = ? ORDER BY created_at DESC',
      [gatewayName]
    );
    res.status(200).json(results);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/payment-gateways - Create a new payment method
router.post('/', async (req, res) => {
  try {
    const { 
      name, 
      type, 
      status, 
      min_amount, 
      max_amount, 
      fee_percentage, 
      fixed_fee, 
      description,
      merch_id,
      api_token,
      base_url
    } = req.body;
    
    const [results] = await db.query(
      `INSERT INTO payment_gateways 
      (name, type, status, min_amount, max_amount, fee_percentage, fixed_fee, description, merch_id, api_token, base_url) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, type, status, min_amount, max_amount, fee_percentage, fixed_fee, description, merch_id, api_token, base_url]
    );
    
    res.status(201).json({ 
      message: 'Payment method created successfully',
      id: results.insertId
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/payment-gateways/:id - Update a payment method
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      type, 
      status, 
      min_amount, 
      max_amount, 
      fee_percentage, 
      fixed_fee, 
      description,
      merch_id,
      api_token,
      base_url
    } = req.body;
    
    const [results] = await db.query(
      `UPDATE payment_gateways 
      SET name = ?, type = ?, status = ?, min_amount = ?, max_amount = ?, 
      fee_percentage = ?, fixed_fee = ?, description = ?, merch_id = ?, api_token = ?, base_url = ?
      WHERE id = ?`,
      [name, type, status, min_amount, max_amount, fee_percentage, fixed_fee, description, merch_id, api_token, base_url, id]
    );
    
    if (results.affectedRows === 0) {
      return res.status(404).json({ message: 'Payment method not found' });
    }
    
    res.status(200).json({ message: 'Payment method updated successfully' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/payment-gateways/:id/status - Update payment method status
router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // Validate status value
    if (status !== 'active' && status !== 'inactive') {
      return res.status(400).json({ message: 'Invalid status value' });
    }
    
    const [results] = await db.query(
      'UPDATE payment_gateways SET status = ? WHERE id = ?',
      [status, id]
    );
    
    if (results.affectedRows === 0) {
      return res.status(404).json({ message: 'Payment method not found' });
    }
    
    res.status(200).json({ message: `Payment method status updated to ${status}` });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/payment-gateways/:id - Delete a payment method
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [results] = await db.query('DELETE FROM payment_gateways WHERE id = ?', [id]);
    
    if (results.affectedRows === 0) {
      return res.status(404).json({ message: 'Payment method not found' });
    }
    
    res.status(200).json({ message: 'Payment method deleted successfully' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;