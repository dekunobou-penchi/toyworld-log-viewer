import { defineConfig } from 'vite';

const apiPort = Number(process.env.VIEWER_API_PORT ?? 3200);

export default defineConfig({
    server: {
        port: 5174,
        proxy: {
            '/api': {
                target: `http://localhost:${apiPort}`,
                changeOrigin: true,
            },
        },
    },
});
