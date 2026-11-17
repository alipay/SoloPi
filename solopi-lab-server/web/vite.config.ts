import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
const iconPackage=JSON.parse(readFileSync(resolve('.desktop-lucide/package.json'),'utf8'));
const iconEntry=resolve('.desktop-lucide',iconPackage.module||iconPackage.main);
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// W1 骨架：无反向代理假设，API 基址由运行时经 VITE_API_BASE_URL 注入；
// 服务端合同确认前，页面数据接线保持关闭（见 src/api/areas.ts）。
// W9 白屏修复（用户经 CloudIDE /proxy/8790/ 前缀访问时，根路径绝对引用
// 会被解析到代理域名根而404）：改用相对 base，index.html 资产引用
// 变为 ./assets/...，任意路径前缀（域根/子路径/IDE代理）均可解析。
export default defineConfig({
  base: './',
  resolve: {alias: {'@/lib':resolve('.desktop-lib'),'@desktop-report': resolve('.desktop-source'),'@desktop-ui':resolve('.desktop-ui'),'lucide-react':iconEntry,'react':resolve('node_modules/react'),'react-dom':resolve('node_modules/react-dom')},dedupe:['react','react-dom']},
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5195,
    strictPort: false,
  },
  test: {
    deps:{optimizer:{client:{enabled:true,include:['@radix-ui/react-dialog']}}},
    server:{deps:{inline:[/lucide-react/,/@radix-ui/,/react-remove-scroll/,/react-style-singleton/,/use-sidecar/,/use-callback-ref/]}},
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
  },
});
