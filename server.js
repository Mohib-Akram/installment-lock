// ============================================================
// INSTALLMENT LOCK - COMPLETE SERVER.JS
// ============================================================

// ===== ZAROORI TOOLS =====
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const upload = require('./uploadConfig');

// ============================================================
// JWT SECRET
// ============================================================

const JWT_SECRET =
  process.env.JWT_SECRET || 'qist-manager-secret-key-change-this';

// ============================================================
// FIREBASE FCM PUSH
// ============================================================

const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

let serviceAccount;

if (process.env.FIREBASE_KEY) {
  serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
} else {
  serviceAccount = require('./firebase-key.json');
}

initializeApp({
  credential: cert(serviceAccount)
});

// ============================================================
// EXPRESS APP
// ============================================================

const app = express();

app.use(express.json());
app.use(cors());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ============================================================
// RAILWAY PORT
// ============================================================

const PORT = process.env.PORT || 3000;

// ============================================================
// OFFLINE UNLOCK SYSTEM
// Android ke HMAC-SHA256 system ke saath compatible
// ============================================================

const OFFLINE_TIME_ZONE = 'Asia/Karachi';

function offlineDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: OFFLINE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function offlineEndOfDayIso(date = new Date()) {
  return `${offlineDateKey(date)}T23:59:59+05:00`;
}

function makeOfflineSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

// IMPORTANT:
// Ye Android MainActivity.kt ke offlineCheckDigits()
// ke saath exact same algorithm hai.

function makeOfflineCode(secret, loanId, dateKey, counter) {

  const message = `${loanId}|${dateKey}|${counter}`;

  const digest = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  const check =
    Number.parseInt(digest.slice(0, 8), 16) % 1000;

  return (
    String(counter).padStart(3, '0') +
    String(check).padStart(3, '0')
  );
}

// ============================================================
// OFFLINE TABLES
// ============================================================

function ensureOfflineTables() {

  db.exec(`
    CREATE TABLE IF NOT EXISTS offline_device_secrets (
      loan_id INTEGER PRIMARY KEY,
      secret TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS offline_unlock_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id INTEGER NOT NULL,
      date_key TEXT NOT NULL,
      counter INTEGER NOT NULL,
      code TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,

      UNIQUE(loan_id, date_key, counter),
      UNIQUE(loan_id, date_key, code)
    );

    CREATE TABLE IF NOT EXISTS device_control (
      loan_id INTEGER PRIMARY KEY,
      force_lock INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

ensureOfflineTables();

// ============================================================
// GET / CREATE OFFLINE SECRET FOR LOAN
// ============================================================

function ensureLoanOfflineSecret(loanId) {

  let row = db.prepare(`
    SELECT secret
    FROM offline_device_secrets
    WHERE loan_id = ?
  `).get(loanId);

  if (!row) {

    const secret = makeOfflineSecret();

    db.prepare(`
      INSERT INTO offline_device_secrets
        (loan_id, secret)
      VALUES (?, ?)
    `).run(
      loanId,
      secret
    );

    row = {
      secret
    };
  }

  return row.secret;
}

// ============================================================
// FCM PUSH
// ============================================================

async function sendPushToLoan(loanId) {

  try {

    const loan = db.prepare(`
      SELECT fcm_token
      FROM loans
      WHERE id = ?
    `).get(loanId);

    if (loan && loan.fcm_token) {

      await getMessaging().send({
        token: loan.fcm_token,

        data: {
          action: 'refresh'
        },

        android: {
          priority: 'high'
        }
      });

      console.log(
        `Push bheja Loan #${loanId} ko`
      );

    } else {

      console.log(
        `Loan #${loanId} ka FCM token nahi hai abhi`
      );
    }

  } catch (e) {

    console.log(
      'Push masla:',
      e.message
    );
  }
}

// ============================================================
// PASSWORD RESET / OTP
// ============================================================

const resetOtps = new Map();

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

// ============================================================
// BREVO EMAIL
// ============================================================

const BREVO_API_KEY =
  process.env.BREVO_API_KEY || '';

const BREVO_SENDER_EMAIL =
  process.env.BREVO_SENDER_EMAIL || '';

const BREVO_SENDER_NAME =
  process.env.BREVO_SENDER_NAME || 'Installment Lock';

const emailServiceReady =
  !!(
    BREVO_API_KEY &&
    BREVO_SENDER_EMAIL
  );

if (emailServiceReady) {

  console.log(
    `Brevo email service configured. From: ${BREVO_SENDER_EMAIL}`
  );

} else {

  console.log(
    'BREVO credentials missing - password reset email disabled.'
  );
}

// ============================================================
// SEND OTP EMAIL
// ============================================================

async function sendOtpEmail(
  toEmail,
  toName,
  otp
) {

  const cleanName =
    String(toName || '')
      .replace(/[&<>"']/g, '');

  const response = await fetch(
    'https://api.brevo.com/v3/smtp/email',
    {
      method: 'POST',

      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json'
      },

      body: JSON.stringify({

        sender: {
          name: BREVO_SENDER_NAME,
          email: BREVO_SENDER_EMAIL
        },

        to: [
          {
            email: toEmail,
            name: cleanName || toEmail
          }
        ],

        subject:
          'Installment Lock — Password Reset OTP',

        textContent:
          `Assalam-o-Alaikum ${cleanName},

Aapka password reset OTP hai: ${otp}

Ye OTP 10 minutes tak valid hai.

Agar aapne password reset request nahi ki to is email ko ignore karein.`,

        htmlContent: `
          <div style="
            font-family:Arial,sans-serif;
            line-height:1.6;
            color:#172033;
            max-width:520px;
            margin:auto
          ">

            <h2>Installment Lock</h2>

            <p>
              Assalam-o-Alaikum ${cleanName},
            </p>

            <p>
              Aapka password reset OTP:
            </p>

            <div style="
              font-size:32px;
              font-weight:800;
              letter-spacing:8px;
              padding:16px 0
            ">
              ${otp}
            </div>

            <p>
              Ye OTP <strong>10 minutes</strong> tak valid hai.
            </p>

            <p>
              Agar aapne password reset request nahi ki
              to is email ko ignore karein.
            </p>

          </div>
        `
      })
    }
  );

  if (!response.ok) {

    const errText =
      await response.text();

    throw new Error(
      `Brevo error ${response.status}: ${errText}`
    );
  }

  return true;
}

// ============================================================
// SEND REMINDER EMAIL (BREVO SE)
// ============================================================

async function sendReminderEmail(toEmail, toName, dueDate, amount) {

  if (!emailServiceReady) {
    console.log('Reminder email nahi bheji - Brevo configured nahi hai');
    return;
  }

  const cleanName = String(toName || '').replace(/[&<>"']/g, '');

  try {

    const response = await fetch(
      'https://api.brevo.com/v3/smtp/email',
      {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': BREVO_API_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: {
            name: BREVO_SENDER_NAME,
            email: BREVO_SENDER_EMAIL
          },
          to: [
            { email: toEmail, name: cleanName || toEmail }
          ],
          subject: 'Aapki Installment Due Hone Wali Hai',
          textContent: `Assalam-o-Alaikum ${cleanName},\n\nAapki agli installment ${dueDate} ko due hai.\nRaqam: Rs. ${amount}\n\nWaqt par payment karke phone lock hone se bachein.`,
          htmlContent: `
            <div style="font-family:Arial,sans-serif; line-height:1.6; color:#172033; max-width:520px; margin:auto">
              <h2>Installment Reminder</h2>
              <p>Assalam-o-Alaikum ${cleanName},</p>
              <p>Aapki agli installment <strong>${dueDate}</strong> ko due hai.</p>
              <p>Raqam: <strong>Rs. ${amount}</strong></p>
              <p>Waqt par payment karke phone lock hone se bachein.</p>
            </div>
          `
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Brevo error ${response.status}: ${errText}`);
    }

    console.log(`Reminder email bheja: ${toEmail}`);

  } catch (e) {
    console.log('Reminder email masla:', e.message);
  }
}

// ============================================================
// OTP CLEANUP
// ============================================================

function cleanupExpiredOtps() {

  const now = Date.now();

  for (
    const [key, record]
    of resetOtps.entries()
  ) {

    if (record.expiresAt <= now) {
      resetOtps.delete(key);
    }
  }
}

setInterval(
  cleanupExpiredOtps,
  60 * 1000
);

// ============================================================
// OTP HELPERS
// ============================================================

function normalizeResetIdentifier(value) {

  return String(value || '')
    .trim()
    .toLowerCase();
}

function makeOtp() {

  return crypto
    .randomInt(100000, 1000000)
    .toString();
}

// ============================================================
// SHOPKEEPER TOKEN MIDDLEWARE
// ============================================================

function verifyShopkeeperToken(
  req,
  res,
  next
) {

  const authHeader =
    req.headers['authorization'];

  const token =
    authHeader &&
    authHeader.split(' ')[1];

  if (!token) {

    return res.status(401).json({
      error: 'Login zaroori hai'
    });
  }

  jwt.verify(
    token,
    JWT_SECRET,
    (err, decoded) => {

      if (err) {

        return res.status(403).json({
          error:
            'Token invalid ya expire ho gaya, dobara login karein'
        });
      }

      if (decoded.type !== 'shopkeeper') {

        return res.status(403).json({
          error:
            'Shopkeeper token required hai'
        });
      }

      req.shopkeeper_id =
        decoded.shopkeeper_id;

      next();
    }
  );
}

// ============================================================
// ADMIN TOKEN MIDDLEWARE
// ============================================================

function verifyAdminToken(
  req,
  res,
  next
) {

  const authHeader =
    req.headers['authorization'];

  const token =
    authHeader &&
    authHeader.split(' ')[1];

  if (!token) {

    return res.status(401).json({
      error:
        'Admin login zaroori hai'
    });
  }

  jwt.verify(
    token,
    JWT_SECRET,
    (err, decoded) => {

      if (err) {

        return res.status(403).json({
          error:
            'Admin token invalid ya expire ho gaya'
        });
      }

      if (decoded.type !== 'admin') {

        return res.status(403).json({
          error:
            'Admin access required hai'
        });
      }

      req.admin_id =
        decoded.admin_id;

      next();
    }
  );
}

// ============================================================
// TEST ROUTE
// ============================================================

app.get('/', (req, res) => {

  res.send(
    'Installment Software ka server chal raha hai!'
  );
});

// ============================================================
// WEB PORTAL PAGES
// ============================================================

app.get('/admin.html', (req, res) => {

  res.sendFile(
    path.join(__dirname, 'admin.html')
  );
});

app.get('/dashboard.html', (req, res) => {

  res.sendFile(
    path.join(__dirname, 'dashboard.html')
  );
});

// ============================================================
// FRIENDLY SHORT URLS
// ============================================================

app.get('/admin', (req, res) => {

  res.sendFile(
    path.join(__dirname, 'admin.html')
  );
});

app.get('/dashboard', (req, res) => {

  res.sendFile(
    path.join(__dirname, 'dashboard.html')
  );
});

// ============================================================
// SHOPKEEPER FORGOT PASSWORD
// SEND OTP
// ============================================================

app.post(
  '/shopkeeper/forgot-password',
  async (req, res) => {

    const identifier =
      normalizeResetIdentifier(
        req.body?.identifier
      );

    if (!identifier) {

      return res.status(400).json({
        error:
          'Username ya registered email zaroori hai'
      });
    }

    if (!emailServiceReady) {

      return res.status(503).json({
        error:
          'Password reset email service configured nahi hai'
      });
    }

    const existing =
      resetOtps.get(identifier);

    if (
      existing &&
      existing.lastSentAt &&
      Date.now() - existing.lastSentAt <
        OTP_RESEND_MS
    ) {

      return res.status(429).json({
        error:
          'OTP dobara bhejne se pehle 60 seconds wait karein.'
      });
    }

    const shopkeeper =
      db.prepare(`
        SELECT
          id,
          naam,
          email,
          username,
          status
        FROM shopkeepers
        WHERE LOWER(username) = ?
           OR LOWER(email) = ?
        LIMIT 1
      `).get(
        identifier,
        identifier
      );

    // Account existence reveal nahi karna.
    if (
      !shopkeeper ||
      !shopkeeper.email ||
      shopkeeper.status === 'blocked'
    ) {

      return res.json({
        message:
          'Agar account aur registered email mil gayi to OTP bheji jayegi.'
      });
    }

    const otp =
      makeOtp();

    const now =
      Date.now();

    resetOtps.set(
      identifier,
      {
        otp: otp,
        shopkeeperId: shopkeeper.id,
        username: shopkeeper.username,
        email: shopkeeper.email,
        expiresAt:
          now + OTP_TTL_MS,
        lastSentAt:
          now,
        attempts: 0
      }
    );

    try {

      await sendOtpEmail(
        shopkeeper.email,
        shopkeeper.naam ||
          shopkeeper.username,
        otp
      );

      return res.json({
        message:
          'OTP aapke registered email par bhej di gayi hai.'
      });

    } catch (error) {

      resetOtps.delete(
        identifier
      );

      console.log(
        'OTP email error:',
        error.message
      );

      return res.status(500).json({
        error:
          'OTP email nahi bheji ja saki. Thori dair baad dobara try karein.'
      });
    }
  }
);

// ============================================================
// SHOPKEEPER PASSWORD RESET
// ============================================================

app.post(
  '/shopkeeper/reset-password',
  (req, res) => {

    const identifier =
      normalizeResetIdentifier(
        req.body?.identifier
      );

    const otp =
      String(
        req.body?.otp || ''
      ).trim();

    const newPassword =
      String(
        req.body?.newPassword || ''
      );

    if (
      !identifier ||
      !otp ||
      !newPassword
    ) {

      return res.status(400).json({
        error:
          'Username/email, OTP aur new password zaroori hain'
      });
    }

    if (newPassword.length < 6) {

      return res.status(400).json({
        error:
          'Password kam az kam 6 characters ka hona chahiye'
      });
    }

    const record =
      resetOtps.get(identifier);

    if (
      !record ||
      record.expiresAt <= Date.now()
    ) {

      resetOtps.delete(
        identifier
      );

      return res.status(400).json({
        error:
          'OTP invalid ya expire ho gayi hai. Dobara OTP request karein.'
      });
    }

    if (
      record.attempts >=
      OTP_MAX_ATTEMPTS
    ) {

      resetOtps.delete(
        identifier
      );

      return res.status(429).json({
        error:
          'OTP attempts limit exceed ho gayi. Dobara OTP request karein.'
      });
    }

    record.attempts += 1;

    if (otp !== record.otp) {

      return res.status(400).json({
        error:
          'OTP ghalat hai'
      });
    }

    const passwordHash =
      bcrypt.hashSync(
        newPassword,
        10
      );

    const result =
      db.prepare(`
        UPDATE shopkeepers
        SET password_hash = ?
        WHERE id = ?
      `).run(
        passwordHash,
        record.shopkeeperId
      );

    resetOtps.delete(
      identifier
    );

    if (result.changes === 0) {

      return res.status(404).json({
        error:
          'Shopkeeper nahi mila'
      });
    }

    return res.json({
      message:
        'Password successfully change ho gaya! Ab naye password se login karein.'
    });
  }
);

// ============================================================
// SHOPKEEPER LOGIN
// ============================================================

app.post(
  '/shopkeeper/login',
  (req, res) => {

    const {
      username,
      password
    } = req.body;

    if (
      !username ||
      !password
    ) {

      return res.status(400).json({
        error:
          'Username aur password zaroori hain'
      });
    }

    const shopkeeper =
      db.prepare(`
        SELECT *
        FROM shopkeepers
        WHERE username = ?
      `).get(username);

    if (!shopkeeper) {

      return res.status(401).json({
        error:
          'Username ya password ghalat hai'
      });
    }

    if (
      shopkeeper.status ===
      'blocked'
    ) {

      return res.status(403).json({
        error:
          'Aapka account block hai. Admin se raabta karein.'
      });
    }

    const passwordSahiHai =
      bcrypt.compareSync(
        password,
        shopkeeper.password_hash
      );

    if (!passwordSahiHai) {

      return res.status(401).json({
        error:
          'Username ya password ghalat hai'
      });
    }

    const token =
      jwt.sign(
        {
          type: 'shopkeeper',
          shopkeeper_id:
            shopkeeper.id,
          username:
            shopkeeper.username
        },
        JWT_SECRET,
        {
          expiresIn: '7d'
        }
      );

    return res.json({

      message:
        'Login kamiyab!',

      token: token,

      shopkeeper: {
        id: shopkeeper.id,
        naam: shopkeeper.naam,
        shop_naam:
          shopkeeper.shop_naam,
        username:
          shopkeeper.username
      }
    });
  }
);

// CNIC Photo Upload Route
app.post('/api/customers/:id/upload-cnic', upload.fields([
  { name: 'cnic_front', maxCount: 1 },
  { name: 'cnic_back', maxCount: 1 }
]), (req, res) => {
  try {
    const customerId = req.params.id;

    if (!req.files || (!req.files.cnic_front && !req.files.cnic_back)) {
      return res.status(400).json({ success: false, message: 'Koi photo upload nahi hui' });
    }

    const cnicFrontPath = req.files.cnic_front ? `/uploads/cnic/${req.files.cnic_front[0].filename}` : null;
    const cnicBackPath = req.files.cnic_back ? `/uploads/cnic/${req.files.cnic_back[0].filename}` : null;

    const db = require('./database');

    if (cnicFrontPath) {
      db.prepare('UPDATE customers SET cnic_front_photo = ? WHERE id = ?').run(cnicFrontPath, customerId);
    }
    if (cnicBackPath) {
      db.prepare('UPDATE customers SET cnic_back_photo = ? WHERE id = ?').run(cnicBackPath, customerId);
    }

    res.json({
      success: true,
      message: 'CNIC photos upload ho gayi',
      cnic_front_photo: cnicFrontPath,
      cnic_back_photo: cnicBackPath
    });

  } catch (error) {
    console.error('CNIC upload error:', error);
    res.status(500).json({ success: false, message: 'Upload mein error aayi', error: error.message });
  }
});

// ============================================================
// SHOPKEEPER PROFILE
// ============================================================

app.get(
  '/shopkeeper/me',
  verifyShopkeeperToken,
  (req, res) => {

    const shopkeeper =
      db.prepare(`
        SELECT
          id,
          naam,
          shop_naam,
          email,
          username,
          status
        FROM shopkeepers
        WHERE id = ?
      `).get(
        req.shopkeeper_id
      );

    if (!shopkeeper) {

      return res.status(404).json({
        error:
          'Shopkeeper nahi mila'
      });
    }

    res.json(shopkeeper);
  }
);

// ============================================================
// ADMIN LOGIN
// ============================================================

app.post(
  '/admin/login',
  (req, res) => {

    const {
      username,
      password
    } = req.body;

    if (
      !username ||
      !password
    ) {

      return res.status(400).json({
        error:
          'Username aur password zaroori hain'
      });
    }

    const admin =
      db.prepare(`
        SELECT *
        FROM admins
        WHERE username = ?
      `).get(username);

    if (!admin) {

      return res.status(401).json({
        error:
          'Admin username ya password ghalat hai'
      });
    }

    if (
      admin.status ===
      'blocked'
    ) {

      return res.status(403).json({
        error:
          'Admin account blocked hai'
      });
    }

    const passwordSahiHai =
      bcrypt.compareSync(
        password,
        admin.password_hash
      );

    if (!passwordSahiHai) {

      return res.status(401).json({
        error:
          'Admin username ya password ghalat hai'
      });
    }

    const token =
      jwt.sign(
        {
          type: 'admin',
          admin_id:
            admin.id,
          username:
            admin.username
        },
        JWT_SECRET,
        {
          expiresIn: '7d'
        }
      );

    return res.json({

      message:
        'Admin login kamiyab!',

      token: token,

      admin: {
        id: admin.id,
        naam: admin.naam,
        username:
          admin.username
      }
    });
  }
);

// ============================================================
// ADMIN PROFILE
// ============================================================

app.get(
  '/admin/me',
  verifyAdminToken,
  (req, res) => {

    const admin =
      db.prepare(`
        SELECT
          id,
          naam,
          username,
          status
        FROM admins
        WHERE id = ?
      `).get(
        req.admin_id
      );

    if (!admin) {

      return res.status(404).json({
        error:
          'Admin nahi mila'
      });
    }

    res.json(admin);
  }
);

// ============================================================
// SHOPKEEPERS LIST
// ============================================================

app.get(
  '/admin/shopkeepers',
  verifyAdminToken,
  (req, res) => {

    const shopkeepers =
      db.prepare(`
        SELECT
          s.id,
          s.naam,
          s.shop_naam,
          s.email,
          s.username,
          s.status,
          s.banaya_gaya,

          (
            SELECT COUNT(*)
            FROM customers c
            WHERE c.shopkeeper_id = s.id
          ) AS customers_count,

          (
            SELECT COUNT(*)
            FROM loans l
            WHERE l.shopkeeper_id = s.id
          ) AS loans_count

        FROM shopkeepers s

        ORDER BY s.id DESC
      `).all();

    res.json(shopkeepers);
  }
);

// ============================================================
// ADD SHOPKEEPER
// ============================================================

app.post(
  '/admin/shopkeepers',
  verifyAdminToken,
  (req, res) => {

    const {
      naam,
      shop_naam,
      email,
      username,
      password
    } = req.body;

    if (
      !naam ||
      !username ||
      !password
    ) {

      return res.status(400).json({
        error:
          'Naam, username aur password zaroori hain'
      });
    }

    if (password.length < 6) {

      return res.status(400).json({
        error:
          'Password kam az kam 6 characters ka hona chahiye'
      });
    }

    const existingUsername =
      db.prepare(`
        SELECT id
        FROM shopkeepers
        WHERE username = ?
      `).get(username);

    if (existingUsername) {

      return res.status(409).json({
        error:
          'Ye username pehle se use ho raha hai'
      });
    }

    if (email) {

      const existingEmail =
        db.prepare(`
          SELECT id
          FROM shopkeepers
          WHERE email = ?
        `).get(email);

      if (existingEmail) {

        return res.status(409).json({
          error:
            'Ye email pehle se use ho rahi hai'
        });
      }
    }

    const passwordHash =
      bcrypt.hashSync(
        password,
        10
      );

    try {

      const result =
        db.prepare(`
          INSERT INTO shopkeepers
            (
              naam,
              shop_naam,
              email,
              username,
              password_hash,
              status
            )
          VALUES
            (?, ?, ?, ?, ?, 'active')
        `).run(
          naam,
          shop_naam || null,
          email || null,
          username,
          passwordHash
        );

      const shopkeeper =
        db.prepare(`
          SELECT
            id,
            naam,
            shop_naam,
            email,
            username,
            status,
            banaya_gaya
          FROM shopkeepers
          WHERE id = ?
        `).get(
          result.lastInsertRowid
        );

      return res.status(201).json({

        message:
          'Naya shopkeeper successfully add ho gaya!',

        shopkeeper:
          shopkeeper
      });

    } catch (error) {

      console.log(
        'Shopkeeper add error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Shopkeeper add nahi ho saka'
      });
    }
  }
);

// ============================================================
// BLOCK SHOPKEEPER
// ============================================================

app.post(
  '/admin/shopkeepers/:id/block',
  verifyAdminToken,
  (req, res) => {

    const shopkeeperId =
      req.params.id;

    const shopkeeper =
      db.prepare(`
        SELECT
          id,
          username,
          status
        FROM shopkeepers
        WHERE id = ?
      `).get(shopkeeperId);

    if (!shopkeeper) {

      return res.status(404).json({
        error:
          'Shopkeeper nahi mila'
      });
    }

    const result =
      db.prepare(`
        UPDATE shopkeepers
        SET status = 'blocked'
        WHERE id = ?
      `).run(shopkeeperId);

    if (result.changes === 0) {

      return res.status(400).json({
        error:
          'Shopkeeper block nahi ho saka'
      });
    }

    return res.json({
      message:
        'Shopkeeper block ho gaya!',
      shopkeeper_id:
        Number(shopkeeperId)
    });
  }
);

// ============================================================
// UNBLOCK SHOPKEEPER
// ============================================================

app.post(
  '/admin/shopkeepers/:id/unblock',
  verifyAdminToken,
  (req, res) => {

    const shopkeeperId =
      req.params.id;

    const shopkeeper =
      db.prepare(`
        SELECT
          id,
          username,
          status
        FROM shopkeepers
        WHERE id = ?
      `).get(shopkeeperId);

    if (!shopkeeper) {

      return res.status(404).json({
        error:
          'Shopkeeper nahi mila'
      });
    }

    const result =
      db.prepare(`
        UPDATE shopkeepers
        SET status = 'active'
        WHERE id = ?
      `).run(shopkeeperId);

    if (result.changes === 0) {

      return res.status(400).json({
        error:
          'Shopkeeper unblock nahi ho saka'
      });
    }

    return res.json({
      message:
        'Shopkeeper unblock ho gaya!',
      shopkeeper_id:
        Number(shopkeeperId)
    });
  }
);

// ============================================================
// CUSTOMER ADD
// ============================================================

app.post(
  '/customers',
  verifyShopkeeperToken,
  (req, res) => {

    const {
      naam,
      cnic,
      phone_number,
      email,
      pata,
      guarantor
    } = req.body;

    if (!naam) {
      return res.status(400).json({
        error: 'Customer ka naam zaroori hai'
      });
    }

    const command =
      db.prepare(`
        INSERT INTO customers
          (
            naam,
            cnic,
            phone_number,
            email,
            pata,
            guarantor,
            shopkeeper_id
          )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

    const result =
      command.run(
        naam,
        cnic,
        phone_number,
        email,
        pata,
        guarantor,
        req.shopkeeper_id
      );

    return res.json({
      message: 'Customer add ho gaya!',
      customer_id: result.lastInsertRowid
    });
  }
);

// ============================================================
// CUSTOMERS DEKHNA
// ============================================================

app.get(
  '/customers',
  verifyShopkeeperToken,
  (req, res) => {

    const customers =
      db.prepare(`
        SELECT *
        FROM customers
        WHERE shopkeeper_id = ?
      `).all(
        req.shopkeeper_id
      );

    res.json(customers);
  }
);

// ============================================================
// LOAN ADD
// ============================================================

app.post(
  '/loans',
  verifyShopkeeperToken,
  (req, res) => {

    const {
      customer_id,
      phone_ka_naam,
      imei,
      total_qeemat,
      down_payment,
      kitni_installment
    } = req.body;

    if (
      !customer_id ||
      !total_qeemat ||
      !kitni_installment
    ) {

      return res.status(400).json({
        error:
          'Customer, total qeemat aur installment zaroori hain'
      });
    }

    const customer =
      db.prepare(`
        SELECT *
        FROM customers
        WHERE id = ?
          AND shopkeeper_id = ?
      `).get(
        customer_id,
        req.shopkeeper_id
      );

    if (!customer) {

      return res.status(403).json({
        error:
          'Ye customer aapka nahi hai'
      });
    }

    const baqi_raqam =
      Number(total_qeemat) -
      Number(down_payment || 0);

    const per_month =
      baqi_raqam /
      Number(kitni_installment);

    const command =
      db.prepare(`
        INSERT INTO loans
          (
            customer_id,
            phone_ka_naam,
            imei,
            total_qeemat,
            down_payment,
            kitni_installment,
            per_month,
            shopkeeper_id
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

    const result =
      command.run(
        customer_id,
        phone_ka_naam,
        imei,
        total_qeemat,
        down_payment || 0,
        kitni_installment,
        per_month,
        req.shopkeeper_id
      );

    // Har new loan ke liye unique offline secret.
    ensureLoanOfflineSecret(
      result.lastInsertRowid
    );

    return res.json({
      message:
        'Loan add ho gaya!',
      loan_id:
        result.lastInsertRowid,
      per_month:
        per_month
    });
  }
);

// ============================================================
// LOANS DEKHNA
// ============================================================

app.get(
  '/loans',
  verifyShopkeeperToken,
  (req, res) => {

    const loans =
      db.prepare(`
        SELECT
          loans.*,
          customers.naam AS customer_naam

        FROM loans

        JOIN customers
          ON loans.customer_id =
             customers.id

        WHERE loans.shopkeeper_id = ?
      `).all(
        req.shopkeeper_id
      );

    res.json(loans);
  }
);

// ============================================================
// IMEI SE LOAN DHOONDNA
// PHONE CALL KARTA HAI — NO LOGIN TOKEN
// ============================================================

app.get(
  '/loans/by-imei/:imei',
  (req, res) => {

    const imei =
      req.params.imei;

    const loan =
      db.prepare(`
        SELECT
          loans.*,
          customers.naam AS customer_naam

        FROM loans

        JOIN customers
          ON loans.customer_id =
             customers.id

        WHERE loans.imei = ?
      `).get(imei);

    if (!loan) {

      return res.status(404).json({
        error:
          'Is IMEI ka koi loan nahi mila'
      });
    }

    // Existing loan ke liye secret ensure.
    const offline_secret =
      ensureLoanOfflineSecret(
        loan.id
      );

    return res.json({
      ...loan,
      offline_secret
    });
  }
);

// ============================================================
// OFFLINE CODE - GET
// DASHBOARD SE CODE DIKHANA
// ============================================================

app.get(
  '/loans/:id/offline-code',
  verifyShopkeeperToken,
  (req, res) => {

    const loanId =
      Number(req.params.id);

    const loan =
      db.prepare(`
        SELECT
          id,
          status,
          shopkeeper_id
        FROM loans
        WHERE id = ?
          AND shopkeeper_id = ?
      `).get(
        loanId,
        req.shopkeeper_id
      );

    if (!loan) {

      return res.status(404).json({
        error:
          'Ye loan nahi mila'
      });
    }

    if (loan.status === 'completed') {

      return res.status(400).json({
        error:
          'Completed loan ke liye offline unlock code nahi chahiye'
      });
    }

    const secret =
      ensureLoanOfflineSecret(
        loanId
      );

    const dateKey =
      offlineDateKey();

    const last =
      db.prepare(`
        SELECT counter
        FROM offline_unlock_codes
        WHERE loan_id = ?
          AND date_key = ?
        ORDER BY counter DESC
        LIMIT 1
      `).get(
        loanId,
        dateKey
      );

    let counter =
      last
        ? Number(last.counter) + 1
        : 1;

    let code = null;

    while (counter <= 999) {

      const candidate =
        makeOfflineCode(
          secret,
          loanId,
          dateKey,
          counter
        );

      const collision =
        db.prepare(`
          SELECT id
          FROM offline_unlock_codes
          WHERE loan_id = ?
            AND date_key = ?
            AND code = ?
        `).get(
          loanId,
          dateKey,
          candidate
        );

      if (!collision) {

        code =
          candidate;

        break;
      }

      counter++;
    }

    if (!code) {

      return res.status(429).json({
        error:
          'Aaj is loan ke liye code generation limit poori ho gayi hai'
      });
    }

    db.prepare(`
      INSERT INTO offline_unlock_codes
        (
          loan_id,
          date_key,
          counter,
          code
        )
      VALUES (?, ?, ?, ?)
    `).run(
      loanId,
      dateKey,
      counter,
      code
    );

    return res.json({

      message:
        'Offline unlock code tayyar hai',

      loan_id:
        loanId,

      code:
        code,

      counter:
        counter,

      date:
        dateKey,

      valid_until:
        offlineEndOfDayIso()
    });
  }
);

// ============================================================
// OFFLINE CODE - POST
// ============================================================

app.post(
  '/loans/:id/offline-unlock-code',
  verifyShopkeeperToken,
  (req, res) => {

    const loanId =
      Number(req.params.id);

    const loan =
      db.prepare(`
        SELECT
          id,
          status,
          shopkeeper_id
        FROM loans
        WHERE id = ?
          AND shopkeeper_id = ?
      `).get(
        loanId,
        req.shopkeeper_id
      );

    if (!loan) {

      return res.status(404).json({
        error:
          'Ye loan nahi mila'
      });
    }

    if (loan.status === 'completed') {

      return res.status(400).json({
        error:
          'Completed loan ke liye offline unlock code nahi chahiye'
      });
    }

    const secret =
      ensureLoanOfflineSecret(
        loanId
      );

    const dateKey =
      offlineDateKey();

    const last =
      db.prepare(`
        SELECT counter
        FROM offline_unlock_codes
        WHERE loan_id = ?
          AND date_key = ?
        ORDER BY counter DESC
        LIMIT 1
      `).get(
        loanId,
        dateKey
      );

    let counter =
      last
        ? Number(last.counter) + 1
        : 1;

    let code = null;

    while (counter <= 999) {

      const candidate =
        makeOfflineCode(
          secret,
          loanId,
          dateKey,
          counter
        );

      const collision =
        db.prepare(`
          SELECT id
          FROM offline_unlock_codes
          WHERE loan_id = ?
            AND date_key = ?
            AND code = ?
        `).get(
          loanId,
          dateKey,
          candidate
        );

      if (!collision) {

        code =
          candidate;

        break;
      }

      counter++;
    }

    if (!code) {

      return res.status(429).json({
        error:
          'Aaj is loan ke liye code generation limit poori ho gayi hai'
      });
    }

    db.prepare(`
      INSERT INTO offline_unlock_codes
        (
          loan_id,
          date_key,
          counter,
          code
        )
      VALUES (?, ?, ?, ?)
    `).run(
      loanId,
      dateKey,
      counter,
      code
    );

    return res.json({

      message:
        'Offline unlock code tayyar hai',

      loan_id:
        loanId,

      code:
        code,

      counter:
        counter,

      date:
        dateKey,

      valid_until:
        offlineEndOfDayIso()
    });
  }
);

// ============================================================
// PHONE LOCK
// ============================================================

app.post(
  '/loans/:id/lock',
  verifyShopkeeperToken,
  (req, res) => {

    const loanId =
      Number(req.params.id);

    const loan =
      db.prepare(`
        SELECT id
        FROM loans
        WHERE id = ?
          AND shopkeeper_id = ?
      `).get(
        loanId,
        req.shopkeeper_id
      );

    if (!loan) {

      return res.status(404).json({
        error:
          'Ye loan nahi mila'
      });
    }

    // Server par phone LOCK.
    db.prepare(`
      UPDATE loans
      SET status = 'locked'
      WHERE id = ?
        AND shopkeeper_id = ?
    `).run(
      loanId,
      req.shopkeeper_id
    );

    // Force lock ON.
    db.prepare(`
      INSERT INTO device_control
        (
          loan_id,
          force_lock,
          updated_at
        )
      VALUES (?, 1, CURRENT_TIMESTAMP)

      ON CONFLICT(loan_id)
      DO UPDATE SET
        force_lock = 1,
        updated_at = CURRENT_TIMESTAMP
    `).run(loanId);

    // Push.
    sendPushToLoan(
      loanId
    );

    console.log(
      `PORTAL LOCK: Loan #${loanId} ko force lock kar diya gaya.`
    );

    return res.json({
      message:
        'Phone LOCK ho gaya!',
      loan_id:
        loanId,
      status:
        'locked'
    });
  }
);

// ============================================================
// DELETE COMPLETED LOAN
// ============================================================

app.delete(
  '/loans/:id',
  verifyShopkeeperToken,
  (req, res) => {

    const loanId =
      req.params.id;

    try {

      const loan =
        db.prepare(`
          SELECT
            id,
            status,
            customer_id,
            phone_ka_naam
          FROM loans
          WHERE id = ?
            AND shopkeeper_id = ?
        `).get(
          loanId,
          req.shopkeeper_id
        );

      if (!loan) {

        return res.status(404).json({
          error:
            'Ye loan nahi mila'
        });
      }

      if (loan.status !== 'completed') {

        return res.status(400).json({
          error:
            'Sirf completed loan delete kiya ja sakta hai'
        });
      }

      const deleteLoan =
        db.transaction(() => {

          // Payments.
          db.prepare(`
            DELETE FROM payments
            WHERE loan_id = ?
          `).run(loanId);

          // Offline codes.
          db.prepare(`
            DELETE FROM offline_unlock_codes
            WHERE loan_id = ?
          `).run(loanId);

          // Offline secret.
          db.prepare(`
            DELETE FROM offline_device_secrets
            WHERE loan_id = ?
          `).run(loanId);

          // Device control.
          db.prepare(`
            DELETE FROM device_control
            WHERE loan_id = ?
          `).run(loanId);

          // Loan.
          const result =
            db.prepare(`
              DELETE FROM loans
              WHERE id = ?
                AND shopkeeper_id = ?
                AND status = 'completed'
            `).run(
              loanId,
              req.shopkeeper_id
            );

          if (result.changes === 0) {

            throw new Error(
              'Loan delete nahi ho saka'
            );
          }

          return result.changes;
        });

      deleteLoan();

      console.log(
        `Completed Loan #${loanId} delete ho gaya.`
      );

      return res.json({
        message:
          'Completed loan successfully delete ho gaya!',
        loan_id:
          Number(loanId)
      });

    } catch (error) {

      console.log(
        'Completed loan delete error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Completed loan delete nahi ho saka'
      });
    }
  }
);

// ============================================================
// PHONE UNLOCK
// ============================================================

app.post(
  '/loans/:id/unlock',
  verifyShopkeeperToken,
  (req, res) => {

    const loanId =
      Number(req.params.id);

    const loan =
      db.prepare(`
        SELECT id
        FROM loans
        WHERE id = ?
          AND shopkeeper_id = ?
      `).get(
        loanId,
        req.shopkeeper_id
      );

    if (!loan) {

      return res.status(404).json({
        error:
          'Ye loan nahi mila'
      });
    }

    // Phone ACTIVE.
    db.prepare(`
      UPDATE loans
      SET
        status = 'active',
        next_due_date =
          datetime('now', '+30 days')
      WHERE id = ?
        AND shopkeeper_id = ?
    `).run(
      loanId,
      req.shopkeeper_id
    );

    // Force lock remove.
    db.prepare(`
      INSERT INTO device_control
        (
          loan_id,
          force_lock,
          updated_at
        )
      VALUES (?, 0, CURRENT_TIMESTAMP)

      ON CONFLICT(loan_id)
      DO UPDATE SET
        force_lock = 0,
        updated_at = CURRENT_TIMESTAMP
    `).run(loanId);

    // Push unlock.
    sendPushToLoan(
      loanId
    );

    console.log(
      `PORTAL UNLOCK: Loan #${loanId} force lock remove ho gaya.`
    );

    return res.json({
      message:
        'Phone UNLOCK ho gaya! Agli due date 30 din aage.',
      loan_id:
        loanId,
      status:
        'active'
    });
  }
);

// ============================================================
// OFFLINE UNLOCK SYNC
// Android internet milne ke baad call karta hai.
// ============================================================

app.post(
  '/loans/:id/offline-sync-unlock',
  (req, res) => {

    const loanId =
      Number(req.params.id);

    const secret =
      String(
        req.body?.secret || ''
      );

    if (!secret) {

      return res.status(400).json({
        error:
          'Offline secret zaroori hai'
      });
    }

    const loan =
      db.prepare(`
        SELECT
          id,
          status
        FROM loans
        WHERE id = ?
      `).get(loanId);

    if (!loan) {

      return res.status(404).json({
        error:
          'Ye loan nahi mila'
      });
    }

    // Completed loan ko dobara active nahi karna.
    if (
      loan.status ===
      'completed'
    ) {

      return res.json({
        message:
          'Loan already completed hai',
        loan_id:
          loanId,
        status:
          'completed'
      });
    }

    const savedSecret =
      db.prepare(`
        SELECT secret
        FROM offline_device_secrets
        WHERE loan_id = ?
      `).get(loanId);

    if (!savedSecret) {

      return res.status(403).json({
        error:
          'Offline verification setup nahi hai'
      });
    }

    if (
      savedSecret.secret !==
      secret
    ) {

      return res.status(403).json({
        error:
          'Offline verification failed'
      });
    }

    // Server ACTIVE.
    db.prepare(`
      UPDATE loans
      SET
        status = 'active',
        next_due_date =
          datetime('now', '+30 days')
      WHERE id = ?
    `).run(loanId);

    // Force lock remove.
    db.prepare(`
      INSERT INTO device_control
        (
          loan_id,
          force_lock,
          updated_at
        )
      VALUES (?, 0, CURRENT_TIMESTAMP)

      ON CONFLICT(loan_id)
      DO UPDATE SET
        force_lock = 0,
        updated_at = CURRENT_TIMESTAMP
    `).run(loanId);

    console.log(
      `OFFLINE SYNC UNLOCK: Loan #${loanId} server par ACTIVE ho gaya.`
    );

    return res.json({
      message:
        'Offline unlock server ke saath sync ho gaya!',
      loan_id:
        loanId,
      status:
        'active'
    });
  }
);

// ============================================================
// STATUS
// PHONE CALL KARTA HAI — NO LOGIN TOKEN
// ============================================================

app.get(
  '/loans/:id/status',
  (req, res) => {

    const loanId =
      req.params.id;

    const loan =
      db.prepare(`
        SELECT
          id,
          status,
          phone_ka_naam,
          imei,
          next_due_date
        FROM loans
        WHERE id = ?
      `).get(loanId);

    if (!loan) {

      return res.status(404).json({
        error:
          'Ye loan nahi mila'
      });
    }

    return res.json(loan);
  }
);

// ============================================================
// PAYMENT ADD + AUTO UNLOCK
// ============================================================

app.post(
  '/payments',
  verifyShopkeeperToken,
  (req, res) => {

    const {
      loan_id,
      kitna_diya
    } = req.body;

    if (
      !loan_id ||
      !kitna_diya
    ) {

      return res.status(400).json({
        error:
          'Loan aur raqam zaroori hai'
      });
    }

    const loan =
      db.prepare(`
        SELECT *
        FROM loans
        WHERE id = ?
          AND shopkeeper_id = ?
      `).get(
        loan_id,
        req.shopkeeper_id
      );

    if (!loan) {

      return res.status(404).json({
        error:
          'Ye loan nahi mila'
      });
    }

    // Payment insert.
    db.prepare(`
      INSERT INTO payments
        (
          loan_id,
          kitna_diya
        )
      VALUES (?, ?)
    `).run(
      loan_id,
      kitna_diya
    );

    const total_dena =
      Number(loan.total_qeemat) -
      Number(loan.down_payment);

    const jama =
      db.prepare(`
        SELECT
          SUM(kitna_diya) AS total
        FROM payments
        WHERE loan_id = ?
      `).get(loan_id);

    const ab_tak_diya =
      Number(jama.total || 0);

    const baqi =
      total_dena -
      ab_tak_diya;

    let auto_unlock_hua =
      false;

    let loan_complete =
      false;

    if (baqi <= 0) {

      db.prepare(`
        UPDATE loans
        SET status = 'completed'
        WHERE id = ?
          AND shopkeeper_id = ?
      `).run(
        loan_id,
        req.shopkeeper_id
      );

      // Force lock remove.
      db.prepare(`
        INSERT INTO device_control
          (
            loan_id,
            force_lock,
            updated_at
          )
        VALUES (?, 0, CURRENT_TIMESTAMP)

        ON CONFLICT(loan_id)
        DO UPDATE SET
          force_lock = 0,
          updated_at = CURRENT_TIMESTAMP
      `).run(loan_id);

      auto_unlock_hua =
        true;

      loan_complete =
        true;

    } else {

      db.prepare(`
        UPDATE loans
        SET
          status = 'active',
          next_due_date =
            datetime('now', '+30 days')
        WHERE id = ?
          AND shopkeeper_id = ?
      `).run(
        loan_id,
        req.shopkeeper_id
      );

      // Force lock remove.
      db.prepare(`
        INSERT INTO device_control
          (
            loan_id,
            force_lock,
            updated_at
          )
        VALUES (?, 0, CURRENT_TIMESTAMP)

        ON CONFLICT(loan_id)
        DO UPDATE SET
          force_lock = 0,
          updated_at = CURRENT_TIMESTAMP
      `).run(loan_id);

      auto_unlock_hua =
        true;
    }

    sendPushToLoan(
      loan_id
    );

    return res.json({

      message:
        'Payment add ho gaya!',

      ab_tak_diya:
        ab_tak_diya,

      baqi:
        baqi > 0
          ? baqi
          : 0,

      loan_complete:
        loan_complete,

      auto_unlock_hua:
        auto_unlock_hua
    });
  }
);

// ============================================================
// LOAN SUMMARY
// PHONE CALL KARTA HAI — NO LOGIN TOKEN
// ============================================================

app.get(
  '/loans/:id/summary',
  (req, res) => {

    const loanId =
      req.params.id;

    const loan =
      db.prepare(`
        SELECT *
        FROM loans
        WHERE id = ?
      `).get(loanId);

    if (!loan) {

      return res.status(404).json({
        error:
          'Ye loan nahi mila'
      });
    }

    const total_dena =
      Number(loan.total_qeemat) -
      Number(loan.down_payment);

    const jama =
      db.prepare(`
        SELECT
          SUM(kitna_diya) AS total
        FROM payments
        WHERE loan_id = ?
      `).get(loanId);

    const ab_tak_diya =
      Number(jama.total || 0);

    const baqi =
      total_dena -
      ab_tak_diya;

    return res.json({

      total_qeemat:
        loan.total_qeemat,

      down_payment:
        loan.down_payment,

      total_dena:
        total_dena,

      ab_tak_diya:
        ab_tak_diya,

      baqi:
        baqi > 0
          ? baqi
          : 0,

      status:
        loan.status
    });
  }
);

// ============================================================
// LOAN PAYMENTS
// ============================================================

app.get(
  '/loans/:id/payments',
  verifyShopkeeperToken,
  (req, res) => {

    const loanId =
      req.params.id;

    const loan =
      db.prepare(`
        SELECT *
        FROM loans
        WHERE id = ?
          AND shopkeeper_id = ?
      `).get(
        loanId,
        req.shopkeeper_id
      );

    if (!loan) {

      return res.status(404).json({
        error:
          'Ye loan nahi mila'
      });
    }

    const payments =
      db.prepare(`
        SELECT *
        FROM payments
        WHERE loan_id = ?
        ORDER BY id DESC
      `).all(loanId);

    res.json(payments);
  }
);

// ============================================================
// DUE DATE SET
// ============================================================

app.post(
  '/loans/:id/set-due-date',
  verifyShopkeeperToken,
  (req, res) => {

    const loanId =
      req.params.id;

    const {
      due_date
    } = req.body;

    if (!due_date) {

      return res.status(400).json({
        error:
          'due_date zaroori hai'
      });
    }

    const command =
      db.prepare(`
        UPDATE loans
        SET next_due_date = ?
        WHERE id = ?
          AND shopkeeper_id = ?
      `);

    const result =
      command.run(
        due_date,
        loanId,
        req.shopkeeper_id
      );

    if (result.changes === 0) {

      return res.status(404).json({
        error:
          'Ye loan nahi mila'
      });
    }

    sendPushToLoan(
      loanId
    );

    return res.json({
      message:
        'Due date set ho gayi!',
      due_date:
        due_date
    });
  }
);

// ============================================================
// FCM TOKEN SAVE
// PHONE CALL KARTA HAI — NO LOGIN TOKEN
// ============================================================

app.post(
  '/loans/:id/token',
  (req, res) => {

    const loanId =
      req.params.id;

    const {
      token
    } = req.body;

    if (!token) {

      return res.status(400).json({
        error:
          'Token zaroori hai'
      });
    }

    const result =
      db.prepare(`
        UPDATE loans
        SET fcm_token = ?
        WHERE id = ?
      `).run(
        token,
        loanId
      );

    if (result.changes === 0) {

      return res.status(404).json({
        error:
          'Ye loan nahi mila'
      });
    }

    console.log(
      `FCM token save hua Loan #${loanId}`
    );

    return res.json({
      message:
        'Token save ho gaya!'
    });
  }
);

// ============================================================
// CHOWKIDAR
// HAR 30 SECOND OVERDUE CHECK
// ============================================================

function chowkidarCheck() {

  const abhi =
    new Date()
      .toISOString()
      .replace('T', ' ')
      .substring(0, 19);

  const overdueLoans =
    db.prepare(`
      SELECT *
      FROM loans
      WHERE status = 'active'
        AND next_due_date IS NOT NULL
        AND next_due_date <= ?
    `).all(abhi);

  overdueLoans.forEach(
    loan => {

      db.prepare(`
        UPDATE loans
        SET status = 'locked'
        WHERE id = ?
      `).run(loan.id);

      // Force lock ON.
      db.prepare(`
        INSERT INTO device_control
          (
            loan_id,
            force_lock,
            updated_at
          )
        VALUES (?, 1, CURRENT_TIMESTAMP)

        ON CONFLICT(loan_id)
        DO UPDATE SET
          force_lock = 1,
          updated_at = CURRENT_TIMESTAMP
      `).run(loan.id);

      console.log(
        `AUTO-LOCK! Loan #${loan.id} (${loan.phone_ka_naam}) - phone LOCK!`
      );

      sendPushToLoan(
        loan.id
      );
    }
  );

  if (overdueLoans.length > 0) {

    console.log(
      `Chowkidar ne ${overdueLoans.length} phone auto-lock kiye.`
    );
  }
}

setInterval(
  chowkidarCheck,
  30000
);

console.log(
  'Chowkidar shuru ho gaya - har 30 second overdue check karega.'
);

// ============================================================
// REMINDER CHOWKIDAR
// DIN MEIN 2 BAAR CHECK - 2 DIN PEHLE REMINDER EMAIL
// ============================================================

function reminderChowkidarCheck() {

  const twoDaysLater = new Date();
  twoDaysLater.setDate(twoDaysLater.getDate() + 2);
  const targetDate = twoDaysLater.toISOString().split('T')[0];

  const upcomingLoans = db.prepare(`
    SELECT
      loans.*,
      customers.naam AS customer_naam,
      customers.email AS customer_email
    FROM loans
    JOIN customers ON loans.customer_id = customers.id
    WHERE loans.status = 'active'
      AND loans.next_due_date IS NOT NULL
      AND date(loans.next_due_date) = date(?)
  `).all(targetDate);

  upcomingLoans.forEach(loan => {
    if (loan.customer_email) {
      sendReminderEmail(
        loan.customer_email,
        loan.customer_naam,
        loan.next_due_date,
        loan.per_month
      );
    }
  });

  if (upcomingLoans.length > 0) {
    console.log(`Reminder Chowkidar ne ${upcomingLoans.length} reminder email bheje`);
  }
}

setInterval(reminderChowkidarCheck, 12 * 60 * 60 * 1000);
console.log('Reminder Chowkidar shuru ho gaya - din mein 2 baar check karega.');

// ============================================================
// SERVER START
// ============================================================

app.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      `Server chal raha hai on port ${PORT}`
    );

    console.log(
      'Admin Portal: /admin.html'
    );

    console.log(
      'Shopkeeper Dashboard: /dashboard.html'
    );

    console.log(
      'Offline Unlock System: ACTIVE'
    );

    console.log(
      'Offline timezone: Asia/Karachi'
    );
  }
);