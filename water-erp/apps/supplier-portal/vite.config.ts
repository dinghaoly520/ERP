import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { PORTS, apiOrigin } from '@water-erp/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // @water-erp/{shared,config,ukey} 的 dist 是 CJS（ukey 含 require('sm-crypto')）；
  // dev 模式直出 ESM 无法命名导入（ukey 更是浏览器侧 require is not defined），
  // 需强制预打包（esbuild 转 ESM）。生产构建经 rollup commonjs/interop 无此问题。
  optimizeDeps: {
    include: ['@water-erp/shared', '@water-erp/config', '@water-erp/ukey'],
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
    port: PORTS.supplier,
    proxy: {
      '/api': {
        target: apiOrigin(),
        changeOrigin: true,
      },
    },
  },
})
