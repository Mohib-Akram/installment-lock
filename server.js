// ===== ZAROORI TOOLS =====
const express = require('express');
const cors = require('cors');
const db = require('./database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ===== JWT SECRET =====
const JWT_SECRET = process.env.JWT_SECRET || 'qist-manager-secret-key-change-this';


// ===== FIREBASE (FCM PUSH) =====
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


// ===== PUSH NOTIFICATION =====
async function sendPushToLoan(loanId) {
  try {
    const loan = db.prepare(
      'SELECT fcm_token FROM loans WHERE id = ?'
    ).get(loanId);

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

      console.log(`Push bheja Loan #${loanId} ko`);
    } else {
      console.log(`Loan #${loanId} ka token nahi hai abhi`);
    }

  } catch (e) {
    console.log('Push masla:', e.message);
  }
}


const app = express();

app.use(express.json());
app.use(cors());

const PORT = 3000;


// =========================================================
// SHOPKEEPER TOKEN MIDDLEWARE
// =========================================================

function verifyShopkeeperToken(req, res, next) {

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'Login zaroori hai'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {

    if (err) {
      return res.status(403).json({
        error: 'Token invalid ya expire ho gaya, dobara login karein'
      });
    }

    if (decoded.type !== 'shopkeeper') {
      return res.status(403).json({
        error: 'Shopkeeper token required hai'
      });
    }

    req.shopkeeper_id = decoded.shopkeeper_id;

    next();
  });
}


// =========================================================
// SUPER ADMIN TOKEN MIDDLEWARE
// =========================================================

function verifyAdminToken(req, res, next) {

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'Admin login zaroori hai'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {

    if (err) {
      return res.status(403).json({
        error: 'Admin token invalid ya expire ho gaya'
      });
    }

    if (decoded.type !== 'admin') {
      return res.status(403).json({
        error: 'Admin access required hai'
      });
    }

    req.admin_id = decoded.admin_id;

    next();
  });
}


// =========================================================
// TEST ROUTE
// =========================================================

app.get('/', (req, res) => {
  res.send('Installment Software ka server chal raha hai!');
});


// =========================================================
// SHOPKEEPER LOGIN
// =========================================================

app.post('/shopkeeper/login', (req, res) => {

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      error: 'Username aur password zaroori hain'
    });
  }

  const shopkeeper = db.prepare(
    'SELECT * FROM shopkeepers WHERE username = ?'
  ).get(username);

  if (!shopkeeper) {
    return res.status(401).json({
      error: 'Username ya password ghalat hai'
    });
  }

  if (shopkeeper.status === 'blocked') {
    return res.status(403).json({
      error: 'Aapka account block hai. Admin se raabta karein.'
    });
  }

  const passwordSahiHai = bcrypt.compareSync(
    password,
    shopkeeper.password_hash
  );

  if (!passwordSahiHai) {
    return res.status(401).json({
      error: 'Username ya password ghalat hai'
    });
  }

  const token = jwt.sign(
    {
      type: 'shopkeeper',
      shopkeeper_id: shopkeeper.id,
      username: shopkeeper.username
    },
    JWT_SECRET,
    {
      expiresIn: '7d'
    }
  );

  res.json({
    message: 'Login kamiyab!',
    token: token,

    shopkeeper: {
      id: shopkeeper.id,
      naam: shopkeeper.naam,
      shop_naam: shopkeeper.shop_naam,
      username: shopkeeper.username
    }
  });
});


// =========================================================
// SHOPKEEPER PROFILE
// =========================================================

app.get('/shopkeeper/me', verifyShopkeeperToken, (req, res) => {

  const shopkeeper = db.prepare(`
    SELECT
      id,
      naam,
      shop_naam,
      email,
      username,
      status
    FROM shopkeepers
    WHERE id = ?
  `).get(req.shopkeeper_id);

  if (!shopkeeper) {
    return res.status(404).json({
      error: 'Shopkeeper nahi mila'
    });
  }

  res.json(shopkeeper);
});


// =========================================================
// ===================== ADMIN SYSTEM =======================
// =========================================================


// =========================================================
// ADMIN LOGIN
// =========================================================

app.post('/admin/login', (req, res) => {

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      error: 'Username aur password zaroori hain'
    });
  }

  const admin = db.prepare(
    'SELECT * FROM admins WHERE username = ?'
  ).get(username);

  if (!admin) {
    return res.status(401).json({
      error: 'Admin username ya password ghalat hai'
    });
  }

  if (admin.status === 'blocked') {
    return res.status(403).json({
      error: 'Admin account blocked hai'
    });
  }

  const passwordSahiHai = bcrypt.compareSync(
    password,
    admin.password_hash
  );

  if (!passwordSahiHai) {
    return res.status(401).json({
      error: 'Admin username ya password ghalat hai'
    });
  }

  const token = jwt.sign(
    {
      type: 'admin',
      admin_id: admin.id,
      username: admin.username
    },
    JWT_SECRET,
    {
      expiresIn: '7d'
    }
  );

  res.json({
    message: 'Admin login kamiyab!',
    token: token,

    admin: {
      id: admin.id,
      naam: admin.naam,
      username: admin.username
    }
  });
});


// =========================================================
// ADMIN PROFILE
// =========================================================

app.get('/admin/me', verifyAdminToken, (req, res) => {

  const admin = db.prepare(`
    SELECT
      id,
      naam,
      username,
      status
    FROM admins
    WHERE id = ?
  `).get(req.admin_id);

  if (!admin) {
    return res.status(404).json({
      error: 'Admin nahi mila'
    });
  }

  res.json(admin);
});


// =========================================================
// SHOPKEEPERS LIST
// =========================================================

app.get('/admin/shopkeepers', verifyAdminToken, (req, res) => {

  const shopkeepers = db.prepare(`
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
});


// =========================================================
// ADD NEW SHOPKEEPER
// =========================================================

app.post('/admin/shopkeepers', verifyAdminToken, (req, res) => {

  const {
    naam,
    shop_naam,
    email,
    username,
    password
  } = req.body;

  if (!naam || !username || !password) {
    return res.status(400).json({
      error: 'Naam, username aur password zaroori hain'
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      error: 'Password kam az kam 6 characters ka hona chahiye'
    });
  }

  const existingUsername = db.prepare(
    'SELECT id FROM shopkeepers WHERE username = ?'
  ).get(username);

  if (existingUsername) {
    return res.status(409).json({
      error: 'Ye username pehle se use ho raha hai'
    });
  }

  if (email) {

    const existingEmail = db.prepare(
      'SELECT id FROM shopkeepers WHERE email = ?'
    ).get(email);

    if (existingEmail) {
      return res.status(409).json({
        error: 'Ye email pehle se use ho rahi hai'
      });
    }
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  try {

    const result = db.prepare(`
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

    const shopkeeper = db.prepare(`
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
    `).get(result.lastInsertRowid);

    res.status(201).json({
      message: 'Naya shopkeeper successfully add ho gaya!',
      shopkeeper: shopkeeper
    });

  } catch (error) {

    console.log('Shopkeeper add error:', error.message);

    res.status(500).json({
      error: 'Shopkeeper add nahi ho saka'
    });
  }
});


// =========================================================
// BLOCK SHOPKEEPER
// =========================================================

app.post('/admin/shopkeepers/:id/block', verifyAdminToken, (req, res) => {

  const shopkeeperId = req.params.id;

  const shopkeeper = db.prepare(
    'SELECT id, username, status FROM shopkeepers WHERE id = ?'
  ).get(shopkeeperId);

  if (!shopkeeper) {
    return res.status(404).json({
      error: 'Shopkeeper nahi mila'
    });
  }

  const result = db.prepare(`
    UPDATE shopkeepers
    SET status = 'blocked'
    WHERE id = ?
  `).run(shopkeeperId);

  if (result.changes === 0) {
    return res.status(400).json({
      error: 'Shopkeeper block nahi ho saka'
    });
  }

  res.json({
    message: 'Shopkeeper block ho gaya!',
    shopkeeper_id: Number(shopkeeperId)
  });
});


// =========================================================
// UNBLOCK SHOPKEEPER
// =========================================================

app.post('/admin/shopkeepers/:id/unblock', verifyAdminToken, (req, res) => {

  const shopkeeperId = req.params.id;

  const shopkeeper = db.prepare(
    'SELECT id, username, status FROM shopkeepers WHERE id = ?'
  ).get(shopkeeperId);

  if (!shopkeeper) {
    return res.status(404).json({
      error: 'Shopkeeper nahi mila'
    });
  }

  const result = db.prepare(`
    UPDATE shopkeepers
    SET status = 'active'
    WHERE id = ?
  `).run(shopkeeperId);

  if (result.changes === 0) {
    return res.status(400).json({
      error: 'Shopkeeper unblock nahi ho saka'
    });
  }

  res.json({
    message: 'Shopkeeper unblock ho gaya!',
    shopkeeper_id: Number(shopkeeperId)
  });
});


// =========================================================
// CUSTOMER ADD
// =========================================================

app.post('/customers', verifyShopkeeperToken, (req, res) => {

  const {
    naam,
    cnic,
    phone_number,
    pata,
    guarantor
  } = req.body;

  if (!naam) {
    return res.status(400).json({
      error: 'Customer ka naam zaroori hai'
    });
  }

  const command = db.prepare(`
    INSERT INTO customers
      (
        naam,
        cnic,
        phone_number,
        pata,
        guarantor,
        shopkeeper_id
      )
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = command.run(
    naam,
    cnic,
    phone_number,
    pata,
    guarantor,
    req.shopkeeper_id
  );

  res.json({
    message: 'Customer add ho gaya!',
    customer_id: result.lastInsertRowid
  });
});


// =========================================================
// CUSTOMERS DEKHNA
// =========================================================

app.get('/customers', verifyShopkeeperToken, (req, res) => {

  const customers = db.prepare(`
    SELECT *
    FROM customers
    WHERE shopkeeper_id = ?
  `).all(req.shopkeeper_id);

  res.json(customers);
});


// =========================================================
// LOAN ADD
// =========================================================

app.post('/loans', verifyShopkeeperToken, (req, res) => {

  const {
    customer_id,
    phone_ka_naam,
    imei,
    total_qeemat,
    down_payment,
    kitni_installment
  } = req.body;

  if (!customer_id || !total_qeemat || !kitni_installment) {
    return res.status(400).json({
      error: 'Customer, total qeemat aur installment zaroori hain'
    });
  }

  const customer = db.prepare(`
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
      error: 'Ye customer aapka nahi hai'
    });
  }

  const baqi_raqam =
    total_qeemat - (down_payment || 0);

  const per_month =
    baqi_raqam / kitni_installment;

  const command = db.prepare(`
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

  const result = command.run(
    customer_id,
    phone_ka_naam,
    imei,
    total_qeemat,
    down_payment || 0,
    kitni_installment,
    per_month,
    req.shopkeeper_id
  );

  res.json({
    message: 'Loan add ho gaya!',
    loan_id: result.lastInsertRowid,
    per_month: per_month
  });
});


// =========================================================
// LOANS DEKHNA
// =========================================================

app.get('/loans', verifyShopkeeperToken, (req, res) => {

  const loans = db.prepare(`
    SELECT
      loans.*,
      customers.naam AS customer_naam

    FROM loans

    JOIN customers
      ON loans.customer_id = customers.id

    WHERE loans.shopkeeper_id = ?
  `).all(req.shopkeeper_id);

  res.json(loans);
});


// =========================================================
// IMEI SE LOAN DHOONDNA
// PHONE CALL KARTA HAI — NO LOGIN TOKEN
// =========================================================

app.get('/loans/by-imei/:imei', (req, res) => {

  const imei = req.params.imei;

  const loan = db.prepare(`
    SELECT
      loans.*,
      customers.naam AS customer_naam

    FROM loans

    JOIN customers
      ON loans.customer_id = customers.id

    WHERE loans.imei = ?
  `).get(imei);

  if (!loan) {
    return res.status(404).json({
      error: 'Is IMEI ka koi loan nahi mila'
    });
  }

  res.json(loan);
});


// =========================================================
// PHONE LOCK
// =========================================================

app.post('/loans/:id/lock', verifyShopkeeperToken, (req, res) => {

  const loanId = req.params.id;

  const command = db.prepare(`
    UPDATE loans
    SET status = 'locked'
    WHERE id = ?
      AND shopkeeper_id = ?
  `);

  const result = command.run(
    loanId,
    req.shopkeeper_id
  );

  if (result.changes === 0) {
    return res.status(404).json({
      error: 'Ye loan nahi mila'
    });
  }

  sendPushToLoan(loanId);

  res.json({
    message: 'Phone LOCK ho gaya!',
    loan_id: loanId
  });
});


// =========================================================
// PHONE UNLOCK
// =========================================================

app.post('/loans/:id/unlock', verifyShopkeeperToken, (req, res) => {

  const loanId = req.params.id;

  const command = db.prepare(`
    UPDATE loans
    SET
      status = 'active',
      next_due_date = datetime('now', '+30 days')
    WHERE id = ?
      AND shopkeeper_id = ?
  `);

  const result = command.run(
    loanId,
    req.shopkeeper_id
  );

  if (result.changes === 0) {
    return res.status(404).json({
      error: 'Ye loan nahi mila'
    });
  }

  sendPushToLoan(loanId);

  res.json({
    message: 'Phone UNLOCK ho gaya! Agli due date 30 din aage.',
    loan_id: loanId
  });
});


// =========================================================
// STATUS POOCHNA
// PHONE CALL KARTA HAI — NO LOGIN TOKEN
// =========================================================

app.get('/loans/:id/status', (req, res) => {

  const loanId = req.params.id;

  const loan = db.prepare(`
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
      error: 'Ye loan nahi mila'
    });
  }

  res.json(loan);
});


// =========================================================
// PAYMENT ADD + AUTO UNLOCK
// =========================================================

app.post('/payments', verifyShopkeeperToken, (req, res) => {

  const {
    loan_id,
    kitna_diya
  } = req.body;

  if (!loan_id || !kitna_diya) {
    return res.status(400).json({
      error: 'Loan aur raqam zaroori hai'
    });
  }

  const loan = db.prepare(`
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
      error: 'Ye loan nahi mila'
    });
  }

  db.prepare(`
    INSERT INTO payments
      (loan_id, kitna_diya)
    VALUES (?, ?)
  `).run(
    loan_id,
    kitna_diya
  );

  const total_dena =
    loan.total_qeemat - loan.down_payment;

  const jama = db.prepare(`
    SELECT SUM(kitna_diya) AS total
    FROM payments
    WHERE loan_id = ?
  `).get(loan_id);

  const ab_tak_diya =
    jama.total || 0;

  const baqi =
    total_dena - ab_tak_diya;

  let auto_unlock_hua = false;
  let loan_complete = false;

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

    auto_unlock_hua = true;
    loan_complete = true;

  } else {

    db.prepare(`
      UPDATE loans
      SET
        status = 'active',
        next_due_date = datetime('now', '+30 days')
      WHERE id = ?
        AND shopkeeper_id = ?
    `).run(
      loan_id,
      req.shopkeeper_id
    );

    auto_unlock_hua = true;
  }

  sendPushToLoan(loan_id);

  res.json({
    message: 'Payment add ho gaya!',
    ab_tak_diya: ab_tak_diya,
    baqi: baqi > 0 ? baqi : 0,
    loan_complete: loan_complete,
    auto_unlock_hua: auto_unlock_hua
  });
});


// =========================================================
// LOAN SUMMARY
// PHONE CALL KARTA HAI — NO LOGIN TOKEN
// =========================================================

app.get('/loans/:id/summary', (req, res) => {

  const loanId = req.params.id;

  const loan = db.prepare(`
    SELECT *
    FROM loans
    WHERE id = ?
  `).get(loanId);

  if (!loan) {
    return res.status(404).json({
      error: 'Ye loan nahi mila'
    });
  }

  const total_dena =
    loan.total_qeemat - loan.down_payment;

  const jama = db.prepare(`
    SELECT SUM(kitna_diya) AS total
    FROM payments
    WHERE loan_id = ?
  `).get(loanId);

  const ab_tak_diya =
    jama.total || 0;

  const baqi =
    total_dena - ab_tak_diya;

  res.json({
    total_qeemat: loan.total_qeemat,
    down_payment: loan.down_payment,
    total_dena: total_dena,
    ab_tak_diya: ab_tak_diya,
    baqi: baqi > 0 ? baqi : 0,
    status: loan.status
  });
});


// =========================================================
// LOAN PAYMENTS
// =========================================================

app.get('/loans/:id/payments', verifyShopkeeperToken, (req, res) => {

  const loanId = req.params.id;

  const loan = db.prepare(`
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
      error: 'Ye loan nahi mila'
    });
  }

  const payments = db.prepare(`
    SELECT *
    FROM payments
    WHERE loan_id = ?
    ORDER BY id DESC
  `).all(loanId);

  res.json(payments);
});


// =========================================================
// DUE DATE SET
// =========================================================

app.post('/loans/:id/set-due-date', verifyShopkeeperToken, (req, res) => {

  const loanId = req.params.id;
  const { due_date } = req.body;

  if (!due_date) {
    return res.status(400).json({
      error: 'due_date zaroori hai'
    });
  }

  const command = db.prepare(`
    UPDATE loans
    SET next_due_date = ?
    WHERE id = ?
      AND shopkeeper_id = ?
  `);

  const result = command.run(
    due_date,
    loanId,
    req.shopkeeper_id
  );

  if (result.changes === 0) {
    return res.status(404).json({
      error: 'Ye loan nahi mila'
    });
  }

  sendPushToLoan(loanId);

  res.json({
    message: 'Due date set ho gayi!',
    due_date: due_date
  });
});


// =========================================================
// APP KA TOKEN SAVE
// PHONE CALL KARTA HAI — NO LOGIN TOKEN
// =========================================================

app.post('/loans/:id/token', (req, res) => {

  const loanId = req.params.id;
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({
      error: 'Token zaroori hai'
    });
  }

  db.prepare(`
    UPDATE loans
    SET fcm_token = ?
    WHERE id = ?
  `).run(
    token,
    loanId
  );

  console.log(`Token save hua Loan #${loanId}`);

  res.json({
    message: 'Token save ho gaya!'
  });
});


// =========================================================
// CHOWKIDAR — OVERDUE CHECK
// =========================================================

function chowkidarCheck() {

  const abhi =
    new Date()
      .toISOString()
      .replace('T', ' ')
      .substring(0, 19);

  const overdueLoans = db.prepare(`
    SELECT *
    FROM loans

    WHERE status = 'active'
      AND next_due_date IS NOT NULL
      AND next_due_date <= ?
  `).all(abhi);

  overdueLoans.forEach(loan => {

    db.prepare(`
      UPDATE loans
      SET status = 'locked'
      WHERE id = ?
    `).run(loan.id);

    console.log(
      `AUTO-LOCK! Loan #${loan.id} (${loan.phone_ka_naam}) - phone LOCK!`
    );

    sendPushToLoan(loan.id);
  });

  if (overdueLoans.length > 0) {

    console.log(
      `Chowkidar ne ${overdueLoans.length} phone auto-lock kiye.`
    );
  }
}

setInterval(chowkidarCheck, 30000);

console.log(
  'Chowkidar shuru ho gaya - har 30 second overdue check karega.'
);


// =========================================================
// SERVER START
// =========================================================

app.listen(PORT, '0.0.0.0', () => {

  console.log(
    `Server chal raha hai: http://localhost:${PORT}`
  );

  console.log(
    `Phone se: http://192.168.18.14:${PORT}`
  );
});