const express = require('express');
const path = require('path');
const cors = require('cors');
const adminAuthRoutes = require('./routes/adminAuth');
const adminRoutes = require('./routes/admin');
const ticketsRoutes = require('./routes/tickets');
const pool = require('./config/db');
const bcrypt = require('bcryptjs');
const addAdminRoutes = require('./routes/addadmin');
const userdashRouter = require('./routes/userdash');
const agentRoutes = require('./routes/agentdetail');
const gameRoutes = require('./routes/gameman');
const transactionRoutes = require('./routes/transactions');
const securityRoutes = require('./routes/security');
const dashboardRoutes = require('./routes/dash');
const app = express();
const PORT = process.env.PORT || 5000;
app.use((req, res, next) => {
  req.db = pool;
  next();
});
app.use('/images', express.static(path.join(__dirname, 'public/images')));
// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const authenticateAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }
    
    const decoded = jwt.verify(token, 'goodluckcasino_jwt_secret');
    
    const [admin] = await req.db.query(
      'SELECT id, email, admin_type, name, mobile, photo FROM admin WHERE id = ?',
      [decoded.id]
    );
    
    if (!admin) {
      return res.status(401).json({ message: 'Invalid token' });
    }
    
    req.admin = admin;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ message: 'Authentication failed' });
  }
};
 

// API Routes
app.use('/api/admin', adminAuthRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', authenticateAdmin);
app.use('/api/adminadd', addAdminRoutes);
app.use('/api/tickets', ticketsRoutes);
app.use('/api/users', userdashRouter);
app.use('/api', agentRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/dash', dashboardRoutes);
// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, '../frontend/public/images')));

// Handle client-side routing
app.use((req, res, next) => {
  // Skip for API routes
  if (req.path.startsWith('/api/')) {
    return next();
  }
  
  // Skip for static files
  if (req.path.startsWith('/images/')) {
    return next();
  }
  
  // For all other routes, serve the React app
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize database and create admin accounts
async function initializeDatabase() {
  try {
    // Create admin table if it doesn't exist
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS admin (
        id int(11) NOT NULL AUTO_INCREMENT,
        email varchar(255) NOT NULL UNIQUE,
        password varchar(255) NOT NULL,
        admin_type enum('super admin','admin') NOT NULL,
        name varchar(255) NOT NULL,
        mobile varchar(20) DEFAULT NULL,
        photo varchar(255) DEFAULT NULL,
        created_at timestamp NOT NULL DEFAULT current_timestamp(),
        PRIMARY KEY (id)
      )
    `);
    
    // Check if super admin exists
    const [superAdmins] = await pool.execute(
      'SELECT * FROM admin WHERE admin_type = "super admin"'
    );
    
    if (superAdmins.length === 0) {
      // Create super admin
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.execute(`
        INSERT INTO admin (email, password, admin_type, name, mobile)
        VALUES (?, ?, 'super admin', 'Super Admin', '1234567890')
      `, ['superadmin@goodluckcasino.com', hashedPassword]);
      console.log('Super admin created');
    }
    
    // Check if regular admin exists
    const [admins] = await pool.execute(
      'SELECT * FROM admin WHERE admin_type = "admin"'
    );
    
    if (admins.length === 0) {
      // Create regular admin
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.execute(`
        INSERT INTO admin (email, password, admin_type, name, mobile)
        VALUES (?, ?, 'admin', 'Admin User', '9876543210')
      `, ['admin@goodluckcasino.com', hashedPassword]);
      console.log('Admin user created');
    }
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('client/build'));
  
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'client', 'build', 'index.html'));
  });
}


// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  initializeDatabase();
  console.log(`Security API available at http://localhost:${PORT}/api/security`);
});