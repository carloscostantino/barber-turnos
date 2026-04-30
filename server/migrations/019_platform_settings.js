/* eslint-disable camelcase */

/**
 * Configuración global de la plataforma (singleton de una fila). Permite al
 * super-admin editar el precio mensual de la suscripción desde la UI sin
 * tocar variables de entorno ni reiniciar el servicio.
 *
 * - `subscription_price_ars` / `subscription_reason`: valores vigentes que
 *   `createOrGetPreapprovalForShop` usa para crear nuevos preapprovals en MP.
 * - `pending_price_ars` / `pending_effective_at`: cambio de precio programado.
 *   Un job periódico promueve `pending → vigente` cuando `now() >=
 *   pending_effective_at` y llama a MP para actualizar los preapprovals
 *   activos. Si ambos son NULL no hay cambio pendiente.
 *
 * El seed inicial toma los valores por defecto (4999 / "Suscripción Barber
 * Turnos"). Las envs `MP_SUBSCRIPTION_AMOUNT_ARS` / `MP_SUBSCRIPTION_REASON`
 * dejan de ser fuente de verdad a partir de esta migración.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('platform_settings', {
    id: {
      type: 'smallint',
      primaryKey: true,
      default: 1,
      notNull: true,
    },
    subscription_price_ars: {
      type: 'integer',
      notNull: true,
    },
    subscription_reason: {
      type: 'text',
      notNull: true,
    },
    pending_price_ars: {
      type: 'integer',
      notNull: false,
    },
    pending_effective_at: {
      type: 'timestamptz',
      notNull: false,
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('platform_settings', 'platform_settings_singleton', {
    check: 'id = 1',
  });
  pgm.addConstraint('platform_settings', 'platform_settings_pending_paired', {
    check:
      '(pending_price_ars is null and pending_effective_at is null) ' +
      'or (pending_price_ars is not null and pending_effective_at is not null)',
  });
  pgm.addConstraint('platform_settings', 'platform_settings_price_positive', {
    check: 'subscription_price_ars > 0',
  });
  pgm.addConstraint(
    'platform_settings',
    'platform_settings_pending_price_positive',
    {
      check:
        'pending_price_ars is null or pending_price_ars > 0',
    },
  );

  pgm.sql(`
    insert into platform_settings (id, subscription_price_ars, subscription_reason)
    values (1, 4999, 'Suscripción Barber Turnos')
    on conflict (id) do nothing;
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('platform_settings');
};
