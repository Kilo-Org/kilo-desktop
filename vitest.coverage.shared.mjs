/** Whether `node` reads the compiler's memo cache: `$[n]`. */
function readsMemoCache(node) {
	if (!node) return false;
	if (node.type === "MemberExpression") {
		return node.computed && node.object.type === "Identifier" && node.object.name === "$";
	}
	if (node.type === "LogicalExpression" || node.type === "BinaryExpression") {
		return readsMemoCache(node.left) || readsMemoCache(node.right);
	}
	return false;
}

/**
 * React Compiler wraps memoized values in `if ($[0] !== a || $[1] !== b) {…}
 * else {…}` cache checks. They map back to source lines but are not branches anyone
 * wrote, so counting them would grade the cache, not the code. Only the branch
 * is ignored; the statements inside still count.
 *
 * Typed structurally: the packages' Vitest and the root's disagree on which ESTree types a node has.
 *
 * @param {{ readonly type: string; readonly [key: string]: any }} node
 * @param {"function" | "statement" | "branch"} type
 * @returns {boolean}
 */
function ignoreReactCompilerCacheChecks(node, type) {
	if (type !== "branch") return false;
	if (node.type === "IfStatement") return readsMemoCache(node.test);
	return node.type === "LogicalExpression" && readsMemoCache(node);
}

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
		ignoreNode: ignoreReactCompilerCacheChecks,
		reporter: ["text", "json", "html"],
		reportOnFailure: true,
		exclude: [
			"**/*.test.*",
			"**/*.browser.test.*",
			"**/*.app.test.*",
			"**/*.integration.test.*",
			"**/dist/**",
			"**/.vite/**",
			// Package-local vite/vitest caches: optimized-dep bundles copied out
			// of node_modules land here and would dilute the thresholds.
			"**/.vitest/**",
			"**/*.config.ts",
			"**/routeTree.gen.ts",
			...extraExclude,
		],
		thresholds: {
			lines: 80,
			branches: 80,
			functions: 80,
			statements: 80,
		},
	};
}
