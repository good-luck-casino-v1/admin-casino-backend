const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const pool = require('../config/db');
const router = express.Router();

// Middleware for this router
router.use(cors());
router.use(bodyParser.json());

// API Routes
// Get all agents
router.get('/agents', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM agents');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching agents:', error);
    res.status(500).json({ message: 'Error fetching agents' });
  }
});

// Get agent count
router.get('/agents/count', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT COUNT(*) as count FROM agents');
    res.json({ count: rows[0].count });
  } catch (error) {
    console.error('Error fetching agent count:', error);
    res.status(500).json({ message: 'Error fetching agent count' });
  }
});

// Add new agent
router.post('/agents', async (req, res) => {
  const { name, email, mobile, password, commission } = req.body;
  
  try {
    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    
    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // Insert into agents table
      const [agentsResult] = await connection.query(
        'INSERT INTO agents (name, email, mobile, password, commission) VALUES (?, ?, ?, ?, ?)',
        [name, email, mobile, passwordHash, commission]
      );
      
      // Insert into agentlogin table
      await connection.query(
        'INSERT INTO agentlogin (agent_id, agent_name, email, mobile, password_hash) VALUES (?, ?, ?, ?, ?)',
        [agentsResult.insertId, name, email, mobile, passwordHash]
      );
      
      // Commit transaction
      await connection.commit();
      
      res.status(201).json({ message: 'Agent added successfully', id: agentsResult.insertId });
    } catch (error) {
      // Rollback transaction on error
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error adding agent:', error);
    res.status(500).json({ message: 'Error adding agent' });
  }
});

// Get agent by ID
router.get('/agents/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const [rows] = await pool.query('SELECT * FROM agents WHERE id = ?', [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Agent not found' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching agent:', error);
    res.status(500).json({ message: 'Error fetching agent' });
  }
});

// Get agent login details by ID
router.get('/agentlogin/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const [rows] = await pool.query('SELECT * FROM agentlogin WHERE agent_id = ?', [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Agent not found' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching agent login details:', error);
    res.status(500).json({ message: 'Error fetching agent login details' });
  }
});

// Get pending deposits
router.get('/deposits/pending', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT d.*, a.agent_name 
      FROM agent_deposit d
      JOIN agentlogin a ON d.agent_id = a.agent_id
      WHERE d.status = 'pending'
    `);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching pending deposits:', error);
    res.status(500).json({ message: 'Error fetching pending deposits' });
  }
});

// Add new deposit - FIXED to update balance immediately
router.post('/deposits', async (req, res) => {
  const { agent_id, amount } = req.body;
  
  try {
    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // Update agent balance
      await connection.query(
        'UPDATE agentlogin SET balance = balance + ? WHERE agent_id = ?',
        [amount, agent_id]
      );
      
      // Insert deposit record with status 'completed'
      const [result] = await connection.query(
        'INSERT INTO agent_deposit (agent_id, amount, status) VALUES (?, ?, ?)',
        [agent_id, amount, 'completed']
      );
      
      // Commit transaction
      await connection.commit();
      
      res.status(201).json({ message: 'Deposit added successfully', id: result.insertId });
    } catch (error) {
      // Rollback transaction on error
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error adding deposit:', error);
    res.status(500).json({ message: 'Error adding deposit' });
  }
});

// Accept deposit - Kept for existing pending deposits
router.put('/deposits/:id/accept', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Get deposit details
    const [depositRows] = await pool.query('SELECT * FROM agent_deposit WHERE id = ?', [id]);
    
    if (depositRows.length === 0) {
      return res.status(404).json({ message: 'Deposit not found' });
    }
    
    const deposit = depositRows[0];
    
    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // Update agent balance
      await connection.query(
        'UPDATE agentlogin SET balance = balance + ? WHERE agent_id = ?',
        [deposit.amount, deposit.agent_id]
      );
      
      // Update deposit status
      await connection.query(
        'UPDATE agent_deposit SET status = ? WHERE id = ?',
        ['completed', id]
      );
      
      // Commit transaction
      await connection.commit();
      
      res.json({ message: 'Deposit accepted successfully' });
    } catch (error) {
      // Rollback transaction on error
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error accepting deposit:', error);
    res.status(500).json({ message: 'Error accepting deposit' });
  }
});

// Get pending withdrawals
router.get('/withdrawals/pending', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT cp.*, a.agent_name 
      FROM commission_payments cp
      JOIN agentlogin a ON cp.agent_id = a.agent_id
      WHERE cp.status = 'pending'
    `);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching pending withdrawals:', error);
    res.status(500).json({ message: 'Error fetching pending withdrawals' });
  }
});

// Add new withdrawal - UPDATED to create pending withdrawal
router.post('/withdrawals', async (req, res) => {
  const { agent_id, amount } = req.body;
  
  try {
    // Get agent details to check balance
    const [agentRows] = await pool.query('SELECT * FROM agentlogin WHERE agent_id = ?', [agent_id]);
    
    if (agentRows.length === 0) {
      return res.status(404).json({ message: 'Agent not found' });
    }
    
    const agent = agentRows[0];
    
    // Check if agent has sufficient balance
    if (agent.balance < amount) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }
    
    // Create withdrawal record with status 'pending'
    const [result] = await pool.query(
      'INSERT INTO commission_payments (agent_id, amount, status) VALUES (?, ?, ?)',
      [agent_id, amount, 'pending']
    );
    
    res.status(201).json({ message: 'Withdrawal request created successfully', id: result.insertId });
  } catch (error) {
    console.error('Error adding withdrawal:', error);
    res.status(500).json({ message: 'Error adding withdrawal' });
  }
});

// Accept withdrawal - UPDATED to update balance and change status
router.put('/withdrawals/:id/accept', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Get withdrawal details
    const [withdrawalRows] = await pool.query('SELECT * FROM commission_payments WHERE id = ?', [id]);
    
    if (withdrawalRows.length === 0) {
      return res.status(404).json({ message: 'Withdrawal not found' });
    }
    
    const withdrawal = withdrawalRows[0];
    
    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // Update agent balance
      await connection.query(
        'UPDATE agentlogin SET balance = balance - ? WHERE agent_id = ?',
        [withdrawal.amount, withdrawal.agent_id]
      );
      
      // Update withdrawal status
      await connection.query(
        'UPDATE commission_payments SET status = ? WHERE id = ?',
        ['completed', id]
      );
      
      // Commit transaction
      await connection.commit();
      
      res.json({ message: 'Withdrawal processed successfully' });
    } catch (error) {
      // Rollback transaction on error
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error accepting withdrawal:', error);
    res.status(500).json({ message: 'Error accepting withdrawal' });
  }
});

// Get open tickets
router.get('/tickets/open', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.*, a.agent_name 
      FROM tickets t
      JOIN agentlogin a ON t.agent_id = a.agent_id
      WHERE t.status = 'open' AND t.user_type = 'agent'
    `);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching open tickets:', error);
    res.status(500).json({ message: 'Error fetching open tickets' });
  }
});

// Close ticket - FIXED to properly update database
router.put('/tickets/:id/close', async (req, res) => {
  const { id } = req.params;
  
  try {
    const [result] = await pool.query(
      'UPDATE tickets SET status = ? WHERE id = ?',
      ['close', id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Ticket not found' });
    }
    
    res.json({ message: 'Ticket closed successfully' });
  } catch (error) {
    console.error('Error closing ticket:', error);
    res.status(500).json({ message: 'Error closing ticket' });
  }
});

// Reject ticket - FIXED to properly update database
router.put('/tickets/:id/reject', async (req, res) => {
  const { id } = req.params;
  
  try {
    const [result] = await pool.query(
      'UPDATE tickets SET status = ? WHERE id = ?',
      ['reject', id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Ticket not found' });
    }
    
    res.json({ message: 'Ticket rejected successfully' });
  } catch (error) {
    console.error('Error rejecting ticket:', error);
    res.status(500).json({ message: 'Error rejecting ticket' });
  }
});

// Get players by agent ID
router.get('/players/:agentId', async (req, res) => {
  const { agentId } = req.params;
  
  try {
    // Get agent name
    const [agentRows] = await pool.query('SELECT agent_name FROM agentlogin WHERE agent_id = ?', [agentId]);
    
    if (agentRows.length === 0) {
      return res.status(404).json({ message: 'Agent not found' });
    }
    
    const agentName = agentRows[0].agent_name;
    
    // Get players
    const [rows] = await pool.query(
      'SELECT id, name, email, mobile, wallet_balance, role FROM users WHERE referred_by = ?',
      [agentName]
    );
    
    res.json(rows);
  } catch (error) {
    console.error('Error fetching players:', error);
    res.status(500).json({ message: 'Error fetching players' });
  }
  // Accept withdrawal - UPDATED to update agent balance
router.put('/withdrawals/:id/accept', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Get withdrawal details
    const [withdrawalRows] = await pool.query('SELECT * FROM commission_payments WHERE id = ?', [id]);
    
    if (withdrawalRows.length === 0) {
      return res.status(404).json({ message: 'Withdrawal not found' });
    }
    
    const withdrawal = withdrawalRows[0];
    
    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // Update agent balance (subtract the amount)
      await connection.query(
        'UPDATE agentlogin SET balance = balance - ? WHERE agent_id = ?',
        [withdrawal.amount, withdrawal.agent_id]
      );
      
      // Update withdrawal status to completed
      await connection.query(
        'UPDATE commission_payments SET status = ? WHERE id = ?',
        ['completed', id]
      );
      
      // Commit transaction
      await connection.commit();
      
      res.json({ message: 'Withdrawal processed successfully' });
    } catch (error) {
      // Rollback transaction on error
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error processing withdrawal:', error);
    res.status(500).json({ message: 'Error processing withdrawal' });
  }
});
});

module.exports = router;