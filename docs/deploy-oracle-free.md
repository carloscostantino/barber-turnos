# Despliegue en Oracle Cloud Free Tier (barber-turnos)

## Un solo hosting (por ahora: Oracle)

**Todo el producto web** corre en **una sola instancia** OCI: base de datos, API, interfaz y TLS. No hace falta Wiroos/cPanel ni otro servidor solo para el “home”: el dominio (apex y `www`) apunta a esa VM y Caddy sirve la SPA y `/api`. El correo **entrante** (MX) puede seguir en otro proveedor si querés; lo habitual es un registro **A** o MX aparte, sin mezclar el tráfico web del hosting viejo.

Stack en la VM: PostgreSQL, API Node, SPA (nginx) y **Caddy** (Let’s Encrypt).

**Nota:** Autonomous Database (Oracle DB) no aplica sin reescribir el proyecto; se usa **PostgreSQL en Docker**.

## 1. Red y seguridad en OCI (VM + puertos)

1. **Compartimento** (opcional) para ordenar recursos.
2. **VCN** con subnet pública (ruta a Internet Gateway).
3. **Instancia Compute** (p. ej. Ubuntu 22.04, shape **Ampere A1** si hay cuota Always Free, o AMD micro).
4. **VNIC** en la subnet pública y **IP pública** (reservada o efímera).
5. **Security list** (o NSG) — entrada mínima:
   - **TCP 22** — solo desde tu IP (`/32`) para SSH.
   - **TCP 80** — `0.0.0.0/0` (HTTP; Caddy y validación Let’s Encrypt HTTP-01).
   - **TCP 443** — `0.0.0.0/0` (HTTPS, app y webhooks).
6. **Salida:** permitir tráfico saliente (updates, LE, Mercado Pago, SMTP).

## 2. DNS: dominio completo `agendaonline.com.ar` → Oracle

Objetivo: **@** y **www** apuntan a la **IPv4 pública** de la VM (misma IP que usás para SSH).

1. En tu proveedor DNS (p. ej. Cloudflare), creá o editá:
   - **A** `agendaonline.com.ar` (`@`) → IP pública de OCI.
   - **A** o **CNAME** `www` → si usás Caddy con [deploy/Caddyfile.apex](../deploy/Caddyfile.apex), el **A de `www`** debe ir a la **misma IP** (o CNAME a `@` si tu proveedor lo permite hacia apex; lo más simple son dos registros **A** con la misma IP).
2. **Let’s Encrypt:** deben existir y resolver **ambos** nombres antes de emitir el certificado (`Caddyfile.apex`).
3. **Cloudflare:** para que Caddy en la VM reciba el tráfico HTTP-01 sin interferencias, lo habitual es poner esos registros en **solo DNS** (nube gris) **o** usar proxy naranja con **SSL/TLS en Full (strict)** y certificado válido ya en el origen; si antes apuntabas a Wiroos, **cambiá los A** hacia la IP de OCI cuando el stack esté listo.

Propagación: minutos a horas. Verificación:

```bash
nslookup agendaonline.com.ar
nslookup www.agendaonline.com.ar
```

Ambas deben devolver la IP pública de la instancia OCI.

### Subdominio único (opcional)

Si preferís solo `barberia.agendaonline.com.ar` (sin usar el apex):

- **A** `barberia` → IP OCI.
- En `.env`: `PUBLIC_HOST=barberia.agendaonline.com.ar` y **sin** `CADDY_DOCKERFILE` (usa [deploy/Caddyfile](../deploy/Caddyfile) por defecto).

## 3. Preparar la VM

```bash
sudo apt update && sudo apt install -y git ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Cerrá sesión y volvé a entrar para usar Docker sin `sudo`.

Cloná el repo en la VM y en la **raíz del repo**:

```bash
cp deploy/env.production.example .env
nano .env   # secretos, dominio, CADDY_DOCKERFILE si aplica
```

Requisitos en `.env` (resumen):

| Variable | Notas |
|----------|--------|
| `PUBLIC_HOST` | Apex: `agendaonline.com.ar` (sin `https://`). |
| `CADDY_DOCKERFILE` | Para apex + `www`: `Caddyfile.apex`. Subdominio solo: omitir. |
| `CLIENT_ORIGIN` | `https://` + canonical (mismo que usarán los usuarios tras redirecciones). |
| `VITE_API_BASE` | `https://` + host + `/api`. |
| `DATABASE_URL` | Coincidir con `POSTGRES_*`. |
| `JWT_SECRET` | Mínimo 16 caracteres. |
| `ADMIN_PASSWORD_BCRYPT` | Obligatorio en prod. |
| `TRUST_PROXY` | No hace falta: el compose fuerza proxy en la API. |

Levantá el stack:

```bash
cd ~/barber-turnos
docker compose -f docker-compose.prod.yml up -d --build
```

Logs si algo falla:

```bash
docker compose -f docker-compose.prod.yml logs -f caddy
docker compose -f docker-compose.prod.yml logs -f api
```

Comprobaciones:

- `https://agendaonline.com.ar/health` → `{"ok":true,...}`.
- `https://agendaonline.com.ar/` → SPA.
- `https://www.agendaonline.com.ar/` → redirección 308/301 al apex (con `Caddyfile.apex`).

## 4. TLS y Caddy

- [deploy/Caddyfile](../deploy/Caddyfile) — un solo `PUBLIC_HOST`.
- [deploy/Caddyfile.apex](../deploy/Caddyfile.apex) — `PUBLIC_HOST` + `www.${PUBLIC_HOST}`; redirige `www` al apex.

Puerto **80** abierto para HTTP-01. Certificados en volúmenes `caddy_data` / `caddy_config`.

## 5. Mercado Pago y SMTP

**Webhook:** `https://agendaonline.com.ar/api/webhooks/mercadopago` (o tu `PUBLIC_HOST`).

Variables: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, etc. `MP_REDIRECT_BASE_URL` = URL pública del front (`https://agendaonline.com.ar` si usás el apex).

**SMTP:** si configurás `SMTP_HOST`, completá `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.

## 6. Persistencia y backups

```bash
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U barber barber_turnos > backup.sql
```

## 7. Migración desde Wiroos / WordPress

El sitio “público” pasa a ser la **SPA** de barber-turnos en el mismo host. Contenido de marketing que estaba en WordPress hay que **replicar en la app**, en páginas estáticas, o enlazar afuera; el DNS deja de apuntar el web a Wiroos cuando los **A** (y `www`) apuntan a OCI. El **correo** puede seguir en el hosting anterior: en DNS conviene **no** usar un CNAME `mail` proxied a Cloudflare hacia el apex; usá **A** para `mail` hacia el servidor de correo que indique tu proveedor.

## 8. Sin dominio propio

Let’s Encrypt requiere un FQDN resoluble; solo IP pública no alcanza con este Caddyfile.
