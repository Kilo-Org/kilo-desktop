/** The worker's conda folders: `envsDir` is conda's first envs directory and holds the seed. */
export type CondaSandbox = { envsDir: string; pkgsDir: string };

/** Settings → Conda Environments (kilo.environments) copy and the sandbox's environment names. */
export const environmentsData = {
	/** From kilo.environments' settings-section contribution, rendered by kilo.shell. */
	description: "Manage your conda environments and packages.",
	flagMissingMessage:
		"Settings should list Conda Environments; package:e2e must force the `environments-feature` flag on",
	/** Seeded on disk in the worker's conda sandbox before the app starts. */
	seededEnvName: "e2e-seeded",
	/**
	 * One budget for the whole load: Kilo sign-in (up to 120s on a cold CI Kilo server) plus the
	 * bridge's cold start, which the panel waits out silently for 120s before it offers a retry.
	 */
	settledTimeoutMs: 150_000,
} as const;
