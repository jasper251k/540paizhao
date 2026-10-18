import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 发布在 jasper251k.github.io/540paizhao/ 下
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/540paizhao/' : '/',
  plugins: [react()],
}))
