/* eslint-disable camelcase */

/**
 * Multi-tenant: tabla `shops`, `shop_id` en tablas de negocio, `shop_settings` por `shop_id`.
 * Datos existentes se asocian al shop `default`.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('shops', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    slug: { type: 'citext', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    timezone: { type: 'text', notNull: true, default: 'America/Argentina/Buenos_Aires' },
    status: { type: 'text', notNull: true, default: 'active' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.sql(`
    ALTER TABLE shops ADD CONSTRAINT shops_status_check
      CHECK (status IN ('active', 'trial', 'suspended'));
  `);

  pgm.sql(`
    INSERT INTO shops (slug, name) VALUES ('default', 'Barbería');
  `);

  pgm.addColumn('barbers', {
    shop_id: {
      type: 'uuid',
      references: 'shops',
      onDelete: 'CASCADE',
    },
  });
  pgm.sql(`
    UPDATE barbers SET shop_id = (SELECT id FROM shops WHERE slug = 'default');
    ALTER TABLE barbers ALTER COLUMN shop_id SET NOT NULL;
  `);

  pgm.addColumn('services', {
    shop_id: {
      type: 'uuid',
      references: 'shops',
      onDelete: 'CASCADE',
    },
  });
  pgm.sql(`
    UPDATE services SET shop_id = (SELECT id FROM shops WHERE slug = 'default');
    ALTER TABLE services ALTER COLUMN shop_id SET NOT NULL;
  `);

  pgm.sql(`ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_phone_key;`);
  pgm.addColumn('customers', {
    shop_id: {
      type: 'uuid',
      references: 'shops',
      onDelete: 'CASCADE',
    },
  });
  pgm.sql(`
    UPDATE customers SET shop_id = (SELECT id FROM shops WHERE slug = 'default');
    ALTER TABLE customers ALTER COLUMN shop_id SET NOT NULL;
  `);
  pgm.addConstraint('customers', 'customers_shop_phone_key', {
    unique: ['shop_id', 'phone'],
  });

  pgm.addColumn('appointments', {
    shop_id: {
      type: 'uuid',
      references: 'shops',
      onDelete: 'CASCADE',
    },
  });
  pgm.sql(`
    UPDATE appointments SET shop_id = (SELECT id FROM shops WHERE slug = 'default');
    ALTER TABLE appointments ALTER COLUMN shop_id SET NOT NULL;
  `);
  pgm.createIndex('appointments', 'shop_id', { name: 'idx_appointments_shop_id' });

  pgm.addColumn('shop_settings', {
    shop_id: {
      type: 'uuid',
      references: 'shops',
      onDelete: 'CASCADE',
    },
  });
  pgm.sql(`
    UPDATE shop_settings SET shop_id = (SELECT id FROM shops WHERE slug = 'default');
    ALTER TABLE shop_settings ALTER COLUMN shop_id SET NOT NULL;
    ALTER TABLE shop_settings DROP CONSTRAINT IF EXISTS shop_settings_pkey;
    ALTER TABLE shop_settings DROP CONSTRAINT IF EXISTS shop_settings_id_check;
  `);
  pgm.dropColumn('shop_settings', 'id');
  pgm.addConstraint('shop_settings', 'shop_settings_pkey', { primaryKey: 'shop_id' });

  pgm.addColumn('business_hours', {
    shop_id: {
      type: 'uuid',
      references: 'shops',
      onDelete: 'CASCADE',
    },
  });
  pgm.sql(`
    UPDATE business_hours SET shop_id = (SELECT id FROM shops WHERE slug = 'default');
    ALTER TABLE business_hours ALTER COLUMN shop_id SET NOT NULL;
    ALTER TABLE business_hours DROP CONSTRAINT IF EXISTS business_hours_pkey;
  `);
  pgm.addConstraint('business_hours', 'business_hours_pkey', {
    primaryKey: ['shop_id', 'day_of_week'],
  });

  pgm.addColumn('blocked_ranges', {
    shop_id: {
      type: 'uuid',
      references: 'shops',
      onDelete: 'CASCADE',
    },
  });
  pgm.sql(`
    UPDATE blocked_ranges SET shop_id = (SELECT id FROM shops WHERE slug = 'default');
    ALTER TABLE blocked_ranges ALTER COLUMN shop_id SET NOT NULL;
  `);
  pgm.createIndex('blocked_ranges', 'shop_id', { name: 'idx_blocked_ranges_shop_id' });

  pgm.createTable('shop_users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    shop_id: { type: 'uuid', notNull: true, references: 'shops', onDelete: 'CASCADE' },
    email: { type: 'citext', notNull: true },
    password_hash: { type: 'text', notNull: true },
    role: { type: 'text', notNull: true, default: 'owner' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('shop_users', 'shop_users_shop_email_key', {
    unique: ['shop_id', 'email'],
  });
  pgm.sql(`
    ALTER TABLE shop_users ADD CONSTRAINT shop_users_role_check
      CHECK (role IN ('owner', 'staff'));
  `);

  pgm.createTable('shop_subscriptions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    shop_id: { type: 'uuid', notNull: true, references: 'shops', onDelete: 'CASCADE' },
    provider: { type: 'text', notNull: true },
    external_customer_id: { type: 'text' },
    external_subscription_id: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'none' },
    current_period_end: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('shop_subscriptions', 'shop_subscriptions_shop_unique', { unique: ['shop_id'] });
  pgm.sql(`
    ALTER TABLE shop_subscriptions ADD CONSTRAINT shop_subscriptions_provider_check
      CHECK (provider IN ('none', 'stripe', 'mercadopago'));
    ALTER TABLE shop_subscriptions ADD CONSTRAINT shop_subscriptions_status_check
      CHECK (status IN ('none', 'trialing', 'active', 'past_due', 'canceled', 'unpaid'));
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('shop_subscriptions');
  pgm.dropTable('shop_users');
  pgm.dropColumn('blocked_ranges', 'shop_id');
  pgm.sql(`
    ALTER TABLE business_hours DROP CONSTRAINT business_hours_pkey;
    ALTER TABLE business_hours DROP COLUMN shop_id;
  `);
  pgm.addConstraint('business_hours', 'business_hours_pkey', { primaryKey: 'day_of_week' });
  pgm.sql(`
    ALTER TABLE shop_settings DROP CONSTRAINT shop_settings_pkey;
    ALTER TABLE shop_settings ADD COLUMN id smallint;
    UPDATE shop_settings SET id = 1;
    ALTER TABLE shop_settings ALTER COLUMN id SET NOT NULL;
    ALTER TABLE shop_settings ADD CONSTRAINT shop_settings_pkey PRIMARY KEY (id);
    ALTER TABLE shop_settings ADD CONSTRAINT shop_settings_id_check CHECK (id = 1);
    ALTER TABLE shop_settings DROP COLUMN shop_id;
  `);
  pgm.dropColumn('appointments', 'shop_id');
  pgm.dropConstraint('customers', 'customers_shop_phone_key');
  pgm.dropColumn('customers', 'shop_id');
  pgm.sql(`ALTER TABLE customers ADD CONSTRAINT customers_phone_key UNIQUE (phone);`);
  pgm.dropColumn('services', 'shop_id');
  pgm.dropColumn('barbers', 'shop_id');
  pgm.dropTable('shops');
};
