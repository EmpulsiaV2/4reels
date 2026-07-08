#!/usr/bin/env node
// Usage: node scripts/create-admin-hash.js yourpassword
const bcrypt = require('bcryptjs');
const pass = process.argv[2];
if (!pass) { console.error('Usage: node scripts/create-admin-hash.js <password>'); process.exit(1); }
bcrypt.hash(pass, 10).then(hash => {
  console.log('\nPaste this into your .env:\n\nADMIN_PASSWORD_HASH='+hash+'\n');
});
