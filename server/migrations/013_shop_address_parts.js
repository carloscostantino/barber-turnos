/* eslint-disable camelcase */

/**
 * Partes opcionales de dirección (calle, número, etc.). `contact_address` sigue existiendo como texto libre o respaldo.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumns('shop_settings', {
    address_street: { type: 'text' },
    address_number: { type: 'text' },
    address_floor: { type: 'text' },
    address_city: { type: 'text' },
    address_region: { type: 'text' },
    address_postal_code: { type: 'text' },
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumns('shop_settings', [
    'address_street',
    'address_number',
    'address_floor',
    'address_city',
    'address_region',
    'address_postal_code',
  ]);
};
