#!/usr/bin/env node
/**
 * Genera un hash bcrypt (cost 10) para usar en ADMIN_PASSWORD_BCRYPT.
 * Uso: node scripts/hash-admin-password.cjs "tu-contraseña"
 */
const bcrypt = require('bcrypt');

const pwd = process.argv[2];
if (!pwd || pwd.length < 8) {
  console.error('Uso: node scripts/hash-admin-password.cjs "<contraseña (mín. 8 caracteres)>"');
  process.exit(1);
}

bcrypt.hash(pwd, 10, (err, hash) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(hash);
});
