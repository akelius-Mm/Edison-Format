import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One id per build: baked into the app and published as version.json, so an open app can tell
// when a newer version is live and refresh itself.
const BUILD_ID = process.env.GITHUB_SHA || `local-${Date.now()}`;

function versionFile(): Plugin {
  return {
    name: 'edison-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) });
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: mode === 'single' ? [viteSingleFile()] : [versionFile()],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
  },
}));
