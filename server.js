const express = require('express');
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const adminAuthRoutes = require('./routes/adminAuth');
const adminRoutes = require('./routes/admin');
const ticketsRoutes = require('./routes/tickets');
const db = require('./config/db'); // Changed from pool to db to match your config
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

// Database middleware - fixed to use 'db' instead of 'pool'
app.use((req, res, next) => {
  req.db = db;
  next();
});

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    callback(null, true); // Allow all origins for now
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With', 
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control',
    'X-CSRF-Token'
  ],
  exposedHeaders: ['Authorization'],
  maxAge: 86400
};

app.use(cors(corsOptions));

// Additional CORS headers
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.header('Access-Control-Allow-Origin', origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path} - Origin: ${req.headers.origin || 'none'}`);
  next();
});

// Authentication middleware
const authenticateAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'goodluckcasino_jwt_secret');
    
    const [admin] = await req.db.execute(
      'SELECT id, email, admin_type, name, mobile, photo FROM admin WHERE id = ?',
      [decoded.id]
    );
    
    if (admin.length === 0) {
      return res.status(401).json({ message: 'Invalid token' });
    }
    
    req.admin = admin[0];
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ message: 'Authentication failed' });
  }
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'admin-casino-backend'
  });
});

// CORS test endpoint
app.get('/cors-test', (req, res) => {
  res.json({
    message: 'CORS test successful',
    origin: req.headers.origin || 'no origin',
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path
  });
});

// Static files
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// API Routes - Handle both original and rewritten paths
console.log('Setting up API routes...');

// Original API paths
app.use('/api/admin', adminAuthRoutes);
app.use('/api/admin', authenticateAdmin, adminRoutes);
app.use('/api/adminadd', addAdminRoutes);
app.use('/api/tickets', ticketsRoutes);
app.use('/api/users', userdashRouter);
app.use('/api', agentRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/dash', dashboardRoutes);

// Rewritten paths (ingress rewrites /api/admin/* to /admin/*)
app.use('/admin', adminAuthRoutes);
app.use('/admin', authenticateAdmin, adminRoutes);
app.use('/adminadd', addAdminRoutes);
app.use('/tickets', ticketsRoutes);
app.use('/users', userdashRouter);
app.use('/games', gameRoutes);
app.use('/transactions', transactionRoutes);
app.use('/security', securityRoutes);
app.use('/dash', dashboardRoutes);

console.log('API routes configured');

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Production static serving
if (process.env.NODE_ENV === 'production') {
  const clientBuildPath = path.join(__dirname, 'client', 'build');
  const fs = require('fs');
  
  if (fs.existsSync(clientBuildPath)) {
    app.use(express.static(clientBuildPath));
  }
}

// Initialize database
async function initializeDatabase() {
  try {
    console.log('Initializing database...');
    
    await db.execute(`
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
    
    const [superAdmins] = await db.execute(
      'SELECT * FROM admin WHERE admin_type = "super admin" LIMIT 1'
    );
    
    if (superAdmins.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await db.execute(`
        INSERT INTO admin (email, password, admin_type, name, mobile)
        VALUES (?, ?, 'super admin', 'Super Admin', '1234567890')
      `, ['superadmin@goodluckcasino.com', hashedPassword]);
      console.log('Super admin created: superadmin@goodluckcasino.com / admin123');
    } else {
      console.log('Super admin exists');
    }
    
    const [admins] = await db.execute(
      'SELECT * FROM admin WHERE admin_type = "admin" LIMIT 1'
    );
    
    if (admins.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await db.execute(`
        INSERT INTO admin (email, password, admin_type, name, mobile)
        VALUES (?, ?, 'admin', 'Admin User', '9876543210')
      `, ['admin@goodluckcasino.com', hashedPassword]);
      console.log('Admin user created: admin@goodluckcasino.com / admin123');
    } else {
      console.log('Admin user exists');
    }
    
    console.log('Database initialization completed');
  } catch (err) {
    console.error('Database error:', err);
    throw err;
  }
}

// Catch-all for unknown API endpoints
app.use('/api/*', (req, res) => {
  res.status(404).json({ 
    error: 'API endpoint not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
    note: 'Check available endpoints'
  });
});

// Fallback handler for non-API routes - MUST BE LAST
app.use('*', (req, res) => {
  // Only handle non-API routes here
  const publicIndexPath = path.join(__dirname, 'public', 'index.html');
  const clientIndexPath = path.join(__dirname, 'client', 'build', 'index.html');
  const fs = require('fs');
  
  if (fs.existsSync(publicIndexPath)) {
    res.sendFile(publicIndexPath);
  } else if (fs.existsSync(clientIndexPath)) {
    res.sendFile(clientIndexPath);
  } else {
    res.status(200).json({
      service: 'Admin Casino Backend API',
      message: 'Backend running. Frontend at admin.goodluck24bet.com',
      timestamp: new Date().toISOString(),
      path: req.path,
      note: 'API and frontend are separate deployments'
    });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message,
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health: /health`);
  console.log(`Login: /admin/login (rewritten from /api/admin/login)`);
  
  try {
    await initializeDatabase();
    console.log('Startup completed successfully');
  } catch (error) {
    console.error('Startup failed:', error);
    process.exit(1);
  }
});
