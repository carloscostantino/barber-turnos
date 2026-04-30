# Guía: Mercado Pago en desarrollo local (Docker)

Esta app usa **preapproval** (suscripción mensual en ARS). Para que el panel muestre el botón **Activar suscripción**, el backend exige **las dos** variables: `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` (ver `isMpConfigured()` en `server/src/env.ts`).

## 1. Cuenta y aplicación en Mercado Pago

1. Entrá a [Mercado Pago Developers](https://www.mercadopago.com.ar/developers/panel/app) e iniciá sesión (podés usar tu cuenta de MP).
2. **Creá una aplicación** (o usá una existente): nombre descriptivo, por ejemplo "Barber Turnos local".
3. En la aplicación, abrí **Credenciales de prueba** (sandbox). Ahí vas a ver:
   - **Access Token** de prueba (empieza con `TEST-` o similar según la versión de credenciales).
   - Más adelante, en **Webhooks**, una **clave secreta** para validar firmas.

> En desarrollo usá siempre **credenciales de prueba**. Las de producción cobran de verdad.

## 2. Variables en tu máquina (Docker)

1. En la **raíz del repo** (donde está `docker-compose.yml`), copiá la plantilla:

   ```bash
   copy .env.example .env
   ```

   (En PowerShell podés usar `Copy-Item .env.example .env`.)

2. Editá `.env` y completá:

   ```env
   SYSTEM_ADMIN_PASSWORD=tu_clave_super_admin_min_8_chars

   MP_ACCESS_TOKEN=TEST-...   # el Access Token de prueba del paso 1
   MP_WEBHOOK_SECRET=...      # la clave secreta del webhook (paso 4)
   ```

3. Reiniciá la API para que tome las variables:

   ```bash
   docker compose up -d api
   ```

4. Verificá que el contenedor vea las vars (sin mostrar valores en pantallas compartidas):

   ```bash
   docker compose exec api printenv MP_ACCESS_TOKEN
   docker compose exec api printenv MP_WEBHOOK_SECRET
   ```

   Si salen vacías, el `.env` no está en la raíz o no tiene esas líneas sin comillas rotas.

## 3. `back_url` e “Invalid value for back_url, must be a valid URL”

Al crear la suscripción, el backend envía a Mercado Pago un `back_url` (dónde vuelve el navegador después del checkout). Suele armarse con `CLIENT_ORIGIN` (`http://localhost:5173`). **En sandbox, la API de MP a veces rechaza `localhost`** como URL de retorno.

**Qué hacer:**

1. En otra terminal, exponé el **frontend** (Vite, puerto 5173), no solo el 3001 de la API:

   ```bash
   ngrok http 5173
   ```

2. Copiá la URL `https://....ngrok-free.app` y agregá en el `.env` de la **raíz del repo** (el que usa Docker Compose):

   ```env
   MP_REDIRECT_BASE_URL=https://TU-SUBDOMINIO.ngrok-free.app
   ```

3. Reiniciá la API: `docker compose up -d api`.

4. **Abrí el panel admin usando esa URL de ngrok**, no `http://localhost:5173`, para que el origen coincida con el `back_url` que MP valida y el flujo de vuelta funcione.

Si no definís `MP_REDIRECT_BASE_URL`, se sigue usando `CLIENT_ORIGIN`. En el panel de tu aplicación MP, si hay **URLs permitidas / redirección**, agregá también `http://localhost:5173` y la URL https de ngrok.

## 4. Webhook: por qué hace falta y qué URL usar

Mercado Pago **no puede** llamar a `http://localhost:3001` desde internet. Para que el estado del local pase a `active` después del pago, MP envía notificaciones a una URL **pública**.

**Opción recomendada (túnel):**

1. Instalá [ngrok](https://ngrok.com/) u otra herramienta similar.
2. Con la API levantada (`docker compose up`), exponé el puerto 3001:

   ```bash
   ngrok http 3001
   ```

3. Copiá la URL HTTPS que te da (ej. `https://abc123.ngrok-free.app`).

4. En el panel de tu aplicación MP: **Webhooks** / **Notificaciones** → agregá una URL con este path exacto:

   ```text
   https://TU-SUBDOMINIO.ngrok-free.app/api/webhooks/mercadopago
   ```

   Importante: incluye el prefijo **`/api`** (el servidor monta el webhook ahí).

5. Mercado Pago te mostrará una **clave secreta** (para validar `x-signature`). Copiala a `MP_WEBHOOK_SECRET` en tu `.env` y volvé a `docker compose up -d api`.

6. Cada vez que reinicies ngrok, la URL puede cambiar: tendrás que actualizar la URL en el panel de MP y, si aplica, el secret.

**Sin túnel:** podés completar el checkout en sandbox, pero el backend **no** recibirá el webhook y el estado del local puede quedar desincronizado hasta que probés manualmente o uses herramientas de simulación.

## 5. Probar el flujo en la app

1. Abrí el panel admin de una barbería en trial: `http://localhost:5173/s/TU-SLUG/admin`.
2. Tenés que ver el botón **Activar suscripción** (si `billing.configured` es true).
3. Clic → redirección a Mercado Pago → pagá con **tarjetas de prueba** de MP (ver [documentación oficial de tarjetas de prueba](https://www.mercadopago.com.ar/developers/es/docs/your-integrations/test/cards)).
4. Tras el pago, MP redirige a `…/admin?billing=success` y el webhook debería marcar la suscripción como activa.

## 6. Comprobar que "billing" está configurado

Podés pedir (con sesión admin del local):

`GET http://localhost:3001/api/shops/TU-SLUG/admin/trial-status`

En la respuesta, `billing.configured` debe ser `true` si ambas envs están cargadas en el contenedor `api`.

## 7. Problemas frecuentes

| Síntoma | Causa probable |
|--------|----------------|
| No aparece "Activar suscripción" | Falta `MP_WEBHOOK_SECRET` o `MP_ACCESS_TOKEN` en el `.env` de la raíz, o no reiniciaste `api`. |
| 501 al suscribir | Token inválido o MP no configurado. |
| Webhook 401 | `MP_WEBHOOK_SECRET` no coincide con la clave del panel de MP para esa URL. |
| Estado no pasa a activo | Webhook no llegó (localhost sin túnel, URL mal escrita, ngrok apagado). |

## 8. Cambio de precio programado (opcional)

En `.env` podés poner `PRICE_CHANGE_WINDOW_DAYS=0` para pruebas del panel super-admin; el `docker-compose` usa `${PRICE_CHANGE_WINDOW_DAYS:-30}` (default 30 días).
