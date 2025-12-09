const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const db = require("../config/db"); // Database connection (promise pool)
const crypto = require("crypto"); // Node.js built-in crypto module

// Generate random referral code using crypto
function generateReferralCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

// GET /api/users - Get all users with filtering and search
router.get("/", async (req, res) => {
  try {
    const { role, status, search } = req.query; // Removed referred_by

    let query = "SELECT * FROM users WHERE 1=1";
    const params = [];

    if (role) {
      query += " AND role = ?";
      params.push(role);
    }

    if (status) {
      query += " AND status = ?";
      params.push(status);
    }

    if (search) {
      query += " AND (name LIKE ? OR id LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    const [results] = await db.query(query, params);
    res.status(200).json(results);
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/users/count - Get total user count
router.get("/count", async (req, res) => {
  try {
    const [results] = await db.query("SELECT COUNT(*) as count FROM users");
    res.status(200).json({ count: results[0].count });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/users - Create a new user
router.post("/", async (req, res) => {
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
      "admin", // referred_by is set to admin
    ]);

    res.status(201).json({
      message: "User created successfully",
      userId: results.insertId,
      userName: name,
    });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// PUT /api/users/:id/status - Update user status
router.put("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate status value
    if (status !== "Active" && status !== "Suspended") {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const [results] = await db.query(
      "UPDATE users SET status = ? WHERE id = ?",
      [status, id]
    );

    if (results.affectedRows === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ message: `User status updated to ${status}` });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/users/:id/details - Get user details
router.get("/:id/details", async (req, res) => {
  try {
    const { id } = req.params;

    const [results] = await db.query("SELECT * FROM users WHERE id = ?", [id]);

    if (results.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(results[0]);
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/users/:id/transactions/completed - Get completed transactions for a user
router.get("/:id/transactions/completed", async (req, res) => {
  try {
    const { id } = req.params;

    const [results] = await db.query(
      'SELECT type, amount, created_at FROM money_transactions WHERE user_id = ? AND status = "completed"',
      [id]
    );

    res.status(200).json(results);
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/users/:id/transactions/pending - Get pending transactions for a user
router.get("/:id/transactions/pending", async (req, res) => {
  try {
    const { id } = req.params;

    const [results] = await db.query(
      'SELECT id, type, amount, payment_method, utr, screenshot FROM money_transactions WHERE user_id = ? AND status = "pending"',
      [id]
    );

    res.status(200).json(results);
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/users/:id/tickets - Get tickets for a user
router.get("/:id/tickets", async (req, res) => {
  try {
    const { id } = req.params;

    const [results] = await db.query(
      "SELECT id, user_id, subject, message, email, evidence, status FROM tickets WHERE user_id = ?",
      [id]
    );

    res.status(200).json(results);
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// PUT /api/tickets/:id/status - Update ticket status
router.put("/tickets/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate status value
    if (!["closed", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const [results] = await db.query(
      "UPDATE tickets SET status = ? WHERE id = ?",
      [status, id]
    );

    if (results.affectedRows === 0) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    res.status(200).json({ message: `Ticket status updated to ${status}` });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// router.put("/transactions/:id/status", async (req, res) => {
//   const { id } = req.params;
//   const { status } = req.body;

//   if (!["completed", "rejected"].includes(status)) {
//     return res.status(400).json({ success: false, message: "Invalid status value" });
//   }

//   let connection;
//   try {
//     connection = await db.getConnection();

//     const [txResults] = await connection.query(
//       "SELECT * FROM money_transactions WHERE id = ?",
//       [id]
//     );
//     if (txResults.length === 0) {
//       return res.status(404).json({ success: false, message: "Transaction not found" });
//     }

//     const tx = txResults[0];
//     const amount = parseFloat(tx.amount);
//     const type = tx.type.toLowerCase();
//     const method = (tx.payment_method || "").toLowerCase();
//     const userId = tx.user_id;

//     await connection.beginTransaction();

//     // ❌ Reject
//     if (status === "rejected") {
//       await connection.query(
//         "UPDATE money_transactions SET status='rejected', updated_at=NOW() WHERE id=?",
//         [id]
//       );
//       await connection.commit();
//       return res.json({
//         success: true,
//         message: "Transaction rejected successfully"
//       });
//     }

//     // ✅ BANK DEPOSIT
//     if (type === "deposit" && method === "bank") {
//       await connection.query(
//         "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?",
//         [amount, userId]
//       );

//       await connection.query(
//         "UPDATE money_transactions SET status='completed', remarks='Bank deposit credited', updated_at=NOW() WHERE id=?",
//         [id]
//       );

//       await connection.commit();
//       return res.json({
//         success: true,
//         message: `₹${amount} credited to wallet (Bank Deposit)`
//       });
//     }

//     // ✅ BANK WITHDRAW
//     if (type === "withdraw" && method === "bank") {
//       await connection.query(
//         "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?",
//         [amount, userId]
//       );

//       await connection.query(
//         "UPDATE money_transactions SET status='completed', remarks='Bank withdraw debited', updated_at=NOW() WHERE id=?",
//         [id]
//       );

//       await connection.commit();
//       return res.json({
//         success: true,
//         message: `₹${amount} withdrawn from wallet (Bank Withdraw)`
//       });
//     }

//     // ✅ GATEWAY WITHDRAW (TOPPAY / CLOUDPAY)
//     if (type === "withdraw" && (method === "toppay" || method === "cloudpay")) {

//       // Deduct balance first
//       await connection.query(
//         "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id=?",
//         [amount, userId]
//       );

//       await connection.query(
//         "UPDATE money_transactions SET status='processing', updated_at=NOW() WHERE id=?",
//         [id]
//       );

//       await connection.commit();

//       const payoutURL =
//         method === "toppay"
//           ? `${process.env.BASE_URL}/api/transactions/admin-payout-toppay`
//           : `${process.env.BASE_URL}/api/transactions/admin-payout`;

//       const payoutData = {
//         transaction_id: tx.transaction_id,
//         amount,
//         userId,
//         payment_method: method,
//         bank_code: tx.bank_code,
//         ifsc_code: tx.ifsc_code,
//         acc_no: tx.account_number,
//         account_name: tx.account_name,
//         upi_id: tx.upi_id,
//       };

//       try {
//         const payoutRes = await axios.post(
//           payoutURL,
//           payoutData,
//           { headers: { Authorization: req.headers.authorization } }
//         );

//         await db.query(
//           "UPDATE money_transactions SET status='completed', remarks='Gateway payout successful', payout_response=?, updated_at=NOW() WHERE id=?",
//           [JSON.stringify(payoutRes.data), id]
//         );

//         return res.json({
//           success: true,
//           message: `Payout sent successfully using ${method.toUpperCase()}`
//         });

//       } catch (err) {

//         // REFUND ON FAILURE
//         await db.query(
//           "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id=?",
//           [amount, userId]
//         );

//         await db.query(
//           "UPDATE money_transactions SET status='failed', remarks='Gateway failed — refunded', updated_at=NOW() WHERE id=?",
//           [id]
//         );

//         return res.json({
//           success: false,
//           message: `Payout failed. ₹${amount} refunded back to wallet`
//         });
//       }
//     }

//     return res.status(400).json({
//       success: false,
//       message: "This transaction type is not allowed"
//     });

//   } catch (error) {
//     if (connection) await connection.rollback();
//     return res.status(500).json({ success: false, message: "Server error" });

//   } finally {
//     if (connection) connection.release();
//   }
// });


// PUT /api/users/:id/wallet - Update wallet balance and record transaction
router.put("/:id/wallet", async (req, res) => {
  try {
    const { id } = req.params;
    const { type, amount } = req.body;

    // Convert amount safely
    const amountNum = Number(amount);

    // Validate amount
    if (!amountNum || isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    // Validate type
    if (!["deposit", "withdraw"].includes(type)) {
      return res.status(400).json({ message: "Invalid transaction type" });
    }

    // Get user
    const [userResults] = await db.query("SELECT * FROM users WHERE id = ?", [
      id,
    ]);
    if (userResults.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = userResults[0];
    const currentBalance = Number(user.wallet_balance);

    let newBalance;

    if (type === "deposit") {
      newBalance = currentBalance + amountNum;
    } else if (type === "withdraw") {
      newBalance = currentBalance - amountNum;

      if (newBalance < 0) {
        return res.status(400).json({ message: "Insufficient balance" });
      }
    }

    // Transaction begin
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Update user wallet
      await connection.query(
        "UPDATE users SET wallet_balance = ? WHERE id = ?",
        [newBalance, id]
      );

      // Insert transaction history
      await connection.query(
        "INSERT INTO money_transactions (user_id, type, amount, payment_method, status) VALUES (?, ?, ?, ?, ?)",
        [id, type, amountNum, "cash", "completed"]
      );

      await connection.commit();

      res.status(200).json({
        success: true,
        message: `${type} successful`,
        newBalance,
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
