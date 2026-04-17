/* eslint-disable camelcase */

/**
 * Segundo tramo horario (tarde) opcional; si ambas columnas son null, un solo tramo como antes.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumns('business_hours', {
    open_time_afternoon: { type: 'time without time zone' },
    close_time_afternoon: { type: 'time without time zone' },
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumns('business_hours', ['open_time_afternoon', 'close_time_afternoon']);
};
