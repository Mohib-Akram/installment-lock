// SQLite tool ko bula rahe hain
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// database file bana/khol rahe hain
const dbPath = process.env.RAILWAY_ENVIRONMENT
  ? '/app/data/installment.db'
  : 'installment.db';

const db = new Database(dbPath);


// =========================================================
// TABLE 0: ADMINS (Super Admin)
// =========================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    naam TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    banaya_gaya TEXT DEFAULT (datetime('now'))
  )
`);


// =========================================================
// TABLE 1: SHOPKEEPERS (dukaandaar)
// =========================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS shopkeepers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    naam TEXT NOT NULL,
    shop_naam TEXT,
    email TEXT UNIQUE,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    banaya_gaya TEXT DEFAULT (datetime('now'))
  )
`);


// =========================================================
// TABLE 2: CUSTOMERS
// =========================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    naam TEXT NOT NULL,
    cnic TEXT,
    phone_number TEXT,
    email TEXT,
    pata TEXT,
    guarantor TEXT,
    banaya_gaya TEXT DEFAULT (datetime('now'))
  )
`);


// =========================================================
// TABLE 3: LOANS
// =========================================================
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


// =========================================================
// TABLE 4: PAYMENTS
// =========================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id INTEGER NOT NULL,
    kitna_diya REAL NOT NULL,
    kab_diya TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (loan_id) REFERENCES loans(id)
  )
`);


// =========================================================
// MIGRATION HELPER
// =========================================================
function columnExists(table, column) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some(col => col.name === column);
}


// =========================================================
// CUSTOMERS → SHOPKEEPER ID
// =========================================================
if (!columnExists('customers', 'shopkeeper_id')) {
  db.exec(`
    ALTER TABLE customers
    ADD COLUMN shopkeeper_id INTEGER
  `);

  console.log('customers table mein shopkeeper_id column add hua.');
}


// =========================================================
// LOANS → SHOPKEEPER ID
// =========================================================
if (!columnExists('loans', 'shopkeeper_id')) {
  db.exec(`
    ALTER TABLE loans
    ADD COLUMN shopkeeper_id INTEGER
  `);

  console.log('loans table mein shopkeeper_id column add hua.');
}


// =========================================================
// DEFAULT SHOPKEEPER
// =========================================================
// Agar koi shopkeeper nahi hai to purane system ke liye
// default shopkeeper create kar do.
const existingShopkeeper = db
  .prepare('SELECT * FROM shopkeepers LIMIT 1')
  .get();

if (!existingShopkeeper) {

  const defaultUsername = 'admin';
  const defaultPassword = 'admin123';

  const passwordHash = bcrypt.hashSync(defaultPassword, 10);

  const result = db.prepare(`
    INSERT INTO shopkeepers
      (naam, shop_naam, email, username, password_hash, status)
    VALUES
      (?, ?, ?, ?, ?, ?)
  `).run(
    'Muhammad Mohib Akram',
    'Qist Manager',
    'admin@example.com',
    defaultUsername,
    passwordHash,
    'active'
  );

  const newShopkeeperId = result.lastInsertRowid;

  console.log(
    `Default shopkeeper bana: username="${defaultUsername}", password="${defaultPassword}"`
  );

  // Purana data pehle shopkeeper ko assign karo
  db.prepare(`
    UPDATE customers
    SET shopkeeper_id = ?
    WHERE shopkeeper_id IS NULL
  `).run(newShopkeeperId);

  db.prepare(`
    UPDATE loans
    SET shopkeeper_id = ?
    WHERE shopkeeper_id IS NULL
  `).run(newShopkeeperId);

  console.log('Purana data default shopkeeper ko assign ho gaya.');
}


// =========================================================
// DEFAULT SUPER ADMIN
// =========================================================
// Agar admin table mein koi admin nahi hai to ek default
// Super Admin automatically create hoga.
const existingAdmin = db
  .prepare('SELECT * FROM admins LIMIT 1')
  .get();

if (!existingAdmin) {

  const adminUsername = 'admin';
  const adminPassword = 'admin123';

  const adminPasswordHash = bcrypt.hashSync(adminPassword, 10);

  db.prepare(`
    INSERT INTO admins
      (naam, username, password_hash, status)
    VALUES
      (?, ?, ?, ?)
  `).run(
    'Super Admin',
    adminUsername,
    adminPasswordHash,
    'active'
  );

  console.log(
    `Default SUPER ADMIN bana: username="${adminUsername}", password="${adminPassword}"`
  );
}


console.log('Database taiyar hai! Saari tables ban gayi hain.');


// =========================================================
// EXPORT DATABASE
// =========================================================
module.exports = db;