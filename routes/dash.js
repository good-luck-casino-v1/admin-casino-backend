const express = require('express');
const router = express.Router();
const db = require('../config/db'); // Assuming you have a database connection module

// Get dashboard statistics
router.get('/', async (req, res) => {
  try {
    // Get total users count
    const [usersResult] = await db.query('SELECT COUNT(*) as count FROM users');
    const totalUsers = usersResult[0].count;

    // Get active users count
    const [activeUsersResult] = await db.query("SELECT COUNT(*) as count FROM users WHERE status='Active'");
    const activeUsers = activeUsersResult[0].count;

    // Get suspended users count
    const [suspendedUsersResult] = await db.query("SELECT COUNT(*) as count FROM users WHERE status='Suspended'");
    const suspendedUsers = suspendedUsersResult[0].count;

    // Get total agents count
    const [agentsResult] = await db.query('SELECT COUNT(*) as count FROM agentlogin');
    const totalAgents = agentsResult[0].count;
    
    // Get total admin count
    const [adminResult] = await db.query("SELECT COUNT(*) as count FROM admin WHERE admin_type='admin'");
    const totalAdmin = adminResult[0].count;
    
    // Get total super admin count
    const [superAdminResult] = await db.query("SELECT COUNT(*) as count FROM admin WHERE admin_type='super admin'");
    const totalSuperAdmin = superAdminResult[0].count;
    
    // Get total games count
    const [gamesResult] = await db.query('SELECT COUNT(*) as count FROM games');
    const totalGames = gamesResult[0].count;
    
    // Get active games count
    const [activeGamesResult] = await db.query("SELECT COUNT(*) as count FROM games WHERE status='Active'");
    const activeGames = activeGamesResult[0].count;
    
    // Get inactive games count
    const [inactiveGamesResult] = await db.query("SELECT COUNT(*) as count FROM games WHERE status='inactive'");
    const inactiveGames = inactiveGamesResult[0].count;
    
    // Get total player deposit (sum of wallet_balance from users table)
    const [playerDepositResult] = await db.query('SELECT SUM(wallet_balance) as total FROM users');
    const totalPlayerDeposit = playerDepositResult[0].total || 0;
    
    // Get total agent deposit (sum of balance from agentlogin table)
    const [agentDepositResult] = await db.query('SELECT SUM(balance) as total FROM agentlogin');
    const totalAgentDeposit = agentDepositResult[0].total || 0;
    
    // Get total open tickets
    const [ticketsCountResult] = await db.query("SELECT COUNT(*) as count FROM tickets WHERE status='open'");
    const totalOpenTickets = ticketsCountResult[0].count;

    // Get total deposits
    const [depositsResult] = await db.query(
      "SELECT SUM(amount) as total FROM money_transactions WHERE type='deposit' AND status='completed'"
    );
    const totalDeposits = depositsResult[0].total || 0;

    // Get total withdrawals
    const [withdrawalsResult] = await db.query(
      "SELECT SUM(amount) as total FROM money_transactions WHERE type='withdrawal' AND status='completed'"
    );
    const totalWithdrawals = withdrawalsResult[0].total || 0;

    // Get recent tickets with user names
    const [ticketsResult] = await db.query(
      `SELECT t.*, u.name as user_name 
       FROM tickets t 
       JOIN users u ON t.user_id = u.id 
       ORDER BY t.created_at DESC LIMIT 5`
    );

    // Get recent transactions with user names
    const [transactionsResult] = await db.query(
      `SELECT mt.*, u.name as user_name 
       FROM money_transactions mt 
       JOIN users u ON mt.user_id = u.id 
       ORDER BY mt.created_at DESC LIMIT 5`
    );

    res.json({
      totalUsers,
      activeUsers,
      suspendedUsers,
      totalAgents,
      totalAdmin,
      totalSuperAdmin,
      totalGames,
      activeGames,
      inactiveGames,
      totalPlayerDeposit,
      totalAgentDeposit,
      totalOpenTickets,
      totalDeposits,
      totalWithdrawals,
      recentTickets: ticketsResult,
      recentTransactions: transactionsResult
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get admin data (admin_type='admin')
router.get('/admins', async (req, res) => {
  try {
    const [adminsResult] = await db.query("SELECT id, name, email, mobile, created_at FROM admin WHERE admin_type='admin'");
    res.json(adminsResult);
  } catch (error) {
    console.error('Error fetching admin data:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;