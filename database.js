// SQLite tool ko bula rahe hain
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// database file bana/khol rahe hain (ye file khud ban jayegi)
const dbPath = process.env.RAILWAY_ENVIRONMENT ? '/app/data/installment.db' : 'installment.db';
const db = new Database(dbPath);

// ===== TABLE 0: SHOPKEEPERS (dukaandaar ki maloomat) =====
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

// ===== MIGRATION: purane database mein shopkeeper_id column safely add karna =====
function columnExists(table, column) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some(col => col.name === column);
}

if (!columnExists('customers', 'shopkeeper_id')) {
  db.exec(`ALTER TABLE customers ADD COLUMN shopkeeper_id INTEGER`);
  console.log('customers table mein shopkeeper_id column add hua.');
}

if (!columnExists('loans', 'shopkeeper_id')) {
  db.exec(`ALTER TABLE loans ADD COLUMN shopkeeper_id INTEGER`);
  console.log('loans table mein shopkeeper_id column add hua.');
}

// ===== DEFAULT ADMIN/SHOPKEEPER: agar koi shopkeeper nahi to ek bana do =====
// (taake purana data isse assign ho sake, aur aapka apna login ready ho)
const existingShopkeeper = db.prepare('SELECT * FROM shopkeepers LIMIT 1').get();

if (!existingShopkeeper) {
  const defaultUsername = 'admin';
  const defaultPassword = 'admin123'; // ⚠️ ye pehli baar login karke turant badal lena
  const passwordHash = bcrypt.hashSync(defaultPassword, 10);

  const result = db.prepare(`
    INSERT INTO shopkeepers (naam, shop_naam, email, username, password_hash, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('Muhammad Mohib Akram', 'Qist Manager', 'admin@example.com', defaultUsername, passwordHash, 'active');

  const newShopkeeperId = result.lastInsertRowid;
  console.log(`Default shopkeeper bana: username="${defaultUsername}", password="${defaultPassword}" (login ke baad zaroor badlein!)`);

  // purana saara data isi pehle shopkeeper ko assign kar do
  db.prepare(`UPDATE customers SET shopkeeper_id = ? WHERE shopkeeper_id IS NULL`).run(newShopkeeperId);
  db.prepare(`UPDATE loans SET shopkeeper_id = ? WHERE shopkeeper_id IS NULL`).run(newShopkeeperId);
  console.log('Purana data default shopkeeper ko assign ho gaya.');
}

console.log('Database taiyar hai! Saari tables ban gayi hain.');

// is db ko doosri files mein istemal ke liye bahar bhej rahe hain
module.exports = db;