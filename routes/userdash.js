const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db'); // Database connection (promise pool)
const crypto = require('crypto'); // Node.js built-in crypto module

// Generate random referral code using crypto
function generateReferralCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// GET /api/users - Get all users with filtering and search
router.get('/', async (req, res) => {
  try {
    const { role, status, search } = req.query; // Removed referred_by
    
    let query = 'SELECT * FROM users WHERE 1=1';
    const params = [];
    
    if (role) {
      query += ' AND role = ?';
      params.push(role);
    }
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    
    if (search) {
      query += ' AND (name LIKE ? OR id LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    const [results] = await db.query(query, params);
    res.status(200).json(results);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/count - Get total user count
router.get('/count', async (req, res) => {
  try {
    const [results] = await db.query('SELECT COUNT(*) as count FROM users');
    res.status(200).json({ count: results[0].count });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/users - Create a new user
router.post('/', async (req, res) => {
  try {
    const { name, email, mobile, dob, password, wallet_balance } = req.body;
    
    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Generate referral code
    const referralCode = generateReferralCode();
    
    // Insert user into database
    const query = `
      INSERT INTO users 
      (name, email, mobile, dob, password, wallet_balance, referral_code, referred_by, status, role) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'Prime Player')
    `;
    
    const [results] = await db.query(query, [
      name, 
      email, 
      mobile, 
      dob, 
      hashedPassword, 
      wallet_balance, 
      referralCode, 
      'admin' // referred_by is set to admin
    ]);
    
    res.status(201).json({ 
      message: 'User created successfully', 
      userId: results.insertId,
      userName: name
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/users/:id/status - Update user status
router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // Validate status value
    if (status !== 'Active' && status !== 'Suspended') {
      return res.status(400).json({ message: 'Invalid status value' });
    }
    
    const [results] = await db.query(
      'UPDATE users SET status = ? WHERE id = ?',
      [status, id]
    );
    
    if (results.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.status(200).json({ message: `User status updated to ${status}` });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/:id/details - Get user details
router.get('/:id/details', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [results] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    
    if (results.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.status(200).json(results[0]);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/:id/transactions/completed - Get completed transactions for a user
router.get('/:id/transactions/completed', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [results] = await db.query(
      'SELECT type, amount, created_at FROM money_transactions WHERE user_id = ? AND status = "completed"',
      [id]
    );
    
    res.status(200).json(results);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/:id/transactions/pending - Get pending transactions for a user
router.get('/:id/transactions/pending', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [results] = await db.query(
      'SELECT id, type, amount, payment_method, utr, screenshot FROM money_transactions WHERE user_id = ? AND status = "pending"',
      [id]
    );
    
    res.status(200).json(results);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/:id/tickets - Get tickets for a user
router.get('/:id/tickets', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [results] = await db.query(
      'SELECT id, user_id, subject, message, email, evidence, status FROM tickets WHERE user_id = ?',
      [id]
    );
    
    res.status(200).json(results);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/tickets/:id/status - Update ticket status
router.put('/tickets/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
   
    // Validate status value
    if (!['closed', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }
    
    const [results] = await db.query(
      'UPDATE tickets SET status = ? WHERE id = ?',
      [status, id]
    );
    
    if (results.affectedRows === 0) {
      return res.status(404).json({ message: 'Ticket not found' });
    }
    
    res.status(200).json({ message: `Ticket status updated to ${status}` });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/transactions/:id/status - Update transaction status
router.put("/transactions/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!["completed", "rejected"].includes(status)) {
    return res.status(400).json({ message: "Invalid status value" });
  }

  let connection;
  try {
    connection = await db.getConnection();

    // 🔍 Get transaction
    const [txResults] = await connection.query(
      "SELECT * FROM money_transactions WHERE id = ?",
      [id]
    );
    if (txResults.length === 0) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    const tx = txResults[0];
    const amount = parseFloat(tx.amount);
    const type = tx.type.toLowerCase(); // "deposit" | "withdraw"
    const userId = tx.user_id;

    // Start SQL transaction
    await connection.beginTransaction();

    // 🟢 Handle deposit/withdrawal completion
    if (status === "completed") {
      // Get user wallet
      const [userRes] = await connection.query(
        "SELECT wallet_balance FROM users WHERE id = ?",
        [userId]
      );
      if (userRes.length === 0) throw new Error("User not found");

      const currentBalance = parseFloat(userRes[0].wallet_balance);
      let newBalance = currentBalance;

      // Update wallet
      if (type === "deposit") {
        newBalance = currentBalance + amount;
      } else if (type === "withdraw") {
        newBalance = currentBalance - amount;
      } else {
        throw new Error("Invalid transaction type");
      }

      await connection.query(
        "UPDATE users SET wallet_balance = ? WHERE id = ?",
        [newBalance, userId]
      );

      // Mark as processing initially
      await connection.query(
        `UPDATE money_transactions 
         SET status='processing', remarks='Wallet updated, payout pending', updated_at=NOW() 
         WHERE id=?`,
        [id]
      );

      // ✅ Commit balance update before calling external API
      await connection.commit();

      // 🧩 Trigger payout only for withdrawals
      if (type === "withdraw") {
        const gateway = (tx.payment_method || "").toLowerCase();
        const payoutData = {
          transaction_id: tx.transaction_id,
          amount,
          userId,
          payment_method: tx.payment_method,
          gateway,
          bank_code: tx.bank_code,
          ifsc_code: tx.ifsc_code,
          acc_no: tx.account_number || tx.acc_no,
          account_name: tx.account_name,
          upi_id: tx.upi_id,
        };

        const payoutURL =
          gateway === "toppay"
            ? `${process.env.BASE_URL}/api/transactions/admin-payout-toppay`
            : `${process.env.BASE_URL}/api/transactions/admin-payout`;

        try {
          const payoutRes = await axios.post(payoutURL, payoutData, {
            headers: { Authorization: req.headers.authorization },
            timeout: 20000,
          });

          console.log("✅ Payout API success:", payoutRes.data);

          // Mark payout complete
          await db.query(
            `UPDATE money_transactions 
             SET status='completed', remarks='Payout successful', payout_response=?, updated_at=NOW() 
             WHERE id=?`,
            [JSON.stringify(payoutRes.data), id]
          );

          return res.json({
            success: true,
            message: `Withdrawal ₹${amount} processed successfully via ${gateway.toUpperCase()}.`,
            newBalance,
          });
        } catch (err) {
          console.error("💥 Payout failed:", err.response?.data || err.message);

          // Rollback wallet (refund user)
          await db.query(
            "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?",
            [amount, userId]
          );

          await db.query(
            `UPDATE money_transactions 
             SET status='failed', remarks='Payout failed, wallet refunded', updated_at=NOW()
             WHERE id=?`,
            [id]
          );

          return res.status(500).json({
            success: false,
            message: "Payout failed, wallet refunded automatically.",
          });
        }
      }

      // 🟢 Deposit — completed successfully
      return res.json({
        success: true,
        message: "Deposit completed and wallet updated successfully.",
        newBalance,
      });
    }

    // 🔵 If rejected
    await connection.query("UPDATE money_transactions SET status = ? WHERE id = ?", [
      status,
      id,
    ]);
    await connection.commit();

    return res.json({
      success: true,
      message: `Transaction ${status} successfully.`,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("💥 Error updating transaction:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/users/:id/wallet - Update wallet balance and record transaction
router.put('/:id/wallet', async (req, res) => {
  try {
    const { id } = req.params;
    const { type, amount } = req.body;
    
    // Validate type and amount
    if (!['deposit', 'withdraw'].includes(type)) {
      return res.status(400).json({ message: 'Invalid transaction type' });
    }
    
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }
    
    // Get current user and wallet balance
    const [userResults] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    if (userResults.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const user = userResults[0];
    const currentBalance = parseFloat(user.wallet_balance);
    let newBalance;
    
    if (type === 'deposit') {
      newBalance = currentBalance + amount;
    } else if (type === 'withdraw') {
      newBalance = currentBalance - amount;
      // Check if user has enough balance
      if (newBalance < 0) {
        return res.status(400).json({ message: 'Insufficient balance' });
      }
    }
    
    // Start a transaction to ensure atomicity
    const connection = await db.getConnection();
    await connection.beginTransaction();
    
    try {
      // Update user's wallet balance
      await connection.query(
        'UPDATE users SET wallet_balance = ? WHERE id = ?',
        [newBalance, id]
      );
      
      // Insert transaction record
      await connection.query(
        'INSERT INTO money_transactions (user_id, type, amount, payment_method, status) VALUES (?, ?, ?, ?, ?)',
        [id, type, amount, 'cash', 'completed']
      );
      
      await connection.commit();
      
      res.status(200).json({ 
        message: `${type} successful`,
        newBalance: newBalance
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;