/* eslint-disable camel_case */

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumns('shop_settings', {
    contact_whatsapp: { type: 'text' },
    contact_email: { type: 'text' },
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumns('shop_settings', ['contact_whatsapp', 'contact_email']);
};
