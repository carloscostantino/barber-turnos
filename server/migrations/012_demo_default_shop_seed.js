/* eslint-disable camelcase */

/**
 * Asegura datos mínimos del shop demo (`slug = default`) para poder reservar:
 * nombre visible, barbero, servicios, horario y fila de suscripción.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      sid uuid;
    BEGIN
      SELECT id INTO sid FROM shops WHERE slug = 'default' LIMIT 1;
      IF sid IS NULL THEN
        RETURN;
      END IF;

      UPDATE shops SET name = 'Barbería demo' WHERE id = sid;

      UPDATE shop_settings SET shop_name = 'Barbería demo' WHERE shop_id = sid;

      IF NOT EXISTS (SELECT 1 FROM barbers WHERE shop_id = sid) THEN
        INSERT INTO barbers (shop_id, name, active) VALUES (sid, 'Carlos', true);
      ELSE
        UPDATE barbers SET active = true WHERE shop_id = sid AND active = false;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM services WHERE shop_id = sid) THEN
        INSERT INTO services (shop_id, name, duration_minutes, price_cents, active)
        VALUES
          (sid, 'Corte', 30, 5000, true),
          (sid, 'Barba', 20, 3500, true);
      END IF;

      INSERT INTO business_hours (shop_id, day_of_week, is_closed, open_time, close_time)
      SELECT sid, 0, false, '09:00'::time, '19:00'::time
      WHERE NOT EXISTS (SELECT 1 FROM business_hours WHERE shop_id = sid AND day_of_week = 0);
      INSERT INTO business_hours (shop_id, day_of_week, is_closed, open_time, close_time)
      SELECT sid, 1, false, '09:00'::time, '19:00'::time
      WHERE NOT EXISTS (SELECT 1 FROM business_hours WHERE shop_id = sid AND day_of_week = 1);
      INSERT INTO business_hours (shop_id, day_of_week, is_closed, open_time, close_time)
      SELECT sid, 2, false, '09:00'::time, '19:00'::time
      WHERE NOT EXISTS (SELECT 1 FROM business_hours WHERE shop_id = sid AND day_of_week = 2);
      INSERT INTO business_hours (shop_id, day_of_week, is_closed, open_time, close_time)
      SELECT sid, 3, false, '09:00'::time, '19:00'::time
      WHERE NOT EXISTS (SELECT 1 FROM business_hours WHERE shop_id = sid AND day_of_week = 3);
      INSERT INTO business_hours (shop_id, day_of_week, is_closed, open_time, close_time)
      SELECT sid, 4, false, '09:00'::time, '19:00'::time
      WHERE NOT EXISTS (SELECT 1 FROM business_hours WHERE shop_id = sid AND day_of_week = 4);
      INSERT INTO business_hours (shop_id, day_of_week, is_closed, open_time, close_time)
      SELECT sid, 5, false, '09:00'::time, '19:00'::time
      WHERE NOT EXISTS (SELECT 1 FROM business_hours WHERE shop_id = sid AND day_of_week = 5);
      INSERT INTO business_hours (shop_id, day_of_week, is_closed, open_time, close_time)
      SELECT sid, 6, true, NULL, NULL
      WHERE NOT EXISTS (SELECT 1 FROM business_hours WHERE shop_id = sid AND day_of_week = 6);

      INSERT INTO shop_subscriptions (shop_id, provider, status)
      SELECT sid, 'none', 'none'
      WHERE NOT EXISTS (SELECT 1 FROM shop_subscriptions WHERE shop_id = sid);
    END $$;
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`SELECT 1`); /* seed idempotente: sin revert automático */
};
