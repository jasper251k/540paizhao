import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// 发布在 jasper251k.github.io/540paizhao/ 下
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/540paizhao/' : '/',
  plugins: [
    react(),
    // 添加到主屏幕后像 App 一样全屏打开；页面缓存在手机里，网络差也能秒开
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: '540拍照',
        short_name: '540拍照',
        description: '拍照出片机位与路线规划',
        lang: 'zh-CN',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        background_color: '#f2f2f7',
        theme_color: '#f2f2f7',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg}'],
        // 高德的地图脚本和瓦片不缓存，始终走网络
        navigateFallbackDenylist: [/^\/_/],
      },
    }),
  ],
}))
