/**
 * Build-time define injected by apps/desktop/vite.main.config.ts.
 * Resolves to the absolute path of the environments plugin root so
 * `resolveBridgePath` can locate `resources/bridge/` after bundling.
 * Only present in the desktop main bundle — tests and packaging code
 * pass `pluginRoot` explicitly.
 */
declare const __ENVIRONMENTS_PLUGIN_ROOT__: string;
