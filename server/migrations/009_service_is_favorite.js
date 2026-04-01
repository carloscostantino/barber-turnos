/* eslint-disable camelcase */

/**
 * Un solo servicio puede ser "favorito" (reserva pública lo selecciona por defecto).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumns('services', {
    is_favorite: { type: 'boolean', notNull: true, default: false },
  });
  pgm.sql(`
    CREATE UNIQUE INDEX services_one_favorite
    ON services ((1))
    WHERE is_favorite = true;
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS services_one_favorite;`);
  pgm.dropColumns('services', ['is_favorite']);
};
