/**
 * Friendly wording for a permission request, keyed by the Kilo-visible tool
 * name. Used only for the dialog title — the raw tool name stays visible in the
 * badge and body copy.
 *
 * Only the agent tools that can actually raise a prompt need an entry; anything
 * unmapped falls back to the raw name.
 */
const PERMISSION_ACTION_LABELS: Readonly<Record<string, string>> = {
	desktop_environments_conda_envs_create: "creating a conda environment",
	desktop_environments_conda_envs_delete: "deleting a conda environment",
	desktop_environments_conda_envs_clone: "cloning a conda environment",
	desktop_environments_conda_packages_install: "installing conda packages",
	desktop_environments_conda_packages_remove: "removing conda packages",
	desktop_environments_conda_packages_update: "updating conda packages",
};

/** Returns the friendly action phrase for a tool, or undefined when unmapped. */
export function describePermissionAction(permission: string): string | undefined {
	return PERMISSION_ACTION_LABELS[permission];
}

/**
 * Patterns worth showing in the dialog. A bare `*` is the wildcard a
 * tool-level rule matches on; it means nothing to the user, so it is hidden.
 */
export function visiblePermissionPatterns(patterns: readonly string[]): readonly string[] {
	return patterns.filter((pattern) => pattern !== "*");
}
