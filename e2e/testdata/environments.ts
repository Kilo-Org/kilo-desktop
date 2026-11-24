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
	/** The "Create environment" popup's copy and the names the spec types into it. */
	createDialog: {
		title: "Create environment",
		description:
			"Choose where the environment lives, its Python version, and any packages to start with.",
		invalidName: "-bad",
		invalidNameError:
			"Name must start with a letter or digit and contain only letters, digits, '.', '_', or '-'.",
		reservedName: "base",
		/** Never created: a free name is all the prefix check needs to unlock Create. */
		freeName: "e2e-ready",
	},
	/**
	 * One budget for the whole load: Kilo sign-in (up to 120s on a cold CI Kilo server) plus the
	 * bridge's cold start (the panel waits out 120s before it offers a retry), with margin. Stays
	 * under the 360s test timeout so the shell and settings steps still fit.
	 */
	settledTimeoutMs: 270_000,
} as const;
