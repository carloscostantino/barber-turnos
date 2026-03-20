import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Asegura modo SPA: /admin y otras rutas sirven index.html (útil en dev y preview).
  appType: 'spa',
})
