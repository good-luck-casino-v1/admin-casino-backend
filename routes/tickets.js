const express = require('express');
const router = express.Router();
const db = require('../config/db');
require("dotenv").config();
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3 = new S3Client({
  region: process.env.SPACES_REGION,
  endpoint: process.env.SPACES_ENDPOINT,
  credentials: {
    accessKeyId: process.env.SPACES_KEY_ADMIN,
    secretAccessKey: process.env.SPACES_SECRET_ADMIN,
  },
});

async function getSignedUrlForAdmin(fileKey) {
  if (!fileKey) return null; // safety check

  // Ensure only the relative key is used
  const key = fileKey.includes("https://") 
    ? fileKey.split("cdn.digitaloceanspaces.com/")[1] 
    : fileKey;

  const command = new GetObjectCommand({
    Bucket: process.env.SPACES_BUCKET,
    Key: key,
  });

  return await getSignedUrl(s3, command, { expiresIn: 600 });
}
//  Fetch all open tickets
router.get('/', async (req, res) => {
  try {
    const [tickets] = await db.query(
      'SELECT * FROM tickets WHERE status = ? ORDER BY created_at DESC',
      ['open']
    );

    // use Promise.all to await signed URLs
   const ticketsWithUrls = await Promise.all(
  tickets.map(async (ticket) => {
    let fileUrl = null;
    if (ticket.evidence) {
      if (ticket.evidence.startsWith("http")) {
        fileUrl = ticket.evidence; // already full URL
      } else {
        fileUrl = `${process.env.SPACES_CDN}/${ticket.evidence}`;
      }
    }

    return {
      ...ticket,
      evidence_url: fileUrl
    };
  })
);


console.log("Signed URL:", ticketsWithUrls[0]?.evidence_url);

    res.json(ticketsWithUrls);
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

//  Get open ticket count
router.get('/count', async (req, res) => {
  try {
    const [result] = await db.query(
      'SELECT COUNT(*) AS count FROM tickets WHERE status = ?',
      ['open']
    );
    res.json({ count: result[0].count });
  } catch (error) {
    console.error('Error fetching ticket count:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

//  Accept or reject ticket
router.put('/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    // Validate status before updating
    const validStatuses = ['open', 'in_progress', 'resolved', 'closed', 'reject']; // add 'reject' if allowed
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status value' });
    }

    try {
        const [result] = await db.query(
            "UPDATE tickets SET status = ? WHERE id = ?",
            [status, id]
        );
        res.json({ message: 'Ticket status updated', result });
    } catch (err) {
        console.error('Error updating ticket:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});



module.exports = router;
