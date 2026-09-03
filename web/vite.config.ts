import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5233,
    strictPort: true,
    /* ⚠ Without this the upload probe answers with the dev server's index.html, the control falls
       back to a plain link box, and the drop zone is never exercised until production. Points at a
       locally running `api/server.mjs` (port 8803). ➤ TODO: point at the live OpenPons API once one
       is deployed. */
    proxy: {
      '/api': { target: 'http://127.0.0.1:8803', changeOrigin: true, secure: false },
      /* ⭐ Same-origin path to the local verifier, so the dev claim flow needs no CORS at all —
         the same topology production uses. */
      '/verifier': { target: 'http://127.0.0.1:8804', changeOrigin: true, secure: false, rewrite: (p) => p.replace(/^\/verifier/, '') },
    },
  },
})
