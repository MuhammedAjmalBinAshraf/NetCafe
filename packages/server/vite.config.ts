import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { createRequire } from 'module'

// vite-plugin-electron v0.28.x and vite-plugin-electron-renderer v0.14.x both
// have a CJS/ESM interop problem when Vite loads vite.config.ts in CJS mode
// during `vite build` on CI. The `import X from '...'` syntax results in X
// being the whole module object instead of the default export.
// Using createRequire and normalising the export shape fixes this reliably.
const require = createRequire(import.meta.url)

function resolveDefault<T>(mod: unknown): T {
  const m = mod as Record<string, unknown>
  if (typeof m === 'function') return m as T
  if (typeof m?.default === 'function') return m.default as T
  throw new Error(`Cannot resolve default export from module: ${JSON.stringify(Object.keys(m))}`)
}

const electron = resolveDefault<typeof import('vite-plugin-electron').default>(
  require('vite-plugin-electron')
)
const renderer = resolveDefault<typeof import('vite-plugin-electron-renderer').default>(
  require('vite-plugin-electron-renderer')
)

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
