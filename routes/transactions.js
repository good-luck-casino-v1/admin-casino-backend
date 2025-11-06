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
    // let query = 'SELECT * FROM money_transactions';
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

  // ✅ Hide payment_method details for deposits only
  const sanitizedTx = { ...tx };
  if (tx.type === 'deposit') {
    delete sanitizedTx.payment_method;   // Remove field entirely
    delete sanitizedTx.gateway_name;     // Optional: if you have multiple fields
  }

  return { ...sanitizedTx, screenshot_url: screenshotUrl };
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
// ✅ Update transaction status + trigger payout when approved
router.put('/:id/status', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status || !['pending', 'completed', 'reject'].includes(status)) {
    return res.status(400).json({ message: 'Valid status (pending/completed/reject) is required' });
  }

  let connection;
  try {
    connection = await db.getConnection();

    // 🔍 Fetch transaction details
    const [existingTransaction] = await connection.query(
      'SELECT * FROM money_transactions WHERE id = ?',
      [id]
    );

    if (!existingTransaction.length) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    const tx = existingTransaction[0];
    const { user_id, amount, payment_method, transaction_id, type } = tx;

    // 🟡 Auto trigger payout for withdrawals when marked as completed
    if (status === 'completed' && type === 'withdrawal') {
      const gateway = (payment_method || '').toLowerCase();
      console.log(`🚀 Auto-payout triggered via ${gateway} for Transaction: ${transaction_id}`);

      // Prepare payout data to send to /admin-payout endpoint
      const payoutBody = {
        transaction_id,
        amount,
        userId: user_id,
        payment_method: payment_method,
        gateway: gateway,
        bank_code: tx.bank_code,
        ifsc_code: tx.ifsc_code,
        acc_no: tx.account_number || tx.acc_no,
        account_name: tx.account_name,
        upi_id: tx.upi_id
      };

      try {
        // Forward payout to your working /admin-payout API (local self-call)
        const payoutURL = `${process.env.BASE_URL}/api/transactions/admin-payout`;

        const payoutResponse = await axios.post(payoutURL, payoutBody, {
          headers: { Authorization: req.headers.authorization },
          timeout: 20000,
        });

        console.log('✅ Payout Auto Trigger Response:', payoutResponse.data);

        // Update status to processing since payout is triggered
        await connection.query(
          `UPDATE money_transactions 
           SET status='processing', remarks='Auto payout initiated', updated_at=NOW()
           WHERE id=?`,
          [id]
        );

        return res.json({
          success: true,
          message: 'Payout triggered successfully via ' + gateway.toUpperCase(),
          data: payoutResponse.data,
        });

      } catch (err) {
        console.error('💥 Auto payout trigger failed:', err.response?.data || err.message);
        return res.status(500).json({
          success: false,
          message: err.response?.data?.message || 'Auto payout trigger failed',
        });
      }
    }

    // 🔵 For deposits or reject/pending cases — normal status update
    await connection.query('UPDATE money_transactions SET status = ? WHERE id = ?', [status, id]);

    res.json({ success: true, message: `Transaction ${status} successfully.` });
  } catch (error) {
    console.error('💥 Error updating transaction status:', error);
    res.status(500).json({ message: 'Error updating transaction status' });
  } finally {
    if (connection) connection.release();
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

/* =====================================================
 * 🏦 TopPay India — RSA 原始私钥加密签名 (非 SHA256withRSA)
 * ===================================================== */
router.post("/admin-payout", authenticateToken, async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    // ✅ Corrected destructuring + amount conversion
    const { gateway, payment_method, userId, transaction_id, amount, bank_code, ifsc_code, acc_no, account_name } = req.body;
    const amt = parseFloat(amount);

    // 🧠 Auto-detect gateway
    const activeGateway = (gateway || payment_method || "").toLowerCase();

    if (!["toppay"].includes(activeGateway)) {
      return res.status(400).json({ success: false, message: "Unsupported gateway" });
    }

    // ✅ Validate amount
    if (isNaN(amt) || amt <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount value" });
    }

  
        // ✅ TopPay 密钥（PKCS8 私钥格式）
        const privateKey = `
-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCWW6LCzhvfkEwU
s1iYkfTw4hKdVFy4+cJel1T4fqdTCMiKj/PvpQKxJB3cklH+uC6UEkMLiLojMARP
Ti/6t3n/OFgGGVe1w1U1Ejx8Lx/7z2moYW9aOMBj4cNBaa6mJIMKVByZMswW3rT2
Z4S7aV4U3z+JOCLd9gA6s6cYHQJcJMB8z80Qjy5eKjcoleaPVHqg5zg38SEQOjj8
j0PbNyapaWFlLkZgNM2IFXgnUlLHyEW35aegiliZFr3DodX9pHOoL6LGpIlHZye3
xSIjh4aWB1IXYVa6t8k0PFgl4Kqf0F6FZJRu5uwBRmvz1Q5jtRyXXMw/aTWnOTBR
tyexq2B5AgMBAAECggEAZNPWdaQZdPYizs7l3ooiI1a2/OIRu8lg2mXJCUqFkl0V
fjXCczXIdFmv3LYSXinMsmb8psNtbyNIAJaB/jMDkG6MOKrN8ommngw4m15OqGIS
jGOqdGoSOeivMzJXd/qMFWUKOIGj8sItv/7zN2oVORHsXWxTlVzeEn9e0gDCEF9U
Zzrt6zKnhwOxmfb1jR4dFtXfTjOa3GASXiJ0zP3x5W07Paf6eo3J9s7OXbkZZWvJ
0ymppyuy29IFPDUhUKEQK0Y/W9xu1R9AdFEJQ4az2OLYbASfnrJ/3F6Pfr5qVuR2
neQqb2K7Tf/Wt7m1Ry9Z+5HNfslwQoXy3IMge175wQKBgQD/+G7t8ggUtvxUkhBk
kudSkCdB04Yktc2spPLUp0WVISOomaxypClZE5ewTBJ9fdooEwGZ2nKHuVt5oAfm
H2zZTMrYs6AMq4IoP1TF92DVJ09sNVRGO+K5Nx9yBnzZ7gtqms9e4z2VorTrTnJa
s1HxHgFQ2qqeq7tkyEftfffvbQKBgQCWYBSaZPYKSdfJe+LUAKVMGvwWhdwyD3kp
NcY3zE+1QVn3RPnYkPYEASaJpEOLBCOSLMH19MFuFWkClRs+nNiaZtHvjVhaHZJX
vABA1oXa4tTIXkI25fJn6D67T/uuFf2iMEfxjtjIyvFhAb7NUGjxBR0T4+xtTGZ8
msIft+LxvQKBgQDyPuSEzkT1jcO6Kc3X0OuZSJHOi2ftgB1ZIXYq6O9CVm2P13fL
uy7ifVdWYngxSZTXzjz6pTE036gBsAEpuV3jPPjQIxb6RqpUerM484gx0hUpPEM4
gN5uGQvqdtdbzBwD1OUiUP7siWKdOs2gpwqKnbHzGi7VIYOkuqLP0SJ+9QKBgQCE
mh8w8ryf3/PgIVWpOxSIIveO6OV+Y3SlKV0skQbsv78UtAdZuKKob1dLYsWIzdKM
MNmtCPKVH14lP9Txhp/er7KKemqhtJf6s7bJdiI9HW8jbTMYc/cpN3wx8trt7Uhm
gArA8QUrMwJdV4uoQzL27lpw0rkGvKtXT6TFEYOXRQKBgCWdYTeJe08xFzfsYyeO
qFKQKs/05oS17mRQTxxbFqqcGr11vp5c/dkoWE28eBe7HN2XsRAi1mUN9FQfJvt4
H6vZ7xYrnDnbXKtOCE/UMFkbROWOIn/5sBbNsCJzJdRCurrqvF5z8sTs8RQ20np7
XN6EbGBGcXvslVKo8e2DhXYk
-----END PRIVATE KEY-----
`;

        /* ----------------- 🔐 工具函数 ----------------- */
        function buildSignString(params) {
            return Object.keys(params)
                .filter((key) => key !== "sign" && params[key] !== undefined && params[key] !== "")
                .sort()
                .map((key) => `${key}=${params[key]}`)
                .join("&");
        }

        function rsaPrivateEncrypt(data, privateKeyPem) {
            const buffer = Buffer.from(data, "utf8");
            const maxBlock = 245;
            const chunks = [];
            for (let offset = 0; offset < buffer.length; offset += maxBlock) {
                const chunk = buffer.slice(offset, offset + maxBlock);
                const encrypted = crypto.privateEncrypt(
                    {
                        key: privateKeyPem,
                        padding: crypto.constants.RSA_PKCS1_PADDING,
                    },
                    chunk
                );
                chunks.push(encrypted);
            }
            return Buffer.concat(chunks).toString("base64");
        }

       /* ----------------- 📦 构造参数 ----------------- */
// ✅ Use real current Unix timestamp (integer seconds)
const currentTimestamp = Math.floor(Date.now() / 1000);

// ✅ Validate and format amount (TopPay does NOT support decimals)
const cleanAmt = Math.floor(amt); // Convert 100.50 -> 100

if (isNaN(cleanAmt) || cleanAmt < 100) {
  return res.status(400).json({
    success: false,
    message: "Invalid amount (TopPay does not support decimals, min ₹100)",
  });
}

const params = {
  merchantCode: process.env.TOPPAY_MERCHANT_CODE,
  orderNum: transaction_id,
  bankCode: (ifsc_code || bank_code || "").trim(),
  bankAccount: (acc_no || "").trim(),
  bankUsername: (account_name || "User").trim(),
  orderAmount: cleanAmt, // ✅ integer only (no decimals)
  callback: process.env.TOPPAY_PAYOUT_NOTIFY_URL,
  timestamp: currentTimestamp, // ✅ Unix timestamp (seconds)
};

const signString = buildSignString(params);
params.sign = rsaPrivateEncrypt(signString, privateKey);

console.log("🔐 TopPay Sign String:", signString);
console.log("🖋️ Signature (RSA Encrypted):", params.sign);

        /* ----------------- 🚀 发送请求 ----------------- */
        const apiURL = `${process.env.TOPPAY_BASE_URL}/cash/newOrder`;
        const topResp = await axios.post(apiURL, params, {
            headers: { "Content-Type": "application/json" },
            timeout: 15000,
        });

        console.log("📦 TopPay Response:", topResp.data);

        if (topResp.data.code !== 0) {
            throw new Error(topResp.data.message || "TopPay payout failed.");
        }

        // ✅ 更新数据库状态
        await connection.query(
            "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?",
            [amt, userId]
        );

        await connection.query(
            `UPDATE money_transactions 
       SET status='processing', remarks='Payout sent to TopPay', payout_response=?, updated_at=NOW()
       WHERE transaction_id=?`,
            [JSON.stringify(topResp.data), transaction_id]
        );

        return res.json({
            success: true,
            message: "Payout sent to TopPay successfully.",
            data: topResp.data,
        });
    } catch (err) {
        console.error("💥 Admin payout error:", err.message);
        return res.status(500).json({
            success: false,
            message: err.message || "Payout failed",
        });
    } finally {
        if (connection) connection.release();
    }
});



router.post("/admin-payout", authenticateToken, async (req, res) => {
  const {
    transaction_id,
    amount,
    upi_id,
    account_name,
    acc_no,
    bank_code,
    ifsc_code,
    payment_method,
  } = req.body;

  const amt = parseFloat(amount);
  let connection;

  try {
    if (!transaction_id)
      return res
        .status(400)
        .json({ success: false, message: "Transaction ID required" });

    if (isNaN(amt) || amt < 100)
      return res
        .status(400)
        .json({ success: false, message: "Minimum payout ₹100" });

    connection = await db.getConnection();

    // 🔍 Fetch transaction
    const [tx] = await connection.query(
      "SELECT * FROM money_transactions WHERE transaction_id=? LIMIT 1",
      [transaction_id]
    );

    if (!tx.length)
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });

    const txn = tx[0];
    const userId = txn.user_id;

    console.log(`🟢 Initiating payout for CLOUDPAY | Transaction: ${transaction_id}`);

    /* ===================== 🌩️ CLOUDPAY Payout ===================== */
    const payoutBody = {
      merch_id: process.env.CLOUDPAY_MERCHANT_ID,
      amount: parseInt(amt, 10), // ⚠️ must be integer
      account_name: account_name || "User",
      payment_method: upi_id ? "UPI" : "BANK", // UPI or BANK
      acc_no: upi_id ? upi_id.trim() : acc_no,
      account_type: "PERSONAL_BANK", // Always required
    };

    const canonical = `merch_id=${payoutBody.merch_id}|amount=${payoutBody.amount}|acc_no=${payoutBody.acc_no}|account_name=${payoutBody.account_name}|payment_method=${payoutBody.payment_method.toUpperCase()}|account_type=${payoutBody.account_type}`;

    const sign = crypto
      .createHmac("sha256", process.env.CLOUDPAY_API_TOKEN)
      .update(canonical)
      .digest("hex");

    console.log("🟢 Sending Payout to CloudPay:", payoutBody);
    console.log("🔐 Canonical:", canonical);
    console.log("🔏 Signature:", sign);

    try {
      const response = await axios.post(
        `${process.env.CLOUDPAY_BASE_URL || "https://api.cloudpay.space"}/payout/php`,
        payoutBody,
        {
          headers: {
            "Content-Type": "application/json",
            "X-Verify": sign,
          },
          timeout: 20000,
        }
      );

      console.log("📦 CloudPay Payout Response:", response.data);

      if (!response.data.status) {
        await connection.query(
          "UPDATE money_transactions SET status='failed', remarks=?, updated_at=NOW() WHERE transaction_id=?",
          [response.data.message || "CloudPay payout failed", transaction_id]
        );
        throw new Error(response.data.message || "CloudPay payout failed");
      }

      // ✅ Deduct wallet & mark transaction as processing
      await connection.query(
        "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?",
        [amt, userId]
      );

      await connection.query(
        `UPDATE money_transactions 
         SET status='processing', remarks='Payout sent to CloudPay', payout_response=?, updated_at=NOW()
         WHERE transaction_id=?`,
        [JSON.stringify(response.data), transaction_id]
      );

      return res.json({
        success: true,
        message: "Payout sent to CloudPay successfully.",
        data: response.data,
      });
    } catch (err) {
      console.error("💥 CloudPay Payout Error:", err.response?.data || err.message);
      return res.status(500).json({
        success: false,
        message: err.response?.data?.message || "CloudPay request failed",
        details: err.response?.data,
      });
    }
  } catch (err) {
    console.error("💥 Admin payout error:", err.message);
    return res.status(500).json({
      success: false,
      message: err.message || "Payout failed",
    });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
