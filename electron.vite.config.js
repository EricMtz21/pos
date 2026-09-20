import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

// main y preload se emiten como CommonJS (.cjs), que es lo que el sandbox del preload
// requiere y evita las diferencias de resolución de ESM dentro de Electron.
// El renderer sí es ESM, lo sirve Vite.
const nodeBundle = (externals = []) => ({
  rollupOptions: {
    external: externals,
    output: { format: 'cjs', entryFileNames: '[name].cjs' }
  }
})

export default defineConfig({
  main: { build: nodeBundle(['better-sqlite3']) },
  preload: { build: nodeBundle() },
  renderer: {
    root: resolve('src/renderer'),
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } }
  }
})
