/* eslint-disable camel_case */

/**
 * Elimina `pending`: migra datos a `confirmed` y reduce el enum a `confirmed` | `cancelled`.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE appointments SET status = 'confirmed' WHERE status::text = 'pending';
  `);
  pgm.sql(`
    ALTER TABLE appointments ALTER COLUMN status DROP DEFAULT;
  `);
  pgm.sql(`
    ALTER TYPE appointment_status RENAME TO appointment_status_old;
  `);
  pgm.sql(`
    CREATE TYPE appointment_status AS ENUM ('confirmed', 'cancelled');
  `);
  pgm.sql(`
    ALTER TABLE appointments
      ALTER COLUMN status TYPE appointment_status
      USING status::text::appointment_status;
  `);
  pgm.sql(`
    DROP TYPE appointment_status_old;
  `);
  pgm.sql(`
    ALTER TABLE appointments ALTER COLUMN status SET DEFAULT 'confirmed';
  `);
};

/**
 * Restaura el enum con `pending` (sin recuperar qué turnos eran pendientes).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE appointments ALTER COLUMN status DROP DEFAULT;
  `);
  pgm.sql(`
    ALTER TYPE appointment_status RENAME TO appointment_status_new;
  `);
  pgm.sql(`
    CREATE TYPE appointment_status AS ENUM ('pending', 'confirmed', 'cancelled');
  `);
  pgm.sql(`
    ALTER TABLE appointments
      ALTER COLUMN status TYPE appointment_status
      USING status::text::appointment_status;
  `);
  pgm.sql(`
    DROP TYPE appointment_status_new;
  `);
  pgm.sql(`
    ALTER TABLE appointments ALTER COLUMN status SET DEFAULT 'pending';
  `);
};
