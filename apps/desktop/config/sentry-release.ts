/**
 * The Sentry release every process reports, and the release the Vite plugins
 * create and upload source maps under: main sets it in `Sentry.init` (via the
 * `SENTRY_RELEASE_NAME` define), the renderer gets it injected by the web
 * build's Sentry Vite plugin. Not the npm name (`@kilo-desktop/desktop`):
 * Sentry rejects a release with `/`, dropping it from events and failing the
 * upload. Not the product name either: it differs per track ("Kilo Preview"),
 * and the version already tells tracks apart. Dependency-free so
 * `apps/web/vite.config.ts` can import it.
 */
export function sentryReleaseName(version: string): string {
	const name = `kilo-desktop@${version}`;
	// https://docs.sentry.io/product/releases/naming-releases/
	if (!version.trim() || /[/\\\n\t]/.test(name) || name.length > 200) {
		throw new Error(`Invalid Sentry release name: ${JSON.stringify(name)}`);
	}
	return name;
}
