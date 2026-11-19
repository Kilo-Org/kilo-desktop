/** Settings → Conda Environments (kilo.environments) copy and the sandbox's environment names. */
export const environmentsData = {
	description: "Manage your conda environments and packages.",
	searchPlaceholder: "Search environments",
	sortLabel: "Sort environments",
	newEnvironmentLabel: "New environment",
	createItemLabel: "Create new",
	importItemLabel: "Import file",
	/** Seeded on disk in the worker's conda sandbox before the app starts. */
	seededEnvName: "e2e-seeded",
	/**
	 * Kilo sign-in (up to 120s on a cold CI Kilo server) plus the bridge's cold start, which the
	 * panel waits out silently for 120s before it offers a retry.
	 */
	settledTimeoutMs: 150_000,
} as const;
