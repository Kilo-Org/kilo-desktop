/**
 * Patterns worth showing in a permission card. A bare `*` is the wildcard a
 * tool-level rule matches on; it means nothing to the person, so it is hidden.
 */
export function visiblePermissionPatterns(patterns: readonly string[]): readonly string[] {
	return patterns.filter((pattern) => pattern !== "*");
}
