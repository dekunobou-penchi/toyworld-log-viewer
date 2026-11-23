import { defineConfig } from 'vite';

const apiPort = Number(process.env.VIEWER_API_PORT ?? 3200);
/** 開発用 Vite のポート。他で使っているときは VIEWER_DEV_PORT で変える */
const devPort = Number(process.env.VIEWER_DEV_PORT ?? 5180);

export default defineConfig({
    server: {
        port: devPort,
        // 使用中なら黙って別のポートに逃げず、エラーで知らせる
        strictPort: true,
        proxy: {
            '/api': {
                target: `http://localhost:${apiPort}`,
                changeOrigin: true,
            },
        },
    },
});
