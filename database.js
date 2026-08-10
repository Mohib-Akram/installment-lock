// SQLite tool ko bula rahe hain
const Database = require('better-sqlite3');

// database file bana/khol rahe hain (ye file khud ban jayegi)
const db = new Database('installment.db');

// ===== TABLE 1: CUSTOMERS (customers ki maloomat) =====
db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    naam TEXT NOT NULL,
    cnic TEXT,
    phone_number TEXT,
    pata TEXT,
    guarantor TEXT,
    banaya_gaya TEXT DEFAULT (datetime('now'))
  )
`);

// ===== TABLE 2: LOANS (har loan ki tafseel) =====
db.exec(`
  CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    phone_ka_naam TEXT,
    imei TEXT,
    total_qeemat REAL NOT NULL,
    down_payment REAL DEFAULT 0,
    kitni_installment INTEGER NOT NULL,
    per_month REAL NOT NULL,
    status TEXT DEFAULT 'active',
    next_due_date TEXT,
    fcm_token TEXT,
    banaya_gaya TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  )
`);

// ===== TABLE 3: PAYMENTS (har payment ka record) =====
db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id INTEGER NOT NULL,
    kitna_diya REAL NOT NULL,
    kab_diya TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (loan_id) REFERENCES loans(id)
  )
`);

console.log('Database taiyar hai! Saari tables ban gayi hain.');

// is db ko doosri files mein istemal ke liye bahar bhej rahe hain
module.exports = db;