import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // "localhost" resolves only to ::1 on this machine; port forwards usually connect to 127.0.0.1.
  // 5190 is the person's server; the agent runs its own on 5191 with --port.
  server: { host: '127.0.0.1', port: 5190 },
  test: { environment: 'node' },
} as any);
