#!/usr/bin/env node
/**
 * Pre-bundles every `route.js` under `src/app/api/` into `build/api/` using
 * esbuild. The route-builder loads files from this directory in production,
 * which lets the route handlers use the `@/` path alias and import TypeScript
 * helpers (e.g. `@/lib/db.ts`) — both of which Node cannot resolve on its own
 * when it tries to dynamically `import()` the raw source files at runtime.
 *
 * The output preserves the source directory layout (so `getHonoPath` in
 * route-builder.ts continues to derive the correct URL pattern from the file
 * path) and bundles all local modules inline while leaving npm dependencies
 * external (resolved against `web/node_modules` at runtime).
 */

import { readdir, stat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, '..');
const apiSrcDir = join(webRoot, 'src', 'app', 'api');
const apiOutDir = join(webRoot, 'build', 'api');

async function findRouteFiles(dir) {
  const entries = await readdir(dir);
  let files = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) {
      files = files.concat(await findRouteFiles(full));
    } else if (entry === 'route.js') {
      files.push(full);
    }
  }
  return files;
}

async function loadExternalDeps() {
  const pkgRaw = await readFile(join(webRoot, 'package.json'), 'utf-8');
  const pkg = JSON.parse(pkgRaw);
  // Only externalize runtime dependencies. devDependencies are not installed
  // in production (`npm ci --omit=dev`), so leaving them external would let a
  // route silently bundle against a package that isn't on disk at runtime.
  const deps = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
  // Always treat node: builtins as external (esbuild handles these natively
  // when platform=node, but keep them explicit for clarity).
  return Array.from(deps);
}

async function main() {
  if (!existsSync(apiSrcDir)) {
    console.error(`[build-api-routes] No api dir at ${apiSrcDir}`);
    process.exit(1);
  }

  const routeFiles = await findRouteFiles(apiSrcDir);
  if (routeFiles.length === 0) {
    console.warn('[build-api-routes] No route.js files found.');
    return;
  }

  const externals = await loadExternalDeps();

  await mkdir(apiOutDir, { recursive: true });

  const entryPoints = routeFiles.map((file) => {
    const rel = relative(apiSrcDir, file).replace(/\.js$/, '');
    return { in: file, out: rel };
  });

  await build({
    entryPoints,
    outdir: apiOutDir,
    outExtension: { '.js': '.js' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    sourcemap: 'inline',
    logLevel: 'info',
    external: externals,
    alias: {
      '@': join(webRoot, 'src'),
    },
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.PROD': 'true',
      'import.meta.env.MODE': '"production"',
    },
    resolveExtensions: ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
    loader: {
      '.js': 'jsx',
      '.ts': 'ts',
      '.tsx': 'tsx',
    },
  });

  // esbuild writes outputs as `<outdir>/<entry.out>.js` — verify and report.
  console.log(`[build-api-routes] Bundled ${routeFiles.length} route file(s) into ${relative(webRoot, apiOutDir)}/`);
}

main().catch((err) => {
  console.error('[build-api-routes] Failed:', err);
  process.exit(1);
});
