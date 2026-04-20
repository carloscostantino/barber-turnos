/* eslint-disable camelcase */

/**
 * Guarda el `init_point` devuelto por Mercado Pago al crear un preapproval
 * para que el cliente pueda reusarlo sin pedirle a MP volver a crear el flujo
 * de cobro. Es simplemente una URL, por eso `text`.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('shop_subscriptions', {
    init_point: { type: 'text', notNull: false },
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumn('shop_subscriptions', 'init_point');
};
