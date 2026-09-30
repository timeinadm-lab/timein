import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Duas páginas de entrada: o sistema (index.html) e o portal (portal.html),
  // cada uma com o próprio atalho de celular. Mesmo app React por dentro.
  build: {
    rollupOptions: {
      input: { main: 'index.html', portal: 'portal.html' },
    },
  },
  optimizeDeps: {
    include: ['xlsx'],
  },
})
