import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';
import path from 'node:path';

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

/**
 * The Lab (`vite build --mode lab`, published at <site>/lab/): the same engine and cards with an experimental
 * look (src/lab). It is its own app when added to a Home Screen, and it has no service worker, so it can never
 * take over or cache over the real app next to it.
 */
function labBuild(): Plugin {
  let outDir = '';
  return {
    name: 'edison-lab',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    transformIndexHtml(html) {
      return html.replace('<title>Edison Format Simulator</title>', '<title>Edison Lab</title>').replace('content="Edison" />', 'content="Edison Lab" />');
    },
    closeBundle() {
      const manifest = path.join(outDir, 'manifest.webmanifest');
      if (fs.existsSync(manifest)) {
        const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        fs.writeFileSync(manifest, JSON.stringify({ ...m, name: 'Edison Lab', short_name: 'Edison Lab', description: 'Edison Format Simulator: experimental look.' }, null, 2));
      }
      fs.rmSync(path.join(outDir, 'sw.js'), { force: true });
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  // __LAB__ is a build-time constant: the normal build drops every `if (__LAB__)` branch and never loads src/lab
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID), __LAB__: JSON.stringify(mode === 'lab') },
  plugins: mode === 'single' ? [viteSingleFile()] : mode === 'lab' ? [versionFile(), labBuild()] : [versionFile()],
  build: {
    outDir: mode === 'single' ? 'dist-single' : mode === 'lab' ? 'dist/lab' : 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
  },
}));
