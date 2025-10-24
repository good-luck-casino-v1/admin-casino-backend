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
const dotenv = require('dotenv');
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


// ===================== WDDPay Configuration =====================
const MERCHANT_ID = process.env.WDDPAY_MERCHANT_ID;
const SECRET_KEY = process.env.WDDPAY_SECRET_KEY;
const GATEWAY_BASE = process.env.WDDPAY_BASE_URL?.replace(/\/$/, "") || "https://api.wddpay.vip";
const CALLBACK_PATH =
  (process.env.BACKEND_URL?.replace(/\/$/, "") || "https://api.goodluck24bet.com") +
  "/api/upi/callback";


  // ===================== Helpers =====================
function md5Lower(str) {
  return crypto.createHash("md5").update(str, "utf8").digest("hex").toLowerCase();
}

function buildTransferSign(params) {
  const filtered = {};
  Object.keys(params).forEach((k) => {
    const v = params[k];
    if (v !== undefined && v !== null) filtered[k] = String(v);
  });

  const signString =
    Object.keys(filtered)
      .sort()
      .map((k) => `${k}=${filtered[k]}`)
      .join("&") + `&key=${SECRET_KEY}`;

  return { signString, sign: md5Lower(signString) };
}

//  Merchant Balance Check (Optional but Safe)
async function getMerchantBalance() {
  try {
    const signStr = `appId=${MERCHANT_ID}&key=${SECRET_KEY}`;
    const sign = md5Lower(signStr);
    const { data } = await axios.get(`${GATEWAY_BASE}/api/getBalance`, {
      params: { appId: MERCHANT_ID, sign },
      timeout: 10000,
    });
    return data;
  } catch (err) {
    console.error("getMerchantBalance error:", err.message);
    throw err;
  }
}

// Insert near top of file if not already present:
async function getMerchantBalanceSafe() {
  // returns object from gateway: { code, message, data: { balance, availableBalance, blockedBalance } }
  return getMerchantBalance();
}


// ===================== Utility: Create MD5 Signature =====================
function createSignatureFixedOrder(params) {
  // Order based on official India rule
  const {
    account,
    amount,
    appId,
    ifsc,
    mobile,
    notifyCallback,
    orderNumber,
    username,
  } = params;

  const signStr = `account=${account}&amount=${amount}&appId=${appId}&ifsc=${ifsc}&mobile=${mobile}&notifyCallback=${notifyCallback}&orderNumber=${orderNumber}&username=${username}&key=${SECRET_KEY}`;

  const hash = crypto.createHash("md5").update(signStr, "utf8").digest("hex"); // lowercase per WDDPay doc
  return { signStr, hash };
}


//  DEPOSIT (Collection Order)
// ======================================================
// router.post("/upi/deposit", requireAuth, async (req, res) => {
//   const connection = await db.getConnection();
//   try {
//     const { name = "User", amount } = req.body;
//     const user_id = req.user.id;

//     if (!amount || parseFloat(amount) < 100)
//       return res.status(400).json({ success: false, message: "Minimum deposit ₹100" });

//     const transaction_id = "TXN" + Date.now();

//     const BASE_FRONTEND_URL = process.env.FRONTEND_URL || "https://goodluck24bet.com";
//     const BASE_BACKEND_URL = process.env.BACKEND_URL || "https://api.goodluck24bet.com";

//     const redirect_url = `${BASE_FRONTEND_URL}/deposit-success`;
//     const callback_url = `${BASE_BACKEND_URL}/api/upi/callback`;

//     await connection.beginTransaction();

//     await connection.query(
//       `INSERT INTO payment_transactions 
//        (player_id, name, transaction_id, merch_id, transaction_type, amount, currency, status, redirect_url, callback_url)
//        VALUES (?, ?, ?, ?, 'ORDER', ?, 'INR', 'PENDING', ?, ?)`,
//       [user_id, name, transaction_id, MERCHANT_ID, amount, redirect_url, callback_url]
//     );

//     //  Match WDDPay India fields
//     const payload = {
//       appId: MERCHANT_ID,
//       orderNumber: transaction_id,
//       amount: parseFloat(amount).toFixed(2),
//       account: "testupi@oksbi", // dynamic if needed
//       ifsc: "SBIN0000123", // required for bank mode
//       mobile: "9876543210",
//       username: name,
//       notifyCallback: callback_url,
//     };

//     const { signStr, hash } = createSignatureFixedOrder(payload);
//     payload.sign = hash;

//     console.log("\n===================== 🧾 WDDPay Deposit Debug =====================");
//     console.log("🟢 API Endpoint:", `${GATEWAY_BASE}/api/createPayOrder`);
//     console.log("🟢 SIGN STRING:", signStr);
//     console.log("🟢 SIGNATURE:", hash);
//     console.log("🟢 Final Payload:", payload);
//     console.log("==================================================================\n");

//     const formBody = qs.stringify(payload);
//     const gatewayRes = await axios.post(`${GATEWAY_BASE}/api/createPayOrder`, formBody, {
//       headers: { "Content-Type": "application/x-www-form-urlencoded" },
//     });

//     console.log(" [WDDPay Response] =", gatewayRes.data);

//     await connection.query(
//       `UPDATE payment_transactions SET gateway_response=? WHERE transaction_id=?`,
//       [JSON.stringify(gatewayRes.data), transaction_id]
//     );

//     await connection.commit();

//     if (gatewayRes.data.code === 10000) {
//       res.json({
//         success: true,
//         transaction_id,
//         payUrl: gatewayRes.data.data.payUrl,
//         message: "Deposit created successfully.",
//       });
//     } else {
//       res.json({
//         success: false,
//         transaction_id,
//         gateway_response: gatewayRes.data,
//         message: gatewayRes.data.message || "Deposit failed",
//       });
//     }
//   } catch (err) {
//     if (connection) await connection.rollback();
//     console.error(" Deposit Error:", err.message);
//     res.status(500).json({ success: false, message: err.message });
//   } finally {
//     if (connection) connection.release();
//   }
// });

// ======================================================
//  ADMIN-ONLY MANUAL PAYOUT TRIGGER
// ======================================================
// ====================== ADMIN MANUAL PAYOUT (FINAL INDIA VERIFIED) ======================
router.post("/upi/admin/withdraw", authenticateToken, async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { transaction_id, account_name, upi_id, amount } = req.body;

    if (!transaction_id)
      return res.status(400).json({ success: false, message: "Transaction ID required" });
    if (!upi_id || !upi_id.includes("@"))
      return res.status(400).json({ success: false, message: "Valid UPI ID required" });
    if (!amount || Number(amount) < 100)
      return res.status(400).json({ success: false, message: "Minimum withdrawal ₹100" });

    await connection.beginTransaction();

    // Check for existing transaction
    let [tx] = await connection.query(
      "SELECT id, player_id, amount, status FROM payment_transactions WHERE transaction_id = ? LIMIT 1",
      [transaction_id]
    );

    // Auto-sync from money_transactions if not found
    if (!tx.length) {
      [tx] = await connection.query(
        "SELECT user_id AS player_id, amount, status FROM money_transactions WHERE transaction_id = ? LIMIT 1",
        [transaction_id]
      );

      if (tx.length) {
        const t = tx[0];
        await connection.query(
          `INSERT INTO payment_transactions 
           (player_id, name, transaction_id, merch_id, transaction_type, amount, currency, status, created_at)
           VALUES (?, ?, ?, ?, 'PAYOUT', ?, 'INR', 'PROCESSING', NOW())`,
          [t.player_id || 0, account_name || "User", transaction_id, process.env.WDDPAY_MERCHANT_ID, t.amount]
        );
      }
    }

    // Fetch transaction again
    const [refetched] = await connection.query(
      "SELECT player_id, amount FROM payment_transactions WHERE transaction_id = ? LIMIT 1",
      [transaction_id]
    );
    if (!refetched.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }

    const txData = refetched[0];

    // Prepare WDDPay India Transfer payload
    const payload = {
      appId: process.env.WDDPAY_MERCHANT_ID,
      orderNumber: transaction_id,
      amount: parseFloat(amount).toFixed(2),
      bankName: "UPI",
      receiptAccountName: account_name || "User",
      cardNumber: upi_id,
      mobile: "9876543210",
      ifsc: "UPI0000000", //  required for UPI
      notifyCallback: `${process.env.BACKEND_URL}/api/upi/callback`,
    };

    // Generate signature
    const signString =
      Object.keys(payload)
        .sort()
        .map((k) => `${k}=${payload[k]}`)
        .join("&") + `&key=${process.env.WDDPAY_SECRET_KEY}`;
    const sign = crypto.createHash("md5").update(signString).digest("hex").toLowerCase();
    payload.sign = sign;

    console.log("Sending verified India payout to WDDPay:", payload);

    // Send payout request
    const { data: gatewayRes } = await axios.post(
      `${process.env.WDDPAY_BASE_URL}/api/createTransferOrder`,
      qs.stringify(payload),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    console.log(" WDDPay Response:", gatewayRes);

    await connection.query(
      `UPDATE payment_transactions 
       SET gateway_response = ?, status = 'PROCESSING' 
       WHERE transaction_id = ?`,
      [JSON.stringify(gatewayRes), transaction_id]
    );

    await connection.commit();
    res.json({
      success: true,
      withdraw_id: transaction_id,
      player_id: txData.player_id,
      upi_used: upi_id,
      gateway_response: gatewayRes,
      message: "Admin payout sent successfully to WDDPay",
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error(" Admin payout failed:", err.message);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) connection.release();
  }
});



// ==================== POST /callback ====================
// Handles async notifications from WDDPay (UPI Deposit & Withdraw)
router.post("/upi/callback", express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const payload = req.body || {};
    console.log("WDDPay Callback received:", payload);

    // =====================================================
    //  1. Verify signature
    // =====================================================
    const receivedSign = payload.sign;
    const copy = {};
    Object.keys(payload).forEach((k) => {
      if (k === "sign") return;
      const v = payload[k];
      if (v !== undefined && v !== null && String(v) !== "") copy[k] = String(v);
    });

    const signString =
      Object.keys(copy)
        .sort()
        .map((k) => `${k}=${copy[k]}`)
        .join("&") + `&key=${SECRET_KEY}`;

    const expectedSign = md5Lower(signString);

    if (expectedSign !== receivedSign) {
      console.warn(" Invalid callback signature!");
      console.log("Expected:", expectedSign);
      console.log("Received:", receivedSign);
      return res.status(400).send("invalid sign");
    }

    // =====================================================
    //  2. Extract basic fields
    // =====================================================
    const orderNumber = payload.orderNumber || payload.orderNo || payload.merchantOrderNo;
    const orderStatus = payload.orderStatus ?? payload.order_status ?? payload.status;
    const amount = parseFloat(payload.amount || 0);

    if (!orderNumber) {
      console.warn("Callback without orderNumber");
      return res.status(400).send("missing order");
    }

    // =====================================================
    //  3. Map WDDPay numeric status → local ENUM status
    // =====================================================
    // 1=pending, 2=processing, 3=success, 4=failure, 5=cancelled
    let dbStatus = "PENDING";
    const os = Number(orderStatus);
    if (os === 3) dbStatus = "SUCCESS";
    else if (os === 4 || os === 5) dbStatus = "FAILURE";
    else if (os === 2) dbStatus = "PROCESSING";
    else dbStatus = "PENDING";

    // =====================================================
    //  4. Fetch current transaction details
    // =====================================================
    const [rows] = await db.query(
      `SELECT player_id, amount, transaction_type, status FROM payment_transactions WHERE transaction_id = ? LIMIT 1`,
      [orderNumber]
    );

    if (!rows || rows.length === 0) {
      console.warn("Unknown transaction in callback:", orderNumber);
      return res.status(400).send("unknown order");
    }

    const tx = rows[0];
    const prevStatus = tx.status;
    const terminalStatuses = ["SUCCESS", "FAILURE"];

    // If already finalized and same status — ignore duplicate callback
    if (terminalStatuses.includes(prevStatus) && prevStatus === dbStatus) {
      console.log("Duplicate callback ignored for:", orderNumber);
      return res.send("success");
    }

    // =====================================================
    //  5. Update payment record with latest gateway response
    // =====================================================
    await db.query(
      `UPDATE payment_transactions SET status = ?, gateway_response = ? WHERE transaction_id = ?`,
      [dbStatus, JSON.stringify(payload), orderNumber]
    );

    // =====================================================
    //  6. Handle user wallet balance updates
    // =====================================================
    if (tx.transaction_type === "PAYOUT") {
      if (dbStatus === "FAILURE") {
        // Refund user since we already deducted at initiation
        await db.query(
          `UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?`,
          [parseFloat(tx.amount), tx.player_id]
        );

        await db.query(
          `UPDATE payment_transactions SET remark = CONCAT(IFNULL(remark,''), ' | refunded after payout failure') WHERE transaction_id = ?`,
          [orderNumber]
        );

        console.log(`💸 Refunded ₹${tx.amount} to user ${tx.player_id} due to payout failure.`);
      } else if (dbStatus === "SUCCESS") {
        // Payout success — do not touch wallet again (already deducted)
        await db.query(
          `UPDATE payment_transactions SET remark = CONCAT(IFNULL(remark,''), ' | payout success confirmed') WHERE transaction_id = ?`,
          [orderNumber]
        );
        console.log(` Payout success recorded for ${orderNumber}`);
      }
    } else if (tx.transaction_type === "ORDER") {
      if (dbStatus === "SUCCESS" && prevStatus !== "SUCCESS") {
        // Deposit success — add to wallet once
        await db.query(
          `UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?`,
          [amount, tx.player_id]
        );

        await db.query(
          `UPDATE payment_transactions SET remark = CONCAT(IFNULL(remark,''), ' | deposit credited') WHERE transaction_id = ?`,
          [orderNumber]
        );
        console.log(`Credited ₹${amount} to user ${tx.player_id} (deposit success).`);
      }
    }

    // =====================================================
    //  7. Finalize
    // =====================================================
    console.log(` Callback processed for ${orderNumber}: ${dbStatus}`);
    return res.send("success");
  } catch (err) {
    console.error(" Callback processing failed:", err);
    return res.status(500).send("fail");
  }
});

module.exports = router;