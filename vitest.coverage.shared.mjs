/**
 * Shared Vitest coverage gate used by workspace packages.
 * Entrypoints / generated files that are not meaningfully unit-tested stay
 * in `extraExclude` at the call site — keep that list intentional and small.
 *
 * @param {readonly string[]} [extraExclude]
 */
export function createCoverageConfig(extraExclude = []) {
	return {
		provider: /** @type {const} */ ("v8"),
		reporter: ["text", "json", "html"],
		reportOnFailure: true,
		exclude: [
			"**/*.test.*",
			"**/*.browser.test.*",
			"**/*.app.test.*",
			"**/*.integration.test.*",
			"**/dist/**",
			"**/.vite/**",
			"**/*.config.ts",
			"**/routeTree.gen.ts",
			...extraExclude,
		],
		thresholds: {
			lines: 90,
			branches: 90,
			functions: 90,
			statements: 90,
		},
	};
}
