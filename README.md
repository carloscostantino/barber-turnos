## Sistema de turnos para barbería

### Repositorio en GitHub

- **Remoto `origin`:** `https://github.com/carloscostantino/barber-turnos.git`
- **Convención para el asistente (Cursor):** después de cambios de código, hacer `git add`, `commit` y **intentar** `git push` a `origin` en la rama `main` cuando el usuario lo pida o cuando indique que quiere publicar cambios.
- **Límite técnico:** el `git push` solo funciona si en esta máquina ya está configurada la autenticación con GitHub (por ejemplo Git Credential Manager, token guardado o SSH). Si el push falla por credenciales, el usuario debe ejecutar `git push` una vez en su terminal autenticada o configurar [SSH](https://docs.github.com/en/authentication/connecting-to-github-with-ssh) / [HTTPS + token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

```bash
git remote -v
# origin  https://github.com/carloscostantino/barber-turnos.git (fetch)
# origin  https://github.com/carloscostantino/barber-turnos.git (push)
```

---

Aplicación fullstack para gestionar turnos de una **barbería con un solo operario** en la práctica: el cliente y el panel admin **no ven nombre de barbero**; la reserva usa el barbero activo en base. Incluye servicios, clientes, horario semanal, bloqueos de agenda, reglas de anticipación y rango de días, con backend Node/Express + Postgres y frontend React/Vite.

### Stack técnico

- **Backend (`server`)**
  - Node.js + TypeScript
  - Express 5
  - Postgres 16 (Docker)
  - `node-pg-migrate` para migraciones
  - Validación con `zod`
  - Agenda y disponibilidad con `luxon` (`scheduling.ts`: horario de negocio, bloqueos, límites de reserva)
  - Dockerfile propio para imagen `barber-turnos-api`
- **Frontend (`client`)**
  - React 19 + Vite
  - Reserva pública: servicio, fecha (con límites), horarios y datos del cliente; sin selector de barbero
  - Dockerfile propio para imagen `barber-turnos-web`
- **Infra**
  - Docker Compose con servicios:
    - `db` (Postgres)
    - `mailpit` (SMTP de prueba + UI en el puerto 8025)
    - `api` (backend; en Compose apunta el SMTP a `mailpit`)
    - `web` (frontend)

### Estructura del proyecto

- `package.json` (raíz): monorepo con workspaces:
  - `client/` – frontend React/Vite
  - `server/` – backend API
- `docker-compose.yml` – Postgres, API, web y Mailpit (SMTP local para recordatorios)
- `playwright.config.ts`, carpeta `e2e/` – pruebas end-to-end
- `server/`
  - `package.json`, `tsconfig.json`
  - `.env.example` → se copia a `.env`
  - `migrations/001_init.js` – esquema inicial; `002_seed.js` datos demo; `003_appointment_reminder_email.js` columna `reminder_email_sent_at`; `004_shop_config.js` reglas de reserva, horario semanal, bloqueos, `active` en barberos/servicios
  - `src/`
    - `env.ts` – carga y valida variables de entorno con `zod`
    - `db.ts` – pool de conexión a Postgres
    - `index.ts` – arranque del servidor Express
    - `routes.ts` – rutas HTTP principales
    - `adminAuth.ts` – JWT del panel y middleware `requireAdmin`
    - `api.ts` – consultas reutilizables a la base
    - `scheduling.ts` – `shop_settings`, `business_hours`, slots disponibles, validación de reservas
    - `validation.ts` – esquemas de validación (body/query)
- `client/`
  - `src/main.tsx`, `src/App.tsx` – template inicial de Vite/React

### Base de datos (estado actual)

Postgres 16 corriendo en Docker con:

- **Extensiones**
  - `pgcrypto` (UUID por `gen_random_uuid()`)
  - `citext`
- **Tablas**
  - `barbers` – barberos (`active`; en la UI pública se usa el primero activo; borrar barbero con turnos puede estar restringido por FK)
  - `services` – servicios (nombre, duración en minutos, precio en centavos, `active`; cambiar duración no reescribe turnos ya guardados)
  - `shop_settings` – fila `id = 1`: `booking_min_lead_hours`, `booking_max_days_ahead` (p. ej. 2 h y 15 días por defecto)
  - `business_hours` – una fila por día (`day_of_week` 0 = lunes … 6 = domingo): cerrado o rango `open_time` / `close_time`
  - `blocked_ranges` – intervalos donde no se ofrecen turnos (`starts_at`, `ends_at`, nota opcional); no se puede insertar un bloqueo si ya hay turnos activos solapados
  - `customers` – clientes (name, phone único, email obligatorio en la reserva web; en la base puede ser null en filas antiguas)
  - `appointments` – turnos, con:
    - `barber_id`, `service_id`, `customer_id`
    - `starts_at`, `ends_at`
    - `status` (`pending | confirmed | cancelled`)
    - `notes`, `created_at`
    - `reminder_email_sent_at` (opcional; cuándo se envió el recordatorio por email)
- **Tipos**
  - `appointment_status` (`pending`, `confirmed`, `cancelled`)

La migración inicial está en `server/migrations/001_init.js` y ya fue aplicada una vez sobre la base `barber_turnos`.

### Variables de entorno (`server/.env`)

Basadas en `server/.env.example`:

- `DATABASE_URL=postgres://barber:barber@localhost:5432/barber_turnos`
- `PORT=3001`
- `CLIENT_ORIGIN=http://localhost:5173`
- `TIMEZONE=America/Argentina/Buenos_Aires`
- `WHATSAPP_NUMBER` — opcional; número de WhatsApp del negocio **solo dígitos** (código país, sin `+`). **Respaldo:** si en el panel (Reglas) no cargaste WhatsApp en `shop_settings`, la API usa este valor para `GET /api/public-settings` y el enlace en la confirmación de reserva.
- **SMTP / recordatorios** — opcional; `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `REMINDER_HOURS_BEFORE` (default 24), `REMINDER_POLL_MINUTES` (default 15). Detalle en la subsección **Recordatorios por email**.
- `JWT_SECRET` — mínimo 16 caracteres; firma el JWT del panel admin.
- **Autenticación del admin (elegí una opción, no ambas):**
  - `ADMIN_PASSWORD` — mínimo 8 caracteres; contraseña en **texto plano** (cómodo en desarrollo local).
  - `ADMIN_PASSWORD_BCRYPT` — hash **bcrypt** de la contraseña (recomendado en producción). Generar: `cd server && npm run hash-admin-password -- "tu-clave"` y pegar la línea que imprime en el `.env`.

En **Docker Compose**, `api` usa por defecto `ADMIN_PASSWORD=admin12345` para desarrollo; en producción definí `JWT_SECRET` y preferiblemente `ADMIN_PASSWORD_BCRYPT` (sin `ADMIN_PASSWORD`) en un `.env` junto al `docker-compose.yml` o en el orquestador.

#### Recordatorios por email (opcional)

Si configurás **SMTP**, el servidor envía **un correo por turno** cuando falta aproximadamente `REMINDER_HOURS_BEFORE` horas para `starts_at` (ventana de ±45 minutos alrededor de ese instante; el job corre cada `REMINDER_POLL_MINUTES` minutos).

- El contenido del recordatorio **no incluye nombre de barbero** (solo cliente, servicio y fecha/hora).
- **Requisito:** el cliente debe tener **email** en la reserva; si no cargó email, no hay recordatorio.
- **Turnos:** solo `pending` o `confirmed` (no `cancelled`).
- **Cancelación desde el panel:** si el admin pasa un turno a `cancelled` y el cliente tenía email, se intenta enviar un correo de cancelación (mismo SMTP).
- **Variables:** `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (remitente). Si falta SMTP, la API arranca igual y en consola verás que los recordatorios están deshabilitados.
- **Coste:** el envío no es “gratis ilimitado”; los proveedores (Brevo, Resend, Gmail con contraseña de aplicación, etc.) suelen tener **capas gratuitas con límites**; revisá su documentación.

### Endpoints actuales del backend

Todos los endpoints de negocio están colgados bajo `/api`.

- **Salud**
  - `GET /health`  
    - Verifica que la API responde y que la DB está accesible.

- **Catálogos y configuración pública**
  - `GET /api/barbers`  
    - Lista **solo el barbero activo** usado para reservas: `[{ "id": "<uuid>" }]` (sin `name` en la respuesta pública).
  - `GET /api/services`  
    - Lista de servicios **activos** (`id`, `name`, `duration_minutes`, `price_cents`).
  - `GET /api/public-settings`  
    - Sin autenticación. Devuelve, entre otros:
      - `whatsappNumber`: `string | null` — primero el WhatsApp guardado en `shop_settings` (panel Reglas); si no hay, `WHATSAPP_NUMBER` del entorno.
      - `contactEmail`: `string | null` — email de contacto del local desde `shop_settings` (opcional).
      - `contactAddress`: `string | null` — dirección física del local (opcional); en la reserva se muestra con enlace a Google Maps.
      - `barberId`: uuid del barbero activo o `null` si ninguno
      - `timezone`: valor de `TIMEZONE`
      - `bookingMinLeadHours`, `bookingMaxDaysAhead`: reglas desde `shop_settings`

- **Disponibilidad**
  - `GET /api/availability?serviceId=<uuid>&date=YYYY-MM-DD`  
    - Calcula **slots** para el **barbero activo**, el servicio y la fecha (zona horaria `TIMEZONE`).
    - Respeta `business_hours`, `blocked_ranges`, `booking_min_lead_hours`, `booking_max_days_ahead`, turnos ya ocupados y pasos de **15 minutos**.
    - Devuelve: `timezone`, `service`, `slots` (`{ startsAt, endsAt }` en ISO).
    - Si no hay barbero activo: **503**.

- **Panel admin (auth)**
  - `POST /api/admin/login`  
    - Body: `{ "password": "<contraseña en texto plano>" }` (la misma que configuraste como `ADMIN_PASSWORD` o la que usaste para generar `ADMIN_PASSWORD_BCRYPT`).  
    - Respuesta OK: `{ "token": "<jwt>", "expiresInSec": 604800 }` (7 días).  
    - El cliente guarda el token en `sessionStorage` y lo envía como `Authorization: Bearer <token>` en las rutas protegidas.

- **Turnos**
  - `GET /api/appointments?from=<ISO>&to=<ISO>&barberId=<uuid opcional>`  
    - **Requiere** cabecera `Authorization: Bearer <jwt>`.  
    - Lista turnos que intersectan el rango; `barberId` opcional para filtrar.
    - Cada fila incluye `service_name`, datos de cliente y **no** expone nombre de barbero.
  - `POST /api/appointments`  
    - Crea un turno para el **barbero activo** (el cliente no envía `barberId`).
    - Body: `serviceId`, `startsAt` (ISO), `customer` (`name`, `phone`, `email` obligatorio para notificaciones), `notes` opcional.
    - Valida reglas de agenda (anticipación, rango de días, horario, bloqueos, alineación de slot).
    - **503** si no hay barbero activo; **409** si el horario se solapa con otro turno.
  - `PATCH /api/appointments/:id/status`  
    - **Requiere** `Authorization: Bearer <jwt>`.  
    - Body: `{ "status": "pending" | "confirmed" | "cancelled" }`.  
    - Si pasa a `cancelled` y el cliente tiene email configurado, se intenta enviar correo de cancelación (SMTP).

- **Configuración del negocio (admin, JWT)**
  - `GET /api/admin/shop-settings` / `PUT /api/admin/shop-settings` — `bookingMinLeadHours`, `bookingMaxDaysAhead`, `contactWhatsapp`, `contactEmail`, `contactAddress` (opcionales; vacío borra el valor en BD).
  - `GET /api/admin/business-hours` / `PUT /api/admin/business-hours` — arreglo de 7 días (`dayOfWeek` 0–6, `isClosed`, `openTime`/`closeTime` en `HH:MM` o `null` si cerrado).
  - `GET /api/admin/services` — todos los servicios (incluye inactivos); `POST /api/admin/services` crear; `PATCH /api/admin/services/:id` actualizar (nombre, duración, precio, `active`).
  - `GET /api/admin/blocked-ranges`; `POST /api/admin/blocked-ranges` (`startsAt`, `endsAt`, `note` opcional) — **409** si hay turnos activos en ese rango; `DELETE /api/admin/blocked-ranges/:id`.

### Seeds / datos iniciales

La migración `server/migrations/002_seed.js` inserta datos demo **si aún no existen** (mismo nombre en `barbers` / `services`):

- Barbero: `Carlos`
- Servicios: `Corte` (30 min, 5000 centavos), `Barba` (20 min, 3500 centavos)

Se aplica con el resto de migraciones (`npm run migrate` en `server/` o al arrancar la API en Docker). Si ya cargaste esos datos a mano, la migración no duplica filas.

`npm run migrate:down` en `server/` revierte la última migración; el `down` de `002_seed` solo borra esas filas cuando **no** hay turnos que las referencien.

### Cómo levantar el proyecto

Requisitos:

- Docker + Docker Compose
- (Opcional) Node.js si querés seguir usando `npm run dev` fuera de Docker

#### 1. Levantar TODO con Docker (db + api + web)

Desde la raíz del proyecto:

```bash
cd C:\Users\CarlosCostantino\barber-turnos
docker compose up -d --build
```

Servicios:

- **db**: Postgres 16, puerto `5432`.
- **api**: backend en `http://localhost:3001`
  - Usa `DATABASE_URL=postgres://barber:barber@db:5432/barber_turnos`.
  - Corre migraciones automáticamente al arrancar (`npm run migrate && node dist/index.js`).
- **web**: frontend en `http://localhost:5173`
  - Vite se levanta dentro del contenedor, expuesto a tu máquina.
  - Consume la API usando `VITE_API_BASE=http://localhost:3001/api`.
  - Panel admin (Docker): contraseña por defecto `admin12345` vía `ADMIN_PASSWORD` si no definís variables en `.env` (en producción usá `ADMIN_PASSWORD_BCRYPT` y otra clave).
- **mailpit**: SMTP local para desarrollo (captura los correos, no salen a internet).
  - UI para ver mensajes: `http://localhost:8025`
  - SMTP expuesto en el host: `127.0.0.1:1025`
  - El contenedor **api** usa `SMTP_HOST=mailpit` y credenciales dummy (`local` / `local`) para activar recordatorios por email sin configurar un proveedor real.
- **API fuera de Docker** (`npm run dev` en `server/`): si levantás Mailpit con Compose, en `server/.env` usá `SMTP_HOST=127.0.0.1` y el mismo puerto `1025` (el host mapea el puerto del contenedor).

Para ver logs:

```bash
docker compose logs -f api
docker compose logs -f web
docker compose logs -f db
docker compose logs -f mailpit
```

Para apagar todo:

```bash
docker compose down
```

#### 2. Alternativa: desarrollo “local” (sin Docker para api/web)

Si preferís un ciclo de desarrollo más rápido mientras editás código:

1. DB con Docker (solo `db`):

   ```bash
   cd C:\Users\CarlosCostantino\barber-turnos
   docker compose up -d db
   ```

2. Backend local:

   ```bash
   cd server
   copy .env.example .env   # (en Windows) o cp en shells tipo bash
   npm install
   npm run migrate
   npm run dev
   ```

3. Frontend local:

   ```bash
   cd client
   npm install
   npm run dev
   ```

   - UI en: `http://localhost:5173`
   - API en: `http://localhost:3001`

### Despliegue en producción (checklist)

- **HTTPS** en el dominio del front y, si aplica, del API (reverse proxy o hosting gestionado).
- **CORS:** `CLIENT_ORIGIN` en la API debe coincidir **exactamente** con la URL del navegador (esquema `https`, host y puerto si no es 443/80). Si el front y el API están en distintos orígenes, el cliente ya usa `VITE_API_BASE` apuntando al prefijo `/api` público.
- **Build del frontend:** Vite inyecta variables en **tiempo de build**. Definí `VITE_API_BASE` (p. ej. `https://api.tudominio.com/api`) al ejecutar `npm run build` en `client/` o vía `docker build`/`ARG` según tu pipeline.
- **Secretos:** `JWT_SECRET` largo y aleatorio; admin con `ADMIN_PASSWORD_BCRYPT` (no texto plano); `DATABASE_URL` apuntando a Postgres gestionado con TLS si el proveedor lo exige.
- **WhatsApp:** podés cargar el número en **Panel → Reglas → Contacto del local** (persistido en BD); si no, definí `WHATSAPP_NUMBER` como respaldo (mismo formato: solo dígitos, código país).
- **Recordatorios por email:** SMTP de producción y `MAIL_FROM`; ver límites del proveedor.

### Tests E2E (Playwright)

En la **raíz** del monorepo:

```bash
npm install
npx playwright install chromium   # una vez por máquina (o npm run test:e2e:install)
```

Requisitos: **Postgres** con el `DATABASE_URL` de `server/.env` (p. ej. `docker compose up -d db`). Si tu `.env` no tiene `JWT_SECRET` / `ADMIN_PASSWORD`, Playwright inyecta valores solo para levantar el API de prueba; el login del test usa `E2E_ADMIN_PASSWORD` o `admin12345`.

- Playwright levanta **`npm run dev:e2e`**: API en **3002**, Vite en **5174** y `VITE_API_BASE` → ese API (no pisa Docker en 3001/5173). CORS: `CLIENT_ORIGIN=http://127.0.0.1:5174`.
- Si querés reutilizar un servidor ya levantado en 5174: `PW_TEST_REUSE_SERVER=1` (tiene que ser el mismo código que estás testeando).

Comandos:

```bash
npm run test:e2e          # headless
npm run test:e2e:headed   # con ventana
npm run test:e2e:ui       # modo interactivo
```

Variable opcional: **`E2E_ADMIN_PASSWORD`** — si no está definida, los tests usan `admin12345` (valor por defecto de Docker Compose).

**401 en `/api/appointments` en el panel:** suele ser un JWT viejo tras cambiar `JWT_SECRET` o reconstruir la API. El cliente borra el token y **recarga la página** para mostrar el login de nuevo. Si seguís viendo código viejo en el navegador, reconstruí el front: `docker compose build --no-cache web && docker compose up -d web`.

### Estado actual del desarrollo

- **Backend**
  - Migraciones hasta `004_shop_config.js` (reglas, horario semanal, bloqueos, flags `active`).
  - Disponibilidad y reservas alineadas con **horario de negocio**, **bloqueos**, **anticipación mínima** y **máximo de días** adelante.
  - Un solo barbero efectivo para la web (`active`); validación de reservas en `scheduling.ts` + solapamiento en transacción.
  - Panel admin: reglas, horarios, CRUD de servicios y bloqueos; cancelación con email opcional.
  - Login: `ADMIN_PASSWORD` (dev) o `ADMIN_PASSWORD_BCRYPT` (producción); nunca ambas.
  - Recordatorios y cancelaciones por email según `TIMEZONE` (SMTP opcional).

- **Frontend**
  - **`/`** — Reserva: servicio, fecha (límites según API), slots, cliente; sin barbero en pantalla; WhatsApp post-reserva si aplica.
  - **`/admin`** — Pestañas: turnos del día, reglas de reserva, horario semanal, servicios, bloqueos.
  - Navegación con `react-router-dom`.

### Próximos pasos sugeridos

- Soporte explícito para **varios barberos** en UI y API (si el negocio lo necesita).
- Recordatorios por **SMS** o plantillas de email más ricas.

---

**Nota:** Este `README.md` se irá actualizando a medida que el proyecto evolucione (nuevos endpoints, cambios de modelo, comportamiento del frontend, etc.), para servir como “memoria” de las decisiones y estado del sistema.

