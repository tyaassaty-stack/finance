import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Replace 'fintrack' with your exact GitHub repository name (lowercase)
// e.g. if your repo is github.com/yourname/my-finance-app → base: '/my-finance-app/'
export default defineConfig({
  plugins: [react()],
  base: '/fintrack/',
})
