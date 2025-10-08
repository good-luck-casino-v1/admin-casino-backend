const jwt = require('jsonwebtoken');
const db= require('../config/db');

const authenticateToken = (req, res, next) => {
  console.log("Authorization header:", req.headers.authorization);

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log('No token provided');
    return res.status(401).json({ message: 'Unauthorized: No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.log('Invalid token');
      return res.status(403).json({ message: 'Unauthorized: Invalid token' });
    }

    req.user = user;
    next(); //  Proceed to next middleware or route
  });
};

module.exports = { authenticateToken }; //  must be exported like this
