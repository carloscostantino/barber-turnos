/* eslint-disable camelcase */

/**
 * El índice de 009 permitía solo un favorito global; debe ser uno por shop_id.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS services_one_favorite;`);
  pgm.sql(`
    CREATE UNIQUE INDEX services_one_favorite_per_shop
    ON services (shop_id)
    WHERE is_favorite = true;
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS services_one_favorite_per_shop;`);
  pgm.sql(`
    CREATE UNIQUE INDEX services_one_favorite
    ON services ((1))
    WHERE is_favorite = true;
  `);
};
