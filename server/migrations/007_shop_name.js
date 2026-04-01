/* eslint-disable camel_case */

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumns('shop_settings', {
    shop_name: { type: 'text' },
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumns('shop_settings', ['shop_name']);
};
