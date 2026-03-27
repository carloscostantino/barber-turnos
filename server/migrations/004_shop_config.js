/* eslint-disable camelcase */

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumns('barbers', {
    active: { type: 'boolean', notNull: true, default: true },
  });
  pgm.addColumns('services', {
    active: { type: 'boolean', notNull: true, default: true },
  });

  pgm.sql(`
    ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_barber_id_fkey;
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_barber_id_fkey
      FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE RESTRICT;
  `);

  pgm.createTable('shop_settings', {
    id: { type: 'smallint', primaryKey: true },
    booking_min_lead_hours: {
      type: 'int',
      notNull: true,
      default: 2,
    },
    booking_max_days_ahead: {
      type: 'int',
      notNull: true,
      default: 15,
    },
  });
  pgm.sql(`
    ALTER TABLE shop_settings ADD CONSTRAINT shop_settings_id_check CHECK (id = 1);
    ALTER TABLE shop_settings ADD CONSTRAINT shop_settings_min_lead_check
      CHECK (booking_min_lead_hours >= 0 AND booking_min_lead_hours <= 168);
    ALTER TABLE shop_settings ADD CONSTRAINT shop_settings_max_days_check
      CHECK (booking_max_days_ahead >= 1 AND booking_max_days_ahead <= 365);
  `);
  pgm.sql(`
    INSERT INTO shop_settings (id, booking_min_lead_hours, booking_max_days_ahead)
    VALUES (1, 2, 15);
  `);

  pgm.createTable('business_hours', {
    day_of_week: { type: 'smallint', primaryKey: true },
    is_closed: { type: 'boolean', notNull: true, default: false },
    open_time: { type: 'time without time zone' },
    close_time: { type: 'time without time zone' },
  });
  pgm.sql(`
    ALTER TABLE business_hours ADD CONSTRAINT business_hours_dow_check
      CHECK (day_of_week >= 0 AND day_of_week <= 6);
  `);

  // 0=Lun ... 6=Dom — Lun–Sáb 09–19, Dom cerrado
  const days = [
    [0, false, '09:00', '19:00'],
    [1, false, '09:00', '19:00'],
    [2, false, '09:00', '19:00'],
    [3, false, '09:00', '19:00'],
    [4, false, '09:00', '19:00'],
    [5, false, '09:00', '19:00'],
    [6, true, null, null],
  ];
  for (const [dow, closed, open, close] of days) {
    if (closed) {
      pgm.sql(
        `INSERT INTO business_hours (day_of_week, is_closed, open_time, close_time) VALUES (${dow}, true, NULL, NULL);`,
      );
    } else {
      pgm.sql(
        `INSERT INTO business_hours (day_of_week, is_closed, open_time, close_time) VALUES (${dow}, false, '${open}', '${close}');`,
      );
    }
  }

  pgm.createTable('blocked_ranges', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    starts_at: { type: 'timestamptz', notNull: true },
    ends_at: { type: 'timestamptz', notNull: true },
    note: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.sql(`
    ALTER TABLE blocked_ranges ADD CONSTRAINT blocked_ranges_order_check CHECK (ends_at > starts_at);
  `);
  pgm.createIndex('blocked_ranges', 'starts_at', {
    name: 'idx_blocked_ranges_starts_at',
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('blocked_ranges');
  pgm.dropTable('business_hours');
  pgm.dropTable('shop_settings');
  pgm.sql(`
    ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_barber_id_fkey;
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_barber_id_fkey
      FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE CASCADE;
  `);
  pgm.dropColumns('services', ['active']);
  pgm.dropColumns('barbers', ['active']);
};
