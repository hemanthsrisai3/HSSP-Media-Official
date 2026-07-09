require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const axios = require('axios');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY;
const DB_PATH = process.env.DB_PATH || './hssp_media.db';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

if (!ADMIN_KEY) {
  console.warn('[WARN] ADMIN_KEY is not set in .env — admin routes will reject all requests until it is set.');
}

// ---------------------------------------------------------------------------
// Email transporter setup
// ---------------------------------------------------------------------------

let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  console.log('[INFO] Email notifications enabled.');
} else {
  console.warn('[WARN] Email notifications disabled — SMTP credentials not fully configured in .env');
}

// ---------------------------------------------------------------------------
// Discord notifications
// ---------------------------------------------------------------------------

if (DISCORD_WEBHOOK) {
  console.log('[INFO] Discord notifications enabled.');
} else {
  console.warn('[WARN] Discord notifications disabled — DISCORD_WEBHOOK_URL not set in .env');
}

async function sendNotification(subject, htmlBody, discordFields) {
  // Send email
  if (transporter && NOTIFY_EMAIL) {
    try {
      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to: NOTIFY_EMAIL,
        subject,
        html: htmlBody,
      });
      console.log('[INFO] Email notification sent:', subject);
    } catch (err) {
      console.error('[ERROR] Failed to send email:', err.message);
    }
  }

  // Send Discord message
  if (DISCORD_WEBHOOK) {
    try {
      const embed = {
        title: subject,
        color: 0x0087BD,
        fields: discordFields || [],
        timestamp: new Date().toISOString(),
      };
      await axios.post(DISCORD_WEBHOOK, { embeds: [embed] });
      console.log('[INFO] Discord notification sent:', subject);
    } catch (err) {
      console.error('[ERROR] Failed to send Discord notification:', err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    event_type TEXT,
    event_date TEXT,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_type TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    preferred_date TEXT,
    budget_range TEXT,
    details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS newsletter (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at);
  CREATE INDEX IF NOT EXISTS idx_inquiries_created_at ON inquiries(created_at);
  CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);
  CREATE INDEX IF NOT EXISTS idx_newsletter_email ON newsletter(email);
`);

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_INQUIRY_STATUSES = ['new', 'contacted', 'quoted', 'booked', 'completed', 'declined'];

const VALID_SERVICE_TYPES = [
  'Real Estate & Housewarming',
  'Birthdays & Celebrations',
  'Bridal & Haldi Ceremonies',
  'Graduation Events',
  'Culinary & Food Media',
  'Manabadi Cultural Events'
];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function cleanString(value, maxLen = 2000) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function validationError(res, message) {
  return res.status(400).json({ ok: false, error: message });
}

function requireAdmin(req, res, next) {
  const key = req.header('x-admin-key') || req.header('X-Admin-Key');
  if (!ADMIN_KEY || !key || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, char => map[char]);
}

// ---------------------------------------------------------------------------
// Public API routes
// ---------------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
});

// POST /api/contact — general contact form
app.post('/api/contact', asyncHandler(async (req, res) => {
  const { name, email, phone, event_type, event_date, message } = req.body || {};

  if (!isNonEmptyString(name)) return validationError(res, 'Name is required.');
  if (!isNonEmptyString(email) || !EMAIL_RE.test(email.trim())) {
    return validationError(res, 'A valid email is required.');
  }
  if (!isNonEmptyString(message)) return validationError(res, 'Message is required.');

  const cleanName = cleanString(name, 200);
  const cleanEmail = cleanString(email, 200).toLowerCase();
  const cleanPhone = cleanString(phone, 50);
  const cleanEventType = cleanString(event_type, 100);
  const cleanEventDate = cleanString(event_date, 50);
  const cleanMessage = cleanString(message, 5000);

  const stmt = db.prepare(`
    INSERT INTO contacts (name, email, phone, event_type, event_date, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(cleanName, cleanEmail, cleanPhone, cleanEventType, cleanEventDate, cleanMessage);

  // Send notifications
  const smsBody = `New Contact:\n${cleanName} (${cleanEmail})\nPhone: ${cleanPhone || 'N/A'}`;
  const notifHtml = `
    <h2>New Contact Form Submission</h2>
    <p><strong>Name:</strong> ${escapeHtml(cleanName)}</p>
    <p><strong>Email:</strong> ${escapeHtml(cleanEmail)}</p>
    <p><strong>Phone:</strong> ${cleanPhone ? escapeHtml(cleanPhone) : 'Not provided'}</p>
    <p><strong>Event Type:</strong> ${cleanEventType || 'Not specified'}</p>
    <p><strong>Event Date:</strong> ${cleanEventDate || 'Not specified'}</p>
    <p><strong>Message:</strong></p>
    <p>${escapeHtml(cleanMessage).replace(/\n/g, '<br>')}</p>
    <p><small>Received: ${new Date().toISOString()}</small></p>
  `;
  const discordFields = [
    { name: 'Name', value: cleanName, inline: true },
    { name: 'Email', value: cleanEmail, inline: true },
    { name: 'Phone', value: cleanPhone || 'Not provided', inline: true },
    { name: 'Event Type', value: cleanEventType || 'Not specified', inline: true },
    { name: 'Event Date', value: cleanEventDate || 'Not specified', inline: true },
    { name: 'Message', value: cleanMessage.substring(0, 1024), inline: false },
  ];
  await sendNotification(`New Contact: ${cleanName}`, notifHtml, discordFields);

  res.status(201).json({ ok: true, message: "Thanks — we'll be in touch soon.", id: info.lastInsertRowid });
}));

// POST /api/inquiry — service-specific inquiry from portfolio cards
app.post('/api/inquiry', asyncHandler(async (req, res) => {
  const { service_type, name, email, phone, preferred_date, budget_range, details } = req.body || {};

  if (!isNonEmptyString(service_type)) return validationError(res, 'Service type is required.');
  if (!isNonEmptyString(name)) return validationError(res, 'Name is required.');
  if (!isNonEmptyString(email) || !EMAIL_RE.test(email.trim())) {
    return validationError(res, 'A valid email is required.');
  }
  if (!isNonEmptyString(details)) return validationError(res, 'Please share a few details about your event.');

  const cleanServiceType = cleanString(service_type, 150);
  const cleanName = cleanString(name, 200);
  const cleanEmail = cleanString(email, 200).toLowerCase();
  const cleanPhone = cleanString(phone, 50);
  const cleanPreferredDate = cleanString(preferred_date, 50);
  const cleanBudgetRange = cleanString(budget_range, 100);
  const cleanDetails = cleanString(details, 5000);

  const stmt = db.prepare(`
    INSERT INTO inquiries (service_type, name, email, phone, preferred_date, budget_range, details, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'new')
  `);
  const info = stmt.run(
    cleanServiceType,
    cleanName,
    cleanEmail,
    cleanPhone,
    cleanPreferredDate,
    cleanBudgetRange,
    cleanDetails
  );

  // Send notifications
  const smsBody = `New Service Inquiry:\n${cleanServiceType}\nFrom: ${cleanName} (${cleanEmail})\nPhone: ${cleanPhone || 'N/A'}`;
  const notifHtml = `
    <h2>New Service Inquiry</h2>
    <p><strong>Service:</strong> ${escapeHtml(cleanServiceType)}</p>
    <p><strong>Name:</strong> ${escapeHtml(cleanName)}</p>
    <p><strong>Email:</strong> ${escapeHtml(cleanEmail)}</p>
    <p><strong>Phone:</strong> ${cleanPhone ? escapeHtml(cleanPhone) : 'Not provided'}</p>
    <p><strong>Preferred Date:</strong> ${cleanPreferredDate || 'Not specified'}</p>
    <p><strong>Budget Range:</strong> ${cleanBudgetRange || 'Not specified'}</p>
    <p><strong>Details:</strong></p>
    <p>${escapeHtml(cleanDetails).replace(/\n/g, '<br>')}</p>
    <p><small>Received: ${new Date().toISOString()}</small></p>
  `;
  const discordFields = [
    { name: 'Service', value: cleanServiceType, inline: true },
    { name: 'Name', value: cleanName, inline: true },
    { name: 'Email', value: cleanEmail, inline: true },
    { name: 'Phone', value: cleanPhone || 'Not provided', inline: true },
    { name: 'Preferred Date', value: cleanPreferredDate || 'Not specified', inline: true },
    { name: 'Budget Range', value: cleanBudgetRange || 'Not specified', inline: true },
    { name: 'Details', value: cleanDetails.substring(0, 1024), inline: false },
  ];
  await sendNotification(`New Service Inquiry: ${cleanServiceType}`, notifHtml, discordFields);

  res.status(201).json({
    ok: true,
    message: "Inquiry received — we'll follow up with availability and pricing shortly.",
    id: info.lastInsertRowid
  });
}));

// POST /api/newsletter — newsletter signup
app.post('/api/newsletter', asyncHandler(async (req, res) => {
  const { email } = req.body || {};

  if (!isNonEmptyString(email) || !EMAIL_RE.test(email.trim())) {
    return validationError(res, 'A valid email is required.');
  }

  const cleanEmail = cleanString(email, 200).toLowerCase();

  try {
    const stmt = db.prepare(`INSERT INTO newsletter (email) VALUES (?)`);
    const info = stmt.run(cleanEmail);
    res.status(201).json({ ok: true, message: "You're subscribed — welcome aboard!", id: info.lastInsertRowid });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/.test(err.message)) {
      return res.status(200).json({ ok: true, message: "You're already on the list!" });
    }
    throw err;
  }
}));

// ---------------------------------------------------------------------------
// Admin API routes (protected by ADMIN_KEY header)
// ---------------------------------------------------------------------------

app.get('/api/admin/contacts', requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT * FROM contacts ORDER BY created_at DESC`).all();
  res.json({ ok: true, count: rows.length, data: rows });
});

app.get('/api/admin/inquiries', requireAdmin, (req, res) => {
  const { status } = req.query;
  let rows;
  if (status) {
    rows = db.prepare(`SELECT * FROM inquiries WHERE status = ? ORDER BY created_at DESC`).all(status);
  } else {
    rows = db.prepare(`SELECT * FROM inquiries ORDER BY created_at DESC`).all();
  }
  res.json({ ok: true, count: rows.length, data: rows });
});

app.get('/api/admin/newsletter', requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT * FROM newsletter ORDER BY created_at DESC`).all();
  res.json({ ok: true, count: rows.length, data: rows });
});

app.patch('/api/admin/inquiries/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};

  if (!/^\d+$/.test(id)) {
    return validationError(res, 'Invalid inquiry id.');
  }
  if (!isNonEmptyString(status) || !VALID_INQUIRY_STATUSES.includes(status.trim())) {
    return validationError(res, `Status must be one of: ${VALID_INQUIRY_STATUSES.join(', ')}`);
  }

  const existing = db.prepare(`SELECT id FROM inquiries WHERE id = ?`).get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: 'Inquiry not found.' });
  }

  db.prepare(`UPDATE inquiries SET status = ? WHERE id = ?`).run(status.trim(), id);
  const updated = db.prepare(`SELECT * FROM inquiries WHERE id = ?`).get(id);

  res.json({ ok: true, message: 'Inquiry updated.', data: updated });
});

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------

const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// SPA catch-all — must come after API routes and static middleware.
// Skip anything under /api so unknown API routes correctly 404 as JSON.
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ ok: false, error: 'Something went wrong on our end. Please try again shortly.' });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`HSSP Media server running at http://localhost:${PORT}`);
  console.log(`Database: ${path.resolve(DB_PATH)}`);
});

module.exports = app;
