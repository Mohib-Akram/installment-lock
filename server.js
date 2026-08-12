// ===== ZAROORI TOOLS =====
const express = require('express');
const cors = require('cors');
const db = require('./database');

// ===== FIREBASE (FCM push) =====
const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

// firebase key: environment variable se (hosting) ya file se (local)
let serviceAccount;
if (process.env.FIREBASE_KEY) {
  serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
} else {
  serviceAccount = require('./firebase-key.json');
}

initializeApp({
  credential: cert(serviceAccount)
});

// Push bhejne wala function
async function sendPushToLoan(loanId) {
  try {
    const loan = db.prepare('SELECT fcm_token FROM loans WHERE id = ?').get(loanId);
    if (loan && loan.fcm_token) {
      await getMessaging().send({
        token: loan.fcm_token,
        data: { action: 'refresh' },
        android: { priority: 'high' }
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


// ===== ROUTE 1: Test =====
app.get('/', (req, res) => {
  res.send('Installment Software ka server chal raha hai!');
});


// ===== ROUTE 2: CUSTOMER ADD =====
app.post('/customers', (req, res) => {
  const { naam, cnic, phone_number, pata, guarantor } = req.body;
  if (!naam) return res.status(400).json({ error: 'Customer ka naam zaroori hai' });
  const command = db.prepare(`INSERT INTO customers (naam, cnic, phone_number, pata, guarantor) VALUES (?, ?, ?, ?, ?)`);
  const result = command.run(naam, cnic, phone_number, pata, guarantor);
  res.json({ message: 'Customer add ho gaya!', customer_id: result.lastInsertRowid });
});


// ===== ROUTE 3: CUSTOMERS DEKHNA =====
app.get('/customers', (req, res) => {
  const customers = db.prepare('SELECT * FROM customers').all();
  res.json(customers);
});


// ===== ROUTE 4: LOAN ADD =====
app.post('/loans', (req, res) => {
  const { customer_id, phone_ka_naam, imei, total_qeemat, down_payment, kitni_installment } = req.body;
  if (!customer_id || !total_qeemat || !kitni_installment) {
    return res.status(400).json({ error: 'Customer, total qeemat aur installment zaroori hain' });
  }
  const baqi_raqam = total_qeemat - (down_payment || 0);
  const per_month = baqi_raqam / kitni_installment;
  const command = db.prepare(`INSERT INTO loans (customer_id, phone_ka_naam, imei, total_qeemat, down_payment, kitni_installment, per_month) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const result = command.run(customer_id, phone_ka_naam, imei, total_qeemat, down_payment || 0, kitni_installment, per_month);
  res.json({ message: 'Loan add ho gaya!', loan_id: result.lastInsertRowid, per_month: per_month });
});


// ===== ROUTE 5: LOANS DEKHNA =====
app.get('/loans', (req, res) => {
  const loans = db.prepare(`SELECT loans.*, customers.naam AS customer_naam FROM loans JOIN customers ON loans.customer_id = customers.id`).all();
  res.json(loans);
});


// ===== ROUTE 5B: IMEI SE LOAN DHOONDNA (QR provisioning ke liye) =====
app.get('/loans/by-imei/:imei', (req, res) => {
  const imei = req.params.imei;
  const loan = db.prepare(`
    SELECT loans.*, customers.naam AS customer_naam 
    FROM loans 
    JOIN customers ON loans.customer_id = customers.id 
    WHERE loans.imei = ?
  `).get(imei);

  if (!loan) {
    return res.status(404).json({ error: 'Is IMEI ka koi loan nahi mila' });
  }

  res.json(loan);
});


// ===== ROUTE 6: PHONE LOCK =====
app.post('/loans/:id/lock', (req, res) => {
  const loanId = req.params.id;
  const command = db.prepare(`UPDATE loans SET status = 'locked' WHERE id = ?`);
  const result = command.run(loanId);
  if (result.changes === 0) return res.status(404).json({ error: 'Ye loan nahi mila' });
  sendPushToLoan(loanId); // phone ko jagаo (band ho to bhi)
  res.json({ message: 'Phone LOCK ho gaya!', loan_id: loanId });
});


// ===== ROUTE 7: PHONE UNLOCK =====
app.post('/loans/:id/unlock', (req, res) => {
  const loanId = req.params.id;
  const command = db.prepare(`UPDATE loans SET status = 'active', next_due_date = datetime('now', '+30 days') WHERE id = ?`);
  const result = command.run(loanId);
  if (result.changes === 0) return res.status(404).json({ error: 'Ye loan nahi mila' });
  sendPushToLoan(loanId);
  res.json({ message: 'Phone UNLOCK ho gaya! Agli due date 30 din aage.', loan_id: loanId });
});


// ===== ROUTE 8: STATUS POOCHNA =====
app.get('/loans/:id/status', (req, res) => {
  const loanId = req.params.id;
  const loan = db.prepare(`SELECT id, status, phone_ka_naam, imei, next_due_date FROM loans WHERE id = ?`).get(loanId);
  if (!loan) return res.status(404).json({ error: 'Ye loan nahi mila' });
  res.json(loan);
});


// ===== ROUTE 9: PAYMENT ADD (+ AUTO-UNLOCK) =====
app.post('/payments', (req, res) => {
  const { loan_id, kitna_diya } = req.body;
  if (!loan_id || !kitna_diya) return res.status(400).json({ error: 'Loan aur raqam zaroori hai' });
  const loan = db.prepare(`SELECT * FROM loans WHERE id = ?`).get(loan_id);
  if (!loan) return res.status(404).json({ error: 'Ye loan nahi mila' });

  db.prepare(`INSERT INTO payments (loan_id, kitna_diya) VALUES (?, ?)`).run(loan_id, kitna_diya);

  const total_dena = loan.total_qeemat - loan.down_payment;
  const jama = db.prepare(`SELECT SUM(kitna_diya) AS total FROM payments WHERE loan_id = ?`).get(loan_id);
  const ab_tak_diya = jama.total || 0;
  const baqi = total_dena - ab_tak_diya;

  let auto_unlock_hua = false;
  let loan_complete = false;

  if (baqi <= 0) {
    db.prepare(`UPDATE loans SET status = 'completed' WHERE id = ?`).run(loan_id);
    auto_unlock_hua = true;
    loan_complete = true;
  } else {
    db.prepare(`UPDATE loans SET status = 'active', next_due_date = datetime('now', '+30 days') WHERE id = ?`).run(loan_id);
    auto_unlock_hua = true;
  }

  sendPushToLoan(loan_id); // phone ko jagаo

  res.json({
    message: 'Payment add ho gaya!',
    ab_tak_diya: ab_tak_diya,
    baqi: baqi > 0 ? baqi : 0,
    loan_complete: loan_complete,
    auto_unlock_hua: auto_unlock_hua
  });
});


// ===== ROUTE 10: LOAN SUMMARY =====
app.get('/loans/:id/summary', (req, res) => {
  const loanId = req.params.id;
  const loan = db.prepare(`SELECT * FROM loans WHERE id = ?`).get(loanId);
  if (!loan) return res.status(404).json({ error: 'Ye loan nahi mila' });
  const total_dena = loan.total_qeemat - loan.down_payment;
  const jama = db.prepare(`SELECT SUM(kitna_diya) AS total FROM payments WHERE loan_id = ?`).get(loanId);
  const ab_tak_diya = jama.total || 0;
  const baqi = total_dena - ab_tak_diya;
  res.json({
    total_qeemat: loan.total_qeemat,
    down_payment: loan.down_payment,
    total_dena: total_dena,
    ab_tak_diya: ab_tak_diya,
    baqi: baqi > 0 ? baqi : 0,
    status: loan.status
  });
});


// ===== ROUTE 11: LOAN PAYMENTS =====
app.get('/loans/:id/payments', (req, res) => {
  const loanId = req.params.id;
  const payments = db.prepare(`SELECT * FROM payments WHERE loan_id = ? ORDER BY id DESC`).all(loanId);
  res.json(payments);
});


// ===== ROUTE 12: DUE DATE SET =====
app.post('/loans/:id/set-due-date', (req, res) => {
  const loanId = req.params.id;
  const { due_date } = req.body;
  if (!due_date) return res.status(400).json({ error: 'due_date zaroori hai' });
  const command = db.prepare(`UPDATE loans SET next_due_date = ? WHERE id = ?`);
  const result = command.run(due_date, loanId);
  if (result.changes === 0) return res.status(404).json({ error: 'Ye loan nahi mila' });
  sendPushToLoan(loanId); // agar overdue set kiya to phone ko jagаo
  res.json({ message: 'Due date set ho gayi!', due_date: due_date });
});


// ===== ROUTE 13: APP KA TOKEN SAVE =====
app.post('/loans/:id/token', (req, res) => {
  const loanId = req.params.id;
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token zaroori hai' });
  db.prepare('UPDATE loans SET fcm_token = ? WHERE id = ?').run(token, loanId);
  console.log(`Token save hua Loan #${loanId}`);
  res.json({ message: 'Token save ho gaya!' });
});


// ===== CHOWKIDAR: overdue check =====
function chowkidarCheck() {
  const abhi = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const overdueLoans = db.prepare(`SELECT * FROM loans WHERE status = 'active' AND next_due_date IS NOT NULL AND next_due_date <= ?`).all(abhi);
  overdueLoans.forEach(loan => {
    db.prepare(`UPDATE loans SET status = 'locked' WHERE id = ?`).run(loan.id);
    console.log(`AUTO-LOCK! Loan #${loan.id} (${loan.phone_ka_naam}) - phone LOCK!`);
    sendPushToLoan(loan.id); // phone ko jagаo
  });
  if (overdueLoans.length > 0) console.log(`Chowkidar ne ${overdueLoans.length} phone auto-lock kiye.`);
}
setInterval(chowkidarCheck, 30000);
console.log('Chowkidar shuru ho gaya - har 30 second overdue check karega.');


// ===== SERVER START =====
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server chal raha hai: http://localhost:${PORT}`);
  console.log(`Phone se: http://192.168.18.14:${PORT}`);
});