#!/usr/bin/env node
// Production server entry. The bundled Hono `app` (built by Vite as the
// react-router-hono-server SSR bundle) is wired up here with the React Router
// request handler and a static file server, then bound to an HTTP port.
//
// We do this in a separate, tiny script (rather than calling `createHonoServer`
// inline inside the SSR bundle) because the bundled top-level
// `await createHonoServer(...)` call hangs in production — most likely due to
// circular top-level-await between the bundle and the React Router server
// build it tries to import. Doing the wiring out-of-band side-steps the issue.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createRequestHandler } from 'react-router';
import { Hono } from 'hono';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, '..', 'build');
const clientBuildPath = join(buildDir, 'client');

// Import the configured Hono app from the SSR bundle.
const { app } = await import(join(buildDir, 'server', 'index.js'));
// Import the React Router server build (routes, assets manifest, etc.).
const reactRouterBuild = await import(join(buildDir, 'server', 'assets', 'server-build.js'));

// Mount static assets. /assets/* gets long cache; everything else short cache.
app.use('/assets/*', serveStatic({ root: 'build/client' }));
app.use('*', serveStatic({ root: 'build/client' }));

// Mount the React Router request handler under `/` for any unmatched route.
const reactRouterApp = new Hono({ strict: false });
const requestHandler = createRequestHandler(reactRouterBuild, 'production');
reactRouterApp.use(async (c) => requestHandler(c.req.raw));
app.route('/', reactRouterApp);
app.route('/.data', reactRouterApp);

const port = Number(process.env.PORT) || 5000;
const hostname = process.env.HOST || '0.0.0.0';

serve(
  {
    fetch: app.fetch.bind(app),
    port,
    hostname,
  },
  (info) => {
    console.log(`[Server] HireWire production server listening on http://${hostname}:${info.port}`);
  },
);
