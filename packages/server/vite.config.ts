import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import { createRequire } from 'module'

// vite-plugin-electron v0.28.x has a CJS/ESM interop issue when Vite loads the
// config in CJS mode during `vite build`. Using createRequire avoids the
// "(0, import_vite_plugin_electron.default) is not a function" error on CI.
const require = createRequire(import.meta.url)
const electronPlugin = require('vite-plugin-electron')
// Handle both { default: fn } and fn shapes (CJS vs ESM interop)
const electron: typeof import('vite-plugin-electron').default =
  typeof electronPlugin === 'function'
    ? electronPlugin
    : (electronPlugin.default ?? electronPlugin)

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['better-sqlite3', 'ws', 'bufferutil', 'utf-8-validate']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            lib: {
              entry: 'electron/preload.ts',
              formats: ['cjs'] as any,
              fileName: () => 'preload.js',
            }
          }
        }
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
