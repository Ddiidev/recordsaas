import { defineConfig } from 'vite'
import electron, { ElectronOptions } from 'vite-plugin-electron'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'node:path'

const cjsPreload = (entry: string, fileName: string): ElectronOptions => ({
  vite: {
    build: {
      rollupOptions: {
        input: entry,
        output: {
          format: 'cjs',
          entryFileNames: fileName,
        },
      },
    },
  },
})

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@icons': path.resolve(__dirname, 'src/components/ui/icons.tsx'),
    },
  },
  plugins: [
    tailwindcss(),
    react(),
    electron([
      // Main process
      {
        entry: 'electron/main/index.ts',
      },
      // Renderer preload
      cjsPreload(path.join(__dirname, 'electron/preload.ts'), 'preload.cjs'),
      // Temporary windows preload
      cjsPreload(path.join(__dirname, 'electron/temp-preload.ts'), 'temp-preload.cjs'),
    ] as ElectronOptions[]),
    nodePolyfills(), // this is necessary to avoid "Buffer is not defined issue"
  ],
})
