const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const pool = require('../config/db');
const router = express.Router();
//  NEW IMPORTS — add this after your existing imports
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const path = require('path');

//  Setup Multer (for file upload parsing)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Initialize DigitalOcean Spaces client
const s3 = new S3Client({
  region: process.env.SPACES_REGION,
  endpoint: process.env.SPACES_ENDPOINT,
  credentials: {
    accessKeyId: process.env.SPACES_KEY_ADMIN,
    secretAccessKey: process.env.SPACES_SECRET_ADMIN
  }
});

// Middleware for this router
router.use(cors());
router.use(bodyParser.json());

// Get all transactions with optional filters
router.get('/', async (req, res) => {
  try {
    const { type, status } = req.query;
    let query = 'SELECT * FROM money_transactions';
    const params = [];
    
    // Build WHERE clause based on filters
    const conditions = [];
    if (type) {
      conditions.push('type = ?');
      params.push(type);
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
    console.error('Error fetching transactions:', error);
    res.status(500).json({ message: 'Error fetching transactions' });
  }
});

// Get transaction count (sum of pending transactions from all tables)
router.get('/count', async (req, res) => {
  try {
    const [moneyTransactions] = await pool.query('SELECT COUNT(*) as count FROM money_transactions WHERE status = "pending"');
    const [agentDeposits] = await pool.query('SELECT COUNT(*) as count FROM agent_deposit WHERE status = "pending"');
    const [commissionPayments] = await pool.query('SELECT COUNT(*) as count FROM commission_payments WHERE status = "pending"');
    
    const totalCount = moneyTransactions[0].count + agentDeposits[0].count + commissionPayments[0].count;
    res.json({ count: totalCount });
  } catch (error) {
    console.error('Error fetching transaction count:', error);
    res.status(500).json({ message: 'Error fetching transaction count' });
  }
});

// Get agent transactions with filters
router.get('/agent', async (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT 'deposit' as type, id, agent_id, amount, status
      FROM agent_deposit 
    `;
    
    const params = [];
    const conditions = [];
    
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' UNION ALL ';
    
    query += `
      SELECT 'withdraw' as type, id, agent_id, amount, status 
      FROM commission_payments 
    `;
    
    // Reset conditions for the second table
    const conditions2 = [];
    if (status) {
      conditions2.push('status = ?');
      params.push(status);
    }
    
    if (conditions2.length > 0) {
      query += ' WHERE ' + conditions2.join(' AND ');
    }
    
    
    
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching agent transactions:', error);
    res.status(500).json({ message: 'Error fetching agent transactions' });
  }
});

// Get a specific transaction by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const [rows] = await pool.query('SELECT * FROM money_transactions WHERE id = ?', [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching transaction:', error);
    res.status(500).json({ message: 'Error fetching transaction' });
  }
});

// Get agent deposit details
router.get('/agent/deposit/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const [rows] = await pool.query('SELECT * FROM agent_deposit WHERE id = ?', [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Agent deposit not found' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching agent deposit:', error);
    res.status(500).json({ message: 'Error fetching agent deposit' });
  }
});

// Get commission payment details
router.get('/agent/commission/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const [rows] = await pool.query('SELECT * FROM commission_payments WHERE id = ?', [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Commission payment not found' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching commission payment:', error);
    res.status(500).json({ message: 'Error fetching commission payment' });
  }
});

// Update transaction status
router.put('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  if (!status || (status !== 'pending' && status !== 'completed' && status !== 'reject')) {
    return res.status(400).json({ message: 'Valid status (pending/completed/reject) is required' });
  }
  
  try {
    // Check if transaction exists
    const [existingTransaction] = await pool.query('SELECT * FROM money_transactions WHERE id = ?', [id]);
    
    if (existingTransaction.length === 0) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    
    // If transaction is being marked as completed, update user's wallet balance
    let newBalance = null;
    if (status === 'completed') {
      const transaction = existingTransaction[0];
      
      // Get user's current wallet balance
      const [userResult] = await pool.query('SELECT wallet_balance FROM users WHERE id = ?', [transaction.user_id]);
      
      if (userResult.length > 0) {
        const currentBalance = parseFloat(userResult[0].wallet_balance);
        const transactionAmount = parseFloat(transaction.amount);
        
        // Calculate new balance based on transaction type
        if (transaction.type === 'deposit') {
          newBalance = currentBalance + transactionAmount;
        } else if (transaction.type === 'withdrawal') {
          newBalance = currentBalance - transactionAmount;
        }
        
        // Update user's wallet balance
        await pool.query('UPDATE users SET wallet_balance = ? WHERE id = ?', [newBalance, transaction.user_id]);
      }
    }
    
    // Update transaction status
    await pool.query('UPDATE money_transactions SET status = ? WHERE id = ?', [status, id]);
    
    const response = { message: `Transaction ${status} successfully` };
    if (newBalance !== null) {
      response.newBalance = newBalance;
    }
    
    res.json(response);
  } catch (error) {
    console.error('Error updating transaction status:', error);
    res.status(500).json({ message: 'Error updating transaction status' });
  }
});


// Update agent deposit status
router.put('/agent/deposit/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['completed', 'reject'].includes(status)) {
    return res.status(400).json({ message: 'Valid status (completed/reject) is required' });
  }

  try {
    const [existingDeposit] = await pool.query('SELECT * FROM agent_deposit WHERE id = ?', [id]);

    if (existingDeposit.length === 0) {
      return res.status(404).json({ message: 'Agent deposit not found' });
    }

    const deposit = existingDeposit[0];

    if (deposit.status !== 'pending') {
      return res.status(400).json({ message: `Deposit already ${deposit.status}` });
    }

    if (status === 'completed') {
      const [agentResult] = await pool.query(
        'SELECT balance FROM agentlogin WHERE agent_id = ?', [deposit.agent_id]
      );

      if (agentResult.length > 0) {
        const currentBalance = Number(agentResult[0].balance || 0);
        const depositAmount = Number(deposit.amount || 0);
        const newBalance = currentBalance + depositAmount;

        await pool.query(
          'UPDATE agentlogin SET balance = ? WHERE agent_id = ?', [newBalance, deposit.agent_id]
        );
      }
    }

    await pool.query('UPDATE agent_deposit SET status = ? WHERE id = ?', [status, id]);

    res.json({ message: `Agent deposit ${status} successfully` });
  } catch (error) {
    console.error('Error updating agent deposit status:', error);
    res.status(500).json({ message: 'Error updating agent deposit status' });
  }
});



// Update commission payment status (Withdraw)
router.put('/agent/commission/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['completed', 'reject'].includes(status)) {
    return res.status(400).json({ message: 'Valid status (completed/reject) is required' });
  }

  try {
    const [existingPayment] = await pool.query('SELECT * FROM commission_payments WHERE id = ?', [id]);

    if (existingPayment.length === 0) {
      return res.status(404).json({ message: 'Commission payment not found' });
    }

    const payment = existingPayment[0];

    if (payment.status !== 'pending') {
      return res.status(400).json({ message: `Withdraw already ${payment.status}` });
    }

    if (status === 'completed') {
      const [agentResult] = await pool.query(
        'SELECT balance FROM agentlogin WHERE agent_id = ?', [payment.agent_id]
      );

      if (agentResult.length > 0) {
        const currentBalance = Number(agentResult[0].balance || 0);
        const withdrawAmount = Number(payment.amount || 0);
        const newBalance = currentBalance - withdrawAmount;

        await pool.query(
          'UPDATE agentlogin SET balance = ? WHERE agent_id = ?', [newBalance, payment.agent_id]
        );
      }
    }

    await pool.query('UPDATE commission_payments SET status = ? WHERE id = ?', [status, id]);

    res.json({ message: `Agent withdraw ${status} successfully` });
  } catch (error) {
    console.error('Error updating agent withdraw status:', error);
    res.status(500).json({ message: 'Error updating agent withdraw status' });
  }
});


module.exports = router;