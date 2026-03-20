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

Aplicación fullstack para gestionar turnos de una barbería: barberos, servicios, clientes y reservas, con backend en Node/Express + Postgres y frontend en React/Vite.

### Stack técnico

- **Backend (`server`)**
  - Node.js + TypeScript
  - Express 5
  - Postgres 16 (Docker)
  - `node-pg-migrate` para migraciones
  - Validación con `zod`
  - Dockerfile propio para imagen `barber-turnos-api`
- **Frontend (`client`)**
  - React 19 + Vite
  - UI de reserva básica (selección de barbero/servicio/fecha/horario + datos cliente)
  - Dockerfile propio para imagen `barber-turnos-web`
- **Infra**
  - Docker Compose con servicios:
    - `db` (Postgres)
    - `api` (backend)
    - `web` (frontend)

### Estructura del proyecto

- `package.json` (raíz): monorepo con workspaces:
  - `client/` – frontend React/Vite
  - `server/` – backend API
- `docker-compose.yml` – servicio de base de datos Postgres
- `server/`
  - `package.json`, `tsconfig.json`
  - `.env.example` → se copia a `.env`
  - `migrations/001_init.js` – migración inicial con esquema de turnos
  - `src/`
    - `env.ts` – carga y valida variables de entorno con `zod`
    - `db.ts` – pool de conexión a Postgres
    - `index.ts` – arranque del servidor Express
    - `routes.ts` – rutas HTTP principales
    - `adminAuth.ts` – JWT del panel y middleware `requireAdmin`
    - `api.ts` – consultas reutilizables a la base
    - `validation.ts` – esquemas de validación (body/query)
- `client/`
  - `src/main.tsx`, `src/App.tsx` – template inicial de Vite/React

### Base de datos (estado actual)

Postgres 16 corriendo en Docker con:

- **Extensiones**
  - `pgcrypto` (UUID por `gen_random_uuid()`)
  - `citext`
- **Tablas**
  - `barbers` – barberos
  - `services` – servicios (nombre, duración en minutos, precio en centavos)
  - `customers` – clientes (name, phone único, email opcional)
  - `appointments` – turnos, con:
    - `barber_id`, `service_id`, `customer_id`
    - `starts_at`, `ends_at`
    - `status` (`pending | confirmed | cancelled`)
    - `notes`, `created_at`
- **Tipos**
  - `appointment_status` (`pending`, `confirmed`, `cancelled`)

La migración inicial está en `server/migrations/001_init.js` y ya fue aplicada una vez sobre la base `barber_turnos`.

### Variables de entorno (`server/.env`)

Basadas en `server/.env.example`:

- `DATABASE_URL=postgres://barber:barber@localhost:5432/barber_turnos`
- `PORT=3001`
- `CLIENT_ORIGIN=http://localhost:5173`
- `TIMEZONE=America/Argentina/Buenos_Aires`
- `WHATSAPP_NUMBER=5491112345678` (placeholder para uso futuro)
- `JWT_SECRET` — mínimo 16 caracteres; firma el JWT del panel admin.
- `ADMIN_PASSWORD` — mínimo 8 caracteres; contraseña del login en `/admin`.

En **Docker Compose**, `api` define valores por defecto para desarrollo; en producción definí `JWT_SECRET` y `ADMIN_PASSWORD` en un `.env` junto al `docker-compose.yml` o en el orquestador.

### Endpoints actuales del backend

Todos los endpoints de negocio están colgados bajo `/api`.

- **Salud**
  - `GET /health`  
    - Verifica que la API responde y que la DB está accesible.

- **Catálogos**
  - `GET /api/barbers`  
    - Lista de barberos (`id`, `name`).
  - `GET /api/services`  
    - Lista de servicios (`id`, `name`, `duration_minutes`, `price_cents`).

- **Disponibilidad**
  - `GET /api/availability?barberId=<uuid>&serviceId=<uuid>&date=YYYY-MM-DD`  
    - Calcula **slots disponibles** para un barbero y servicio en una fecha dada.
    - Asume horario de trabajo 09:00–19:00, pasos de 15 minutos.
    - Devuelve:
      - `timezone` (desde `TIMEZONE`)
      - `service` (datos del servicio)
      - `slots`: array de `{ startsAt, endsAt }` en ISO (UTC).

- **Panel admin (auth)**
  - `POST /api/admin/login`  
    - Body: `{ "password": "<ADMIN_PASSWORD>" }`.  
    - Respuesta OK: `{ "token": "<jwt>", "expiresInSec": 604800 }` (7 días).  
    - El cliente guarda el token en `sessionStorage` y lo envía como `Authorization: Bearer <token>` en las rutas protegidas.

- **Turnos**
  - `GET /api/appointments?barberId=<uuid>&from=<ISO>&to=<ISO>`  
    - **Requiere** cabecera `Authorization: Bearer <jwt>`.  
    - Lista turnos que intersectan el rango `[from, to)`; opcionalmente filtra por `barberId`.
    - Cada fila incluye datos del barbero, servicio y cliente (`barber_name`, `service_name`, `customer_name`, `customer_phone`, `customer_email`).
  - `POST /api/appointments`  
    - Crea un turno nuevo con validación y chequeo de solapamiento.
    - Body esperado:
      - `barberId` (uuid)
      - `serviceId` (uuid)
      - `startsAt` (string ISO datetime)
      - `customer`:
        - `name`
        - `phone` (se normaliza quitando símbolos)
        - `email` (opcional)
      - `notes` (opcional)
    - Lógica:
      - Upsert de cliente por `phone`.
      - Chequeo de que no hay otro turno que se solape para ese barbero.
      - Inserta turno con `status = 'pending'`.
  - `PATCH /api/appointments/:id/status`  
    - **Requiere** `Authorization: Bearer <jwt>`.  
    - Body: `{ "status": "pending" | "confirmed" | "cancelled" }`.

### Seeds / datos iniciales

Se agregó manualmente, vía SQL en el contenedor de Postgres:

- Barbero:
  - `Carlos`
- Servicios:
  - `Corte` (30 minutos, 5000 centavos)
  - `Barba` (20 minutos, 3500 centavos)

Esto permite probar la API inmediatamente.

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
  - Panel admin (Docker): contraseña por defecto `ADMIN_PASSWORD=admin12345` si no definís variables en `.env` (cambiala en producción).

Para ver logs:

```bash
docker compose logs -f api
docker compose logs -f web
docker compose logs -f db
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

### Estado actual del desarrollo

- **Backend**
  - Esquema de DB creado y migraciones funcionando.
  - API básica lista:
    - Catálogos de barberos y servicios.
    - Cálculo de disponibilidad diaria por barbero/servicio.
    - Creación de turnos con validación y control de solapamiento.
    - Listado de turnos (con nombres vía JOINs) y cambio de estado.
  - Probado manualmente con requests locales (creación/listado de turno correcto).

- **Frontend**
  - **`/`** — Reserva pública: barbero, servicio, fecha, slots, datos del cliente y `POST /api/appointments`.
  - **`/admin`** — Login con contraseña → JWT en `sessionStorage`; listado del día y acciones con `Authorization: Bearer`.
  - Navegación con `react-router-dom`.

### Próximos pasos sugeridos

- Usuarios múltiples / roles, o contraseñas hasheadas con bcrypt.
- Integrar eventualmente recordatorios por WhatsApp/SMS usando `WHATSAPP_NUMBER`.

---

**Nota:** Este `README.md` se irá actualizando a medida que el proyecto evolucione (nuevos endpoints, cambios de modelo, comportamiento del frontend, etc.), para servir como “memoria” de las decisiones y estado del sistema.

