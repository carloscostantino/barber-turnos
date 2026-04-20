/* eslint-disable camelcase */

/**
 * Ventana de prueba por barbería: `trial_ends_at` fija cuándo expira el
 * periodo de prueba. Un job periódico pasa a `suspended` los shops
 * vencidos. `trial_warning_sent_at` evita reenviar el aviso de "tu prueba
 * está por vencer" más de una vez.
 *
 * Back-fill: shops existentes en `trial` sin `trial_ends_at` reciben
 * `created_at + 14 days`.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('shops', {
    trial_ends_at: { type: 'timestamptz', notNull: false },
    trial_warning_sent_at: { type: 'timestamptz', notNull: false },
  });

  pgm.sql(`
    update shops
      set trial_ends_at = coalesce(created_at, now()) + interval '14 days'
      where status = 'trial' and trial_ends_at is null;
  `);

  pgm.createIndex('shops', 'trial_ends_at', { name: 'idx_shops_trial_ends_at' });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex('shops', 'trial_ends_at', { name: 'idx_shops_trial_ends_at' });
  pgm.dropColumn('shops', 'trial_warning_sent_at');
  pgm.dropColumn('shops', 'trial_ends_at');
};
