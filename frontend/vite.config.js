import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';

  return {
    plugins: [react(), tailwindcss()],
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
            redux: ['@reduxjs/toolkit', 'react-redux'],
          }
        }
      }
    },
    // Dev proxy — in production, Nginx handles the proxying
    server: isProduction ? {} : {
      proxy: {
        '/graphql': 'http://localhost:4000',
        '/health': 'http://localhost:4000',
        '/github': 'http://localhost:4000'
      }
    }
  };
});
