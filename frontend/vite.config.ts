import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    // Enable brotli compression for assets
    brotliSize: true,
    
    // Split chunks for better caching
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return id.toString().split('node_modules/')[1].split('/')[0].toString();
          }
        }
      }
    },
    
    // Minify aggressively
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,  // Remove console.log in production
        drop_debugger: true
      }
    }
  },
  
  // Resolve path aliases
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
})