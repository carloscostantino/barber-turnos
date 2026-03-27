/* eslint-disable camelcase */

/**
 * Datos demo: un barbero y dos servicios (idempotente si ya existen por nombre).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO barbers (name)
    SELECT 'Carlos' WHERE NOT EXISTS (SELECT 1 FROM barbers WHERE name = 'Carlos');

    INSERT INTO services (name, duration_minutes, price_cents)
    SELECT 'Corte', 30, 5000
    WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Corte');

    INSERT INTO services (name, duration_minutes, price_cents)
    SELECT 'Barba', 20, 3500
    WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Barba');
  `);
};

/**
 * Quita solo filas seed que no estén referenciadas por turnos (evita CASCADE en barberos).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM services s
    WHERE s.name = 'Barba' AND s.duration_minutes = 20 AND s.price_cents = 3500
      AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.service_id = s.id);

    DELETE FROM services s
    WHERE s.name = 'Corte' AND s.duration_minutes = 30 AND s.price_cents = 5000
      AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.service_id = s.id);

    DELETE FROM barbers b
    WHERE b.name = 'Carlos'
      AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.barber_id = b.id);
  `);
};
