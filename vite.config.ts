import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// build-ul iese ca un singur index.html (JS + CSS inline), usor de publicat oriunde
export default defineConfig({ base: './', plugins: [viteSingleFile()], build: { chunkSizeWarningLimit: 4000 }, test: { globals: true, testTimeout: 60000 } } as never);
