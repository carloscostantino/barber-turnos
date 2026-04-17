# Enrutamiento multi-barbería (SaaS)

## Decisión

- **Subsitio por path** (`/s/:shopSlug`) en lugar de subdominio en la primera versión: un solo certificado TLS, sin DNS wildcard ni lógica de host en el front, y despliegue más simple en Vite/static hosting.
- **Subdominio** (`slug.tudominio.com`) queda como evolución opcional: mismo backend resolviendo el tenant por `Host` o por path reescrito en el proxy (nginx/Cloudflare).

## API

- Rutas públicas y de admin por tenant: `/api/shops/:shopSlug/...` (p. ej. `GET /api/shops/mi-barberia/public-settings`).
- **Compatibilidad**: rutas sin prefijo (`GET /api/public-settings`, etc.) usan el slug por defecto [`DEFAULT_SHOP_SLUG`](../server/.env.example) (`default` tras la migración).

## Cliente (Vite)

- Reserva: `/s/:shopSlug` y cancelación `/s/:shopSlug/cancelar` (o query `?token=` compartida).
- Panel: `/s/:shopSlug/admin`.
- Redirección: `/` → `/s/<DEFAULT_SHOP_SLUG>` (variable `VITE_DEFAULT_SHOP_SLUG`).

## Autenticación admin

- Login: `POST /api/admin/login` con `{ password, shopSlug? }`. El JWT incluye `shopId` para aislar datos en todas las rutas admin.
