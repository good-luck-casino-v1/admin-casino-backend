// routes/security.js
const express = require('express');
const router = express.Router();

// In-memory storage for security settings (in a real app, this would be a database)
let securitySettings = {
  accessControls: {
    mfaEnabled: true,
    passwordPolicy: {
      minLength: 12,
      requireSpecialChars: true,
      requireNumbers: true,
      requireUppercase: true,
      passwordExpiryDays: 90,
      preventReuse: 5
    },
    rbacEnabled: true,
    ipRestriction: {
      enabled: true,
      allowedIPs: ['192.168.1.1', '10.0.0.1'],
      vpnRequired: true
    },
    separateAdminDomain: true,
    sessionTimeout: 30
  },
  monitoring: {
    activityLogging: true,
    suspiciousActivityAlerts: true,
    securityAudits: {
      enabled: true,
      frequency: 'quarterly',
      lastAuditDate: '2023-06-15'
    },
    failedLoginThreshold: 5,
    lockoutDuration: 15
  },
  dataProtection: {
    encryptionInTransit: true,
    encryptionAtRest: true,
    credentialHashing: true,
    kycEnabled: true,
    dataRetention: 365,
    backupEnabled: true,
    backupFrequency: 'daily'
  },
  operational: {
    incidentResponsePlan: true,
    staffTraining: {
      enabled: true,
      frequency: 'quarterly',
      lastTrainingDate: '2023-07-20'
    },
    privilegeManagement: true,
    superAdminCount: 2,
    incidentReporting: true
  },
  technological: {
    wafEnabled: true,
    softwareUpdates: true,
    secureAPIs: true,
    apiRateLimiting: true,
    corsEnabled: true,
    csrfProtection: true,
    serverHardening: true
  }
};

// Mock audit logs
const auditLogs = [
  { id: 1, timestamp: '2023-08-15 14:30:22', user: 'admin', action: 'Login', ip: '192.168.1.1', result: 'Success' },
  { id: 2, timestamp: '2023-08-15 14:28:45', user: 'jane.doe', action: 'Password Change', ip: '10.0.0.5', result: 'Success' },
  { id: 3, timestamp: '2023-08-15 14:25:10', user: 'john.doe', action: 'Failed Login', ip: '203.0.113.45', result: 'Failure' },
  { id: 4, timestamp: '2023-08-15 14:20:33', user: 'admin', action: 'Security Settings Update', ip: '192.168.1.1', result: 'Success' },
  { id: 5, timestamp: '2023-08-15 14:15:18', user: 'support', action: 'User Data Access', ip: '10.0.0.8', result: 'Success' }
];

// GET /api/security/settings - Get all security settings
router.get('/settings', (req, res) => {
  try {
    // In a real app, you would fetch from a database
    res.json(securitySettings);
  } catch (error) {
    console.error('Error fetching security settings:', error);
    res.status(500).json({ message: 'Error fetching security settings' });
  }
});

// PUT /api/security/settings/:section - Update a specific section of security settings
router.put('/settings/:section', (req, res) => {
  try {
    const section = req.params.section;
    const updatedSettings = req.body;
    
    // Validate that the section exists
    if (!securitySettings[section]) {
      return res.status(404).json({ message: 'Security section not found' });
    }
    
    // Update the section
    securitySettings[section] = { ...securitySettings[section], ...updatedSettings };
    
    // Log the change (in a real app, this would be saved to an audit log)
    console.log(`Security settings updated for section: ${section}`, updatedSettings);
    
    res.json({ message: 'Security settings updated successfully', data: securitySettings[section] });
  } catch (error) {
    console.error('Error updating security settings:', error);
    res.status(500).json({ message: 'Error updating security settings' });
  }
});

// POST /api/security/settings/accessControls/ip - Add an IP to the whitelist
router.post('/settings/accessControls/ip', (req, res) => {
  try {
    const { ip } = req.body;
    
    if (!ip) {
      return res.status(400).json({ message: 'IP address is required' });
    }
    
    // Check if IP already exists
    if (securitySettings.accessControls.ipRestriction.allowedIPs.includes(ip)) {
      return res.status(400).json({ message: 'IP address already in whitelist' });
    }
    
    // Add the IP
    securitySettings.accessControls.ipRestriction.allowedIPs.push(ip);
    
    // Log the change
    console.log(`IP added to whitelist: ${ip}`);
    
    res.json({ 
      message: 'IP added to whitelist successfully', 
      data: { allowedIPs: securitySettings.accessControls.ipRestriction.allowedIPs }
    });
  } catch (error) {
    console.error('Error adding IP to whitelist:', error);
    res.status(500).json({ message: 'Error adding IP to whitelist' });
  }
});

// DELETE /api/security/settings/accessControls/ip/:ip - Remove an IP from the whitelist
router.delete('/settings/accessControls/ip/:ip', (req, res) => {
  try {
    const ip = req.params.ip;
    
    // Check if IP exists
    if (!securitySettings.accessControls.ipRestriction.allowedIPs.includes(ip)) {
      return res.status(404).json({ message: 'IP address not found in whitelist' });
    }
    
    // Remove the IP
    securitySettings.accessControls.ipRestriction.allowedIPs = 
      securitySettings.accessControls.ipRestriction.allowedIPs.filter(item => item !== ip);
    
    // Log the change
    console.log(`IP removed from whitelist: ${ip}`);
    
    res.json({ 
      message: 'IP removed from whitelist successfully', 
      data: { allowedIPs: securitySettings.accessControls.ipRestriction.allowedIPs }
    });
  } catch (error) {
    console.error('Error removing IP from whitelist:', error);
    res.status(500).json({ message: 'Error removing IP from whitelist' });
  }
});

// GET /api/security/audit-logs - Get audit logs
router.get('/audit-logs', (req, res) => {
  try {
    // In a real app, you would fetch from a database with pagination, filtering, etc.
    res.json(auditLogs);
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ message: 'Error fetching audit logs' });
  }
});

module.exports = router;