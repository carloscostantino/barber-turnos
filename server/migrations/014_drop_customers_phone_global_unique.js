/* eslint-disable camelcase */

/**
 * `001_init` creó un índice único solo sobre `phone`. En multi-tenant el teléfono debe ser
 * único por local (`customers_shop_phone_key` en `011`), no globalmente: el índice viejo
 * seguía activo y provocaba "duplicate key ... customers_phone_unique_index" al reservar
 * con un número ya usado en otro shop.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS customers_phone_unique_index;
  `);
};

/**
 * No se recrea la unicidad global de `phone` (rompería multi-tenant).
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = () => {};
