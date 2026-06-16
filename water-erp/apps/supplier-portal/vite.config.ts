import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      onLog(level, log, defaultHandler) {
        if (log.code === 'INVALID_ANNOTATION' && log.id?.includes('@vueuse/core')) {
          return
        }
        defaultHandler(level, log)
      },
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vue-runtime',
              test: /node_modules\/(?:\.pnpm\/)?(?:@vue|vue|vue-router|pinia)/,
            },
            {
              name: 'element-plus',
              test: /node_modules\/(?:\.pnpm\/)?(?:element-plus|@element-plus)/,
            },
            {
              name: 'vendor',
              test: /node_modules/,
            },
          ],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3004,
    proxy: {
      '/api': {
        target: 'http://localhost:4001',
        changeOrigin: true,
      },
    },
  },
})
