const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Get tickets count
router.get('/count', async (req, res) => {
  console.log("ticket count request");
  try {
    // Fix: Use status = 'open' instead of status != 'open'
    const [result] = await db.query(
      'SELECT COUNT(*) as count FROM tickets WHERE status = ?',
      ['open']
    );
    
    res.json({ count: result[0].count }); // Access count from first row
  } catch (error) {
    console.error('Error fetching tickets count:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all tickets
router.get('/', async (req, res) => {
  try {
    // Fix: Use status = 'open' instead of status != 'open'
    const [tic] = await db.query(
      'SELECT * FROM tickets WHERE status = ? ORDER BY created_at DESC',
      ['open']
    );
    
    res.json(tic); // Return the array directly
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Accept or reject ticket
router.put('/:id/status', async (req, res) => {
  try {
    const ticketId = req.params.id;
    const { status, action } = req.body; // Get status and action from body
    
    // Get ticket details
    const [ticketResult] = await db.query(
      'SELECT * FROM tickets WHERE id = ?',
      [ticketId]
    );
    
    if (!ticketResult || ticketResult.length === 0) {
      return res.status(404).json({ message: 'Ticket not found' });
    }
    
    const ticket = ticketResult[0];
    
    // Update ticket status
    await db.query(
      'UPDATE tickets SET status = ? WHERE id = ?',
      [status, ticketId]
    );
    
    // Add response to ticket_responses table if needed
    if (action) {
      await db.query(
        'INSERT INTO ticket_responses (admin_id, user_id, ticket_id, message) VALUES (?, ?, ?, ?)',
        [req.admin ? req.admin.id : 1, ticket.user_id, ticketId, action === 'accept' ? 'Accepted' : 'Rejected']
      );
    }
    
    res.json({ message: `Ticket ${action || status}ed successfully` });
  } catch (error) {
    console.error(`Error updating ticket:`, error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;