const dotenv = require('dotenv');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('../config/db');
const router = express.Router();
//  NEW IMPORTS — add this after your existing imports
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');

const qs = require('qs');
const { authenticateToken } = require('../middleware/adminAuth');

dotenv.config();
	

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
    
 const [rows] = await db.query(query, params);

const rowsWithUrls = rows.map(tx => {
  let screenshotUrl = null;
  if (tx.screenshot) {
    screenshotUrl = tx.screenshot.startsWith("http")
      ? tx.screenshot
      : `${process.env.SPACES_CDN}/${tx.screenshot}`;
  }

  return { ...tx, screenshot_url: screenshotUrl };
});

res.json(rowsWithUrls);


  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ message: 'Error fetching transactions' });
  }
});

// Get transaction count (sum of pending transactions from all tables)
router.get('/count', async (req, res) => {
  try {
    const [moneyTransactions] = await db.query('SELECT COUNT(*) as count FROM money_transactions WHERE status = "pending"');
    const [agentDeposits] = await db.query('SELECT COUNT(*) as count FROM agent_deposit WHERE status = "pending"');
    const [commissionPayments] = await db.query('SELECT COUNT(*) as count FROM commission_payments WHERE status = "pending"');
    
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
    
    
    
    const [rows] = await db.query(query, params);
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
    const [rows] = await db.query('SELECT * FROM money_transactions WHERE id = ?', [id]);
    
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
    const [rows] = await db.query('SELECT * FROM agent_deposit WHERE id = ?', [id]);
    
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
    const [rows] = await db.query('SELECT * FROM commission_payments WHERE id = ?', [id]);
    
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
    const [existingTransaction] = await db.query('SELECT * FROM money_transactions WHERE id = ?', [id]);
    
    if (existingTransaction.length === 0) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    
    // If transaction is being marked as completed, update user's wallet balance
    let newBalance = null;
    if (status === 'completed') {
      const transaction = existingTransaction[0];
      
      // Get user's current wallet balance
      const [userResult] = await db.query('SELECT wallet_balance FROM users WHERE id = ?', [transaction.user_id]);
      
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
        await db.query('UPDATE users SET wallet_balance = ? WHERE id = ?', [newBalance, transaction.user_id]);
      }
    }
    
    // Update transaction status
    await db.query('UPDATE money_transactions SET status = ? WHERE id = ?', [status, id]);
    
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
    const [existingDeposit] = await db.query('SELECT * FROM agent_deposit WHERE id = ?', [id]);

    if (existingDeposit.length === 0) {
      return res.status(404).json({ message: 'Agent deposit not found' });
    }

    const deposit = existingDeposit[0];

    if (deposit.status !== 'pending') {
      return res.status(400).json({ message: `Deposit already ${deposit.status}` });
    }

    if (status === 'completed') {
      const [agentResult] = await db.query(
        'SELECT balance FROM agentlogin WHERE agent_id = ?', [deposit.agent_id]
      );

      if (agentResult.length > 0) {
        const currentBalance = Number(agentResult[0].balance || 0);
        const depositAmount = Number(deposit.amount || 0);
        const newBalance = currentBalance + depositAmount;

        await db.query(
          'UPDATE agentlogin SET balance = ? WHERE agent_id = ?', [newBalance, deposit.agent_id]
        );
      }
    }

    await db.query('UPDATE agent_deposit SET status = ? WHERE id = ?', [status, id]);

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
    const [existingPayment] = await db.query('SELECT * FROM commission_payments WHERE id = ?', [id]);

    if (existingPayment.length === 0) {
      return res.status(404).json({ message: 'Commission payment not found' });
    }

    const payment = existingPayment[0];

    if (payment.status !== 'pending') {
      return res.status(400).json({ message: `Withdraw already ${payment.status}` });
    }

    if (status === 'completed') {
      const [agentResult] = await db.query(
        'SELECT balance FROM agentlogin WHERE agent_id = ?', [payment.agent_id]
      );

      if (agentResult.length > 0) {
        const currentBalance = Number(agentResult[0].balance || 0);
        const withdrawAmount = Number(payment.amount || 0);
        const newBalance = currentBalance - withdrawAmount;

        await db.query(
          'UPDATE agentlogin SET balance = ? WHERE agent_id = ?', [newBalance, payment.agent_id]
        );
      }
    }

    await db.query('UPDATE commission_payments SET status = ? WHERE id = ?', [status, id]);

    res.json({ message: `Agent withdraw ${status} successfully` });
  } catch (error) {
    console.error('Error updating agent withdraw status:', error);
    res.status(500).json({ message: 'Error updating agent withdraw status' });
  }
});


const GATEWAY_BASE_URL = process.env.CLOUDPAY_BASE_URL;
const MERCHANT_ID = process.env.CLOUDPAY_MERCHANT_ID;
const API_TOKEN = process.env.CLOUDPAY_API_TOKEN;
const PAYOUT_CALLBACK_URL = process.env.CLOUDPAY_PAYOUT_CALLBACK_URL;

console.log("✅ CloudPay ENV loaded:", {
  base: GATEWAY_BASE_URL,
  merchant: MERCHANT_ID,
  apiToken: API_TOKEN ? "OK" : "MISSING",
  callback: PAYOUT_CALLBACK_URL
});

function generateSignature(canonicalString, token) {
  if (!token) throw new Error("CLOUDPAY_API_TOKEN missing!");
  return crypto.createHmac("sha256", token).update(canonicalString).digest("hex");
}


/**
 * ===========================================================
 * ✅ ADMIN CLOUDPAY PAYOUT (UPI/BANK for INR)
 * ===========================================================
 * Endpoint: https://api.cloudpay.space/payout/php
 * Canonical: merch_id|amount|acc_no|account_name|payment_method|account_type
 * Docs: https://cloudpay.space/web/docs#payout-php
 * ===========================================================
 */

router.post("/admin-payout", authenticateToken, async (req, res) => {
  try {
    const { transaction_id, amount, upi_id, account_name, acc_no } = req.body;
    const amt = parseFloat(amount);

    if (!transaction_id)
      return res.status(400).json({ success: false, message: "Transaction ID required" });

    if (isNaN(amt) || amt < 100)
      return res.status(400).json({ success: false, message: "Minimum payout ₹100" });

    const [tx] = await db.query(
      `SELECT user_id FROM money_transactions WHERE transaction_id=? OR id=? LIMIT 1`,
      [transaction_id, transaction_id]
    );

    if (!tx.length)
      return res.status(404).json({ success: false, message: "Transaction not found" });

    const userId = tx[0].user_id;

    // ✅ Prepare payout payload
    const payoutBody = {
      merch_id: MERCHANT_ID,
      amount: amt,
      acc_no: upi_id?.trim() || acc_no?.trim(),
      account_name: account_name || "User",
      payment_method: upi_id ? "UPI" : "BANK",
      account_type: "PERSONAL_BANK",
    };

    if (!payoutBody.acc_no)
      throw new Error("UPI ID or Bank Account Number required for payout.");

    // ✅ Canonical + Signature
    const canonical = `merch_id=${payoutBody.merch_id}|amount=${payoutBody.amount}|acc_no=${payoutBody.acc_no}|account_name=${payoutBody.account_name}|payment_method=${payoutBody.payment_method.toUpperCase()}|account_type=${payoutBody.account_type}`;
    const sign = generateSignature(canonical, API_TOKEN);

    console.log("📦 CloudPay Payout Payload:", payoutBody);
    console.log("🧾 Canonical:", canonical);
    console.log("🔐 Signature:", sign);

    // ✅ POST to CloudPay
    const response = await axios.post(`${GATEWAY_BASE_URL}/payout/php`, payoutBody, {
      headers: {
        "Content-Type": "application/json",
        "X-Verify": sign,
      },
    });

    console.log("💸 CloudPay Payout Response:", response.data);

    if (!response.data.status)
      throw new Error(response.data.message || "CloudPay payout failed");

    await db.query(
      `UPDATE money_transactions 
       SET status='processing', remarks='Admin payout initiated (CloudPay)', updated_at=NOW() 
       WHERE transaction_id=? OR id=?`,
      [transaction_id, transaction_id]
    );

    res.json({
      success: true,
      message: "✅ CloudPay payout initiated successfully",
      data: response.data,
    });
  } catch (err) {
    console.error("❌ Admin Payout Error:", err.response?.data || err.message);
    res.status(500).json({
      success: false,
      message: err.response?.data?.message || err.message || "Failed to initiate payout",
    });
  }
});

/**
 * ===========================================================
 * ✅ ADMIN CLOUDPAY PAYOUT STATUS CHECK
 * ===========================================================
 * Endpoint: https://api.cloudpay.space/api/v1/payout-status
 * Canonical: merch_id|withdraw_id|payout_type
 * payout_type = "bank" for INR/UPI
 * ===========================================================
 */

router.post("/admin-payout-status", authenticateToken, async (req, res) => {
  try {
    const { withdraw_id } = req.body;

    if (!withdraw_id)
      return res.status(400).json({ success: false, message: "withdraw_id required" });

    const body = {
      merch_id: MERCHANT_ID,
      withdraw_id,
      payout_type: "bank",
    };

    const canonical = `merch_id=${body.merch_id}|withdraw_id=${body.withdraw_id}|payout_type=${body.payout_type}`;
    const sign = generateSignature(canonical, API_TOKEN);

    console.log("🧾 Canonical:", canonical);
    console.log("🔐 Signature:", sign);

    const response = await axios.post(`${GATEWAY_BASE_URL}/api/v1/payout-status`, body, {
      headers: { "Content-Type": "application/json", "X-Verify": sign },
    });

    console.log("💸 CloudPay Payout Status:", response.data);

    if (!response.data.status)
      return res.status(400).json({
        success: false,
        message: response.data.message || "Failed to fetch payout status",
      });

    const txnStatus = (response.data.result?.txnStatus || "").toUpperCase();
    const newStatus = txnStatus === "SUCCESS" ? "completed" : txnStatus === "FAILURE" ? "failed" : "processing";

    await db.query(
      `UPDATE money_transactions 
       SET status=?, remarks='Payout ${txnStatus.toLowerCase()} (manual check)', updated_at=NOW()
       WHERE transaction_id=? OR remarks LIKE ?`,
      [newStatus, withdraw_id, `%${withdraw_id}%`]
    );

    res.json({
      success: true,
      message: "✅ Payout status fetched successfully",
      data: response.data.result,
    });
  } catch (err) {
    console.error("💥 Payout Status Error:", err.response?.data || err.message);
    res.status(500).json({
      success: false,
      message: err.response?.data?.message || err.message || "Failed to fetch payout status",
    });
  }
});

/**
 * ===========================================================
 * ✅ SECURE CLOUDPAY PAYOUT CALLBACK (WEBHOOK)
 * ===========================================================
 * Verifies CloudPay's HMAC-SHA256 signature.
 * Always return 200 OK to avoid duplicate retries.
 * ===========================================================
 */

router.post("/upi/payout-callback", async (req, res) => {
  try {
    console.log("📥 CloudPay Callback received:", req.body);
    const { withdraw_id, txnStatus, amount, sign } = req.body;

    if (!withdraw_id) return res.status(200).send("OK");

    const canonical = `merch_id=${MERCHANT_ID}|withdraw_id=${withdraw_id}|payout_type=bank`;
    const expectedSign = generateSignature(canonical, API_TOKEN);

    if (!sign || sign.toLowerCase() !== expectedSign.toLowerCase()) {
      console.warn("🚨 Invalid signature in CloudPay callback!");
      return res.status(403).send("Invalid signature");
    }

    console.log("✅ Verified CloudPay signature");
    const status = (txnStatus || "").toUpperCase();

    const [tx] = await db.query(
      `SELECT * FROM money_transactions WHERE transaction_id=? OR remarks LIKE ? LIMIT 1`,
      [withdraw_id, `%${withdraw_id}%`]
    );

    if (!tx.length) {
      console.warn(`⚠️ No transaction found for withdraw_id ${withdraw_id}`);
      return res.status(200).send("OK");
    }

    const txn = tx[0];
    const userId = txn.user_id;

    if (status === "SUCCESS") {
      await db.query(
        `UPDATE money_transactions SET status='completed', remarks='Payout success (callback verified)', updated_at=NOW() WHERE id=?`,
        [txn.id]
      );
      console.log(`✅ Payout SUCCESS for ${withdraw_id}`);
    } else if (["FAILURE", "FAILED"].includes(status)) {
      const [alreadyRefunded] = await db.query(
        `SELECT id FROM refund_log WHERE transaction_id=? LIMIT 1`,
        [txn.id]
      );

      if (!alreadyRefunded.length) {
        await db.query(
          `UPDATE users SET wallet_balance = wallet_balance + ? WHERE id=?`,
          [amount || txn.amount, userId]
        );
        await db.query(
          `INSERT INTO refund_log (transaction_id, user_id, amount, created_at) VALUES (?, ?, ?, NOW())`,
          [txn.id, userId, amount || txn.amount]
        );
        console.log(`💰 Refunded ₹${amount || txn.amount} for failed payout ${withdraw_id}`);
      } else {
        console.log(`⚠️ Duplicate refund prevented for ${withdraw_id}`);
      }

      await db.query(
        `UPDATE money_transactions SET status='failed', remarks='Payout failed (callback verified)', updated_at=NOW() WHERE id=?`,
        [txn.id]
      );
    } else if (status === "PROCESSING") {
      await db.query(
        `UPDATE money_transactions SET status='processing', remarks='Payout processing (callback verified)', updated_at=NOW() WHERE id=?`,
        [txn.id]
      );
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("💥 Callback Error:", err.message);
    res.status(200).send("OK");
  }
});

module.exports = router;