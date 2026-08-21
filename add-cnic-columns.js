const db = require('./database');

try {
  db.exec(`ALTER TABLE customers ADD COLUMN cnic_front_photo TEXT`);
  console.log('✅ cnic_front_photo column added');
} catch (e) {
  console.log('⚠️ cnic_front_photo:', e.message);
}

try {
  db.exec(`ALTER TABLE customers ADD COLUMN cnic_back_photo TEXT`);
  console.log('✅ cnic_back_photo column added');
} catch (e) {
  console.log('⚠️ cnic_back_photo:', e.message);
}

console.log('Done! Columns check ho gaye.');