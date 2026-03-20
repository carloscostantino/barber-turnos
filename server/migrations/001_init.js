/* eslint-disable camelcase */

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createExtension('pgcrypto', { ifNotExists: true });
  pgm.createExtension('citext', { ifNotExists: true });

  pgm.createTable('barbers', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('services', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    duration_minutes: { type: 'int', notNull: true },
    price_cents: { type: 'int', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('customers', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    phone: { type: 'text', notNull: true },
    email: { type: 'citext' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('customers', ['phone'], { unique: true });

  pgm.createType('appointment_status', ['pending', 'confirmed', 'cancelled']);

  pgm.createTable('appointments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    barber_id: {
      type: 'uuid',
      notNull: true,
      references: '"barbers"',
      onDelete: 'cascade',
    },
    service_id: {
      type: 'uuid',
      notNull: true,
      references: '"services"',
      onDelete: 'restrict',
    },
    customer_id: {
      type: 'uuid',
      notNull: true,
      references: '"customers"',
      onDelete: 'cascade',
    },
    starts_at: { type: 'timestamptz', notNull: true },
    ends_at: { type: 'timestamptz', notNull: true },
    status: { type: 'appointment_status', notNull: true, default: 'pending' },
    notes: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('appointments', ['barber_id', 'starts_at']);
  pgm.createIndex('appointments', ['customer_id', 'starts_at']);

  pgm.sql(`
    alter table appointments
    add constraint appointments_time_order check (ends_at > starts_at);
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('appointments');
  pgm.dropType('appointment_status');
  pgm.dropTable('customers');
  pgm.dropTable('services');
  pgm.dropTable('barbers');
};

