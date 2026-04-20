## Sistema de turnos para barbería

### Reglas de seguridad para el asistente (PC del trabajo)

Esta máquina es una PC del trabajo gestionada por la empresa. Para evitar que un agente IA intente "desbloquearse" modificando Windows (permisos NTFS, registro, Defender, políticas, firewall, etc.), este repo tiene dos capas de reglas textuales:

- **Nivel repo (automático):** [`.cursor/rules/pc-safety.mdc`](.cursor/rules/pc-safety.mdc) con `alwaysApply: true`. Cursor lo carga solo en cada sesión abierta en este proyecto.
- **Nivel usuario (global, requiere un pegado único):** ver [`docs/CURSOR_USER_RULES.md`](docs/CURSOR_USER_RULES.md). Pegar ese bloque una vez en `Ctrl+,` → *Rules for AI* → **User Rules** para que aplique a todos los proyectos que abras con este usuario de Windows.
- **Hook programático (refuerzo sobre las reglas de texto):** [`.cursor/hooks.json`](.cursor/hooks.json) + [`.cursor/hooks/block-dangerous.js`](.cursor/hooks/block-dangerous.js). Se dispara en `beforeShellExecution`, y si el comando matchea patrones peligrosos (icacls, takeown, reg add/delete, sc create/delete, netsh advfirewall, bcdedit, diskpart, net user, schtasks, Set-MpPreference, `npm install -g`, `Start-Process -Verb RunAs`, etc.) devuelve `permission: "ask"` para que Cursor pida confirmación manual antes de ejecutar. Requiere `node` en `PATH` (ya instalado en esta máquina).

**Recordatorio humano:** si en esta PC un comando falla por permisos, UAC o ExecutionPolicy, **no** le pidas al asistente que lo "arregle". Usar entorno aislado (Docker del proyecto, venv, scope usuario) o pedir al área de IT la habilitación puntual.

### Repositorio en GitHub

- **Remoto `origin`:** `https://github.com/carloscostantino/barber-turnos.git`
- **Convención para el asistente (Cursor):** después de cambios de código, hacer `git add`, `commit` y **intentar** `git push` a `origin` en la rama `main` cuando el usuario lo pida o cuando indique que quiere publicar cambios.
- **Límite técnico:** el `git push` solo funciona si en esta máquina ya está configurada la autenticación con GitHub (por ejemplo Git Credential Manager, token guardado o SSH). Si el push falla por credenciales, el usuario debe ejecutar `git push` una vez en su terminal autenticada o configurar [SSH](https://docs.github.com/en/authentication/connecting-to-github-with-ssh) / [HTTPS + token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

```bash
git remote -v
# origin  https://github.com/carloscostantino/barber-turnos.git (fetch)
# origin  https://github.com/carloscostantino/barber-turnos.git (push)
```

### Panel del sistema (super-admin)

Panel separado del admin de cada barbería. Sirve para ver todas las shops registradas y cambiar su estado (`active` / `trial` / `suspended`). Cuando una shop queda en `suspended`, la reserva pública (`/s/:slug`) responde 404 y el login admin de esa shop devuelve 403.

- **Habilitarlo en Docker Compose (recomendado en esta máquina):** crear un archivo `.env` en la **raíz del repo** (junto al `docker-compose.yml`) con `SYSTEM_ADMIN_PASSWORD=<tu-clave>` (texto plano, mínimo 8 caracteres) o `SYSTEM_ADMIN_PASSWORD_BCRYPT=<hash>` (producción, hash bcrypt — generable con `cd server && npm run hash-admin-password -- "tu-clave"`). Opcional: `SYSTEM_ADMIN_EMAIL=...` solo para mostrar. El `docker-compose.yml` inyecta esas variables al contenedor `api`. Aplicar cambios con `docker compose up -d --build api`. Si no se define ninguna contraseña, el panel queda deshabilitado (503). Este `.env` raíz está en `.gitignore`: **nunca se commitea**.
- **Habilitarlo fuera de Docker (`npm run dev`):** las mismas tres variables van en `server/.env` (mirá `server/.env.example`).
- **Acceso:** `http://localhost:5173/system/login` → contraseña → tabla con barberías (nombre, slug, estado, dueño, suscripción, turnos del mes/total, alta) y link para abrir la reserva pública de cada una. Desde el dropdown de estado podés pasar una shop a `suspended` y vuelve a `active` / `trial` cuando quieras.
- **Endpoints backend:** `POST /api/system/login`, `GET /api/system/shops`, `PATCH /api/system/shops/:id/status`. JWT aparte con `role: 'system_admin'` (issuer `barber-turnos-system`, válido 7 días); no se mezcla con el token admin por shop (keys de `sessionStorage` distintas). El login tiene rate limit dedicado (15 intentos / 15 min por IP).
- **Efecto de `suspended`:** las rutas públicas por slug (`/api/shops/:slug/...`, `availability`, `POST /api/appointments`, `public-settings`) responden 404, y `POST /api/shops/:slug/admin/login` del local suspendido devuelve 403 con `"este local está suspendido, contactá a soporte"`.
- **Aislamiento entre locales (multi-tenant):** todas las rutas del panel admin viven bajo `/api/shops/:slug/admin/...` y el middleware `requireAdmin` valida que el `shopId` del JWT coincida con el local identificado por el `slug` de la URL. Si un admin intenta usar un token emitido para la shop A contra `/shops/B/admin/...`, el servidor responde **403** con `"este token no corresponde a este local"`. El cliente guarda el `shopSlug` junto con el JWT en `sessionStorage` (`barber_turnos_admin_jwt` + `barber_turnos_admin_slug`) y, si detecta que la URL pide otro local, fuerza logout antes de hacer requests.

### Período de prueba (trial → suspended automático)

Cada shop registrada arranca en `status = 'trial'` con una fecha de fin (`trial_ends_at`). Un job periódico suspende automáticamente las que vencieron, y les envía un aviso por email a las que están por vencer (si hay SMTP configurado).

- **Duración y frecuencias (variables de entorno):**
    - `TRIAL_DURATION_DAYS` – días de prueba al registrar (default `14`).
    - `TRIAL_WARNING_DAYS` – cuando faltan ≤ este número de días, se envía un aviso por email al owner, **una sola vez** (default `3`).
    - `TRIAL_JOB_HOURS` – cada cuántas horas corre el job (default `6`). El primer tick se dispara al arrancar el servidor.
- **Qué hace el job (`server/src/trialJob.ts`):**
    - `update shops set status='suspended' where status='trial' and trial_ends_at <= now()`.
    - Para shops con `trial_ends_at` dentro de la ventana de aviso, envía el mail de "tu prueba termina en N días" y marca `trial_warning_sent_at`.
- **API admin:** `GET /api/shops/:slug/admin/trial-status` responde `{ status, trialEndsAt, daysLeft }`. El cliente lo consulta al entrar al panel y muestra un banner cuando el local está en `trial`; si `daysLeft ≤ 3` el banner pasa a color ámbar.
- **Efecto de la expiración:** una shop `suspended` queda fuera de las rutas públicas (404) y el login admin del local devuelve 403 (`"este local está suspendido, contactá a soporte"`). Para reactivarla, cambiar el estado desde el [panel del sistema](#panel-del-sistema-super-admin).
- **Backfill:** la migración `017_shop_trial_ends_at.js` agrega `trial_ends_at` y `trial_warning_sent_at` a `shops`; a las shops existentes en `trial` sin fecha les asigna `created_at + 14 días`.

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
  - `customers` – clientes (name; `phone` único **por local** `shop_id`, no global; email obligatorio en la reserva web; en la base puede ser null en filas antiguas)
  - `appointments` – turnos, con:
    - `barber_id`, `service_id`, `customer_id`
    - `starts_at`, `ends_at`
    - `status` (`confirmed | cancelled`)
    - `attended` (boolean nullable; asistencia marcada desde el panel)
    - `notes`, `created_at`
    - `reminder_email_sent_at` (opcional; cuándo se envió el recordatorio por email)
- **Tipos**
  - `appointment_status` (`confirmed`, `cancelled`) — migración `008` convierte históricos `pending` a `confirmed` y elimina el valor `pending`

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

#### `.env` en la raíz del repo (Docker Compose)

Además del `server/.env` que usa el backend cuando corre fuera de Docker, hay un segundo archivo opcional `.env` en la **raíz del repo**. Docker Compose lo lee automáticamente para resolver las interpolaciones `${VAR:-}` del `docker-compose.yml`. Hoy se usa para las variables del **Panel del sistema**:

- `SYSTEM_ADMIN_PASSWORD` — contraseña del super-admin en texto plano (desarrollo), mínimo 8 caracteres. **XOR** con la siguiente.
- `SYSTEM_ADMIN_PASSWORD_BCRYPT` — hash bcrypt para producción (generar con `cd server && npm run hash-admin-password -- "tu-clave"`).
- `SYSTEM_ADMIN_EMAIL` — solo para mostrar en el panel (opcional).

Este archivo **no se commitea** (está en `.gitignore`). Si no existe o las variables están vacías, el panel del sistema queda deshabilitado (503 en `/api/system/*`).

#### Recordatorios por email (opcional)

Si configurás **SMTP**, el servidor envía **un correo por turno** cuando falta aproximadamente `REMINDER_HOURS_BEFORE` horas para `starts_at` (ventana de ±45 minutos alrededor de ese instante; el job corre cada `REMINDER_POLL_MINUTES` minutos).

- El contenido del recordatorio **no incluye nombre de barbero** (solo cliente, servicio y fecha/hora).
- **Requisito:** el cliente debe tener **email** en la reserva; si no cargó email, no hay recordatorio.
- **Turnos:** solo `confirmed` (no `cancelled`; los cancelados no reciben recordatorio).
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
      - `shopName`: `string | null` — nombre del local (panel Reglas); la reserva y el menú lo usan como título.
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
  - `POST /api/shops/:slug/admin/login`  
    - Body: `{ "password": "<contraseña en texto plano>", "ownerEmail": "<opcional>" }` (la misma que configuraste como `ADMIN_PASSWORD`, la que usaste para generar `ADMIN_PASSWORD_BCRYPT`, o la del owner registrado en `shop_users`).  
    - Respuesta OK: `{ "token": "<jwt>", "expiresInSec": 604800 }` (7 días). El JWT incluye el `shopId` del local identificado por `:slug`.  
    - El cliente guarda `{ token, shopSlug }` en `sessionStorage` y envía `Authorization: Bearer <token>` en las rutas protegidas.
    - Límite de intentos por IP (rate limit) para reducir fuerza bruta.
    - Si el local está `suspended`: **403** con `"este local está suspendido, contactá a soporte"`.

- **Turnos (admin, JWT)** — todos bajo `/api/shops/:slug/admin/...` para que el JWT se valide contra el local de la URL.
  - `GET /api/shops/:slug/admin/appointments?from=<ISO>&to=<ISO>&barberId=<uuid opcional>`  
    - Lista turnos que intersectan el rango; `barberId` opcional para filtrar.
    - Cada fila incluye `service_name`, datos de cliente, `attended` (asistencia, `null`/`true`/`false`) y **no** expone nombre de barbero.
  - `PATCH /api/shops/:slug/admin/appointments/:id/status`  
    - Body: `{ "status": "confirmed" | "cancelled", "cancellationNote"?: "…" }`.  
    - Si pasa a `cancelled` y el cliente tiene email configurado, se intenta enviar correo de cancelación (SMTP).
  - `PATCH /api/shops/:slug/admin/appointments/:id/attendance`  
    - Body: `{ "attended": true | false | null }` — marca si el cliente asistió.

- **Turnos (público)**
  - `POST /api/shops/:slug/appointments` (o `POST /api/appointments` para el local `DEFAULT_SHOP_SLUG`)  
    - Crea un turno para el **barbero activo** del local.
    - Body: `serviceId`, `startsAt` (ISO), `customer` (`name`, `phone`, `email` obligatorio para notificaciones), `notes` opcional.
    - Valida reglas de agenda (anticipación, rango de días, horario, bloqueos, alineación de slot).
    - **503** si no hay barbero activo; **409** si el horario se solapa con otro turno.
    - Si hay **SMTP** configurado, envía correo de confirmación con enlace para cancelar (`/cancelar?token=…`).
  - `POST /api/appointments/cancel-by-token`  
    - Público (sin JWT). Body: `{ "token": "<jwt del enlace de cancelación>" }`. Cancela el turno si sigue `confirmed` y aún no comenzó. Límite por IP.

- **Configuración del negocio (admin, JWT)** — todas las rutas cuelgan de `/api/shops/:slug/admin/...` y validan que el JWT corresponda al local.
  - `GET /api/shops/:slug/admin/shop-settings` / `PUT /api/shops/:slug/admin/shop-settings` — `bookingMinLeadHours`, `bookingMaxDaysAhead`, `shopName`, `contactWhatsapp`, `contactEmail`, `contactAddress` (opcionales; vacío borra el valor en BD).
  - `GET /api/shops/:slug/admin/business-hours` / `PUT /api/shops/:slug/admin/business-hours` — arreglo de 7 días (`dayOfWeek` 0–6, `isClosed`, `openTime`/`closeTime` en `HH:MM` y `openTimeAfternoon`/`closeTimeAfternoon` opcionales para partir el día).
  - `GET /api/shops/:slug/admin/services` — todos los servicios (incluye inactivos); `POST /api/shops/:slug/admin/services` crear; `PATCH /api/shops/:slug/admin/services/:id` actualizar (nombre, duración, precio, `active`, `isFavorite`); `DELETE /api/shops/:slug/admin/services/:id`.
  - `GET /api/shops/:slug/admin/blocked-ranges`; `POST /api/shops/:slug/admin/blocked-ranges` (`startsAt`, `endsAt`, `note` opcional) — **409** si hay turnos activos en ese rango; `DELETE /api/shops/:slug/admin/blocked-ranges/:id`.

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
  - Migraciones hasta `016_business_hours_afternoon.js` (multi-tenant `shops`, seed del demo, dirección por partes, unicidad de `phone` por shop, favoritos por shop, segundo turno en `business_hours`).
  - Multi-tenant con columna `shop_id` en tablas editables; resolución por slug (`/s/:slug`) o `DEFAULT_SHOP_SLUG` para el demo.
  - Disponibilidad y reservas alineadas con **horario de negocio** (con soporte opcional de segundo turno tarde), **bloqueos**, **anticipación mínima** y **máximo de días** adelante.
  - Un solo barbero efectivo por shop; validación de reservas en `scheduling.ts` + solapamiento en transacción.
  - Panel admin por shop: reglas, horarios (con opción "Dos turnos" y **"Aplicar a todos los días"** que respeta los días cerrados), CRUD de servicios y bloqueos, contacto del local (dirección de una sola línea), cancelación con email opcional.
  - Login admin por shop: `ADMIN_PASSWORD` (dev) o `ADMIN_PASSWORD_BCRYPT` (producción); nunca ambas. Shops `suspended` devuelven 403 en login y 404 en rutas públicas.
  - **Panel del sistema** (`/system`) separado, con JWT propio y contraseña vía `SYSTEM_ADMIN_PASSWORD(_BCRYPT)`; permite listar barberías y cambiar su estado (`active` / `trial` / `suspended`).
  - **Demo reset** (`POST /api/demo/reset`): la home llama a este endpoint antes de entrar al demo para dejar el shop por defecto en su estado base (servicios, horarios, reglas, contacto, bloqueos, seed de barbero).
  - Recordatorios y cancelaciones por email según `TIMEZONE` (SMTP opcional).
  - Stripe billing opcional (webhook + cliente) para suscripciones de shops (archivos `stripeBilling.ts`, `stripeWebhook.ts`).

- **Frontend**
  - **`/`** — Home con CTA "Ver demo de reservas" (resetea el shop demo antes de navegar) y "Registrar mi barbería".
  - **`/registrar`** — Onboarding para crear una nueva shop (slug único, datos de contacto, admin inicial).
  - **`/s/:slug`** — Reserva pública para una shop concreta; servicio, fecha (límites según API), slots, cliente; sin barbero en pantalla; WhatsApp post-reserva si aplica.
  - **`/s/:slug/admin`** — Pestañas: turnos del día, reglas de reserva, horario semanal, servicios, bloqueos, contacto del local.
  - **`/system/login`** + **`/system`** — Panel del super-admin (auth aparte).
  - Navegación con `react-router-dom`.

- **Seguridad en la PC del trabajo**
  - Reglas de Cursor a nivel repo (`.cursor/rules/pc-safety.mdc`) y sugerencia de User Rules globales (`docs/CURSOR_USER_RULES.md`) que prohíben al asistente tocar Windows (NTFS, registro, Defender, firewall, políticas).
  - Hook programático `beforeShellExecution` (`.cursor/hooks.json` + `.cursor/hooks/block-dangerous.js`) que intercepta comandos peligrosos y pide confirmación manual (`permission: "ask"`).

### Próximos pasos sugeridos

- Soporte explícito para **varios barberos** en UI y API (si el negocio lo necesita).
- Recordatorios por **SMS** o plantillas de email más ricas.

---

**Nota:** Este `README.md` se irá actualizando a medida que el proyecto evolucione (nuevos endpoints, cambios de modelo, comportamiento del frontend, etc.), para servir como “memoria” de las decisiones y estado del sistema.

