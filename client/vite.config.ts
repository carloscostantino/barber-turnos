import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Asegura modo SPA: /admin y otras rutas sirven index.html (útil en dev y preview).
  appType: 'spa',
  server: {
    // Vite rechaza por defecto Host distinto de localhost; ngrok envía el hostname público (403).
    allowedHosts: true,
  },
})
