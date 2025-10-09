// middleware/adminAuth.js
const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('No token provided');
      return res.status(401).json({ message: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    //  Attach to both for backward compatibility
    req.user = decoded;
    req.admin = decoded;

    console.log(' Token verified for admin:', decoded);

    next();
  } catch (error) {
    console.error(' Token verification failed:', error.message);
    return res.status(403).json({ message: 'Unauthorized: Invalid or expired token' });
  }
};

module.exports = { authenticateToken };
