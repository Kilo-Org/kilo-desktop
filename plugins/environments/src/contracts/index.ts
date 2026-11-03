import { z } from "zod";

import { defineDomain, method, type PluginDefinitions } from "@kilo-desktop/kernel";

import { cancelInputSchema, cancelResultSchema, jobProgressEventSchema } from "./common.js";
import {
	channelSchema,
	condaChannelsAddInputSchema,
	condaChannelsListResultSchema,
	condaChannelsRemoveInputSchema,
	condaEnvSchema,
	condaEnvsCheckPrefixInputSchema,
	condaEnvsCheckPrefixResultSchema,
	condaEnvsCloneInputSchema,
	condaEnvsCloneResultSchema,
	condaEnvsCreateFromFileInputSchema,
	condaEnvsCreateFromFileResultSchema,
	condaEnvsCreateInputSchema,
	condaEnvsCreateResultSchema,
	condaEnvsDeleteInputSchema,
	condaEnvsDeleteResultSchema,
	condaEnvsDistributionsResultSchema,
	condaEnvsPickFileInputSchema,
	condaEnvsPickFileResultSchema,
	condaEnvsPrefixOptionsResultSchema,
	condaEnvsReadFileInputSchema,
	condaEnvsReadFileResultSchema,
	condaPackagesInstallInputSchema,
	condaPackagesInstallResultSchema,
	condaPackagesListInputSchema,
	condaPackagesListResultSchema,
	condaPackagesPreviewInputSchema,
	condaPackagesPreviewResultSchema,
	condaPackagesRemoveInputSchema,
	condaPackagesRemoveResultSchema,
	condaPackagesUpdateInputSchema,
	condaPackagesUpdateResultSchema,
	condaRepodataFindInputSchema,
	condaRepodataFindResultSchema,
	environmentNameSchema,
	matchSpecSchema,
} from "./providers/conda.js";

export * from "./common.js";
export * from "./providers/conda.js";

/**
 * kilo.environments' public surface: the user's conda environments
 * (`conda`, behind the `environments-feature` flag) and plugin-owned
 * environments other plugins ask for (`conda-runtime`, e.g. the local model
 * server's), both served by one bundled conda bridge in main.
 */
export const ENVIRONMENTS_PLUGIN_ID = "kilo.environments";

/** The LaunchDarkly flag behind Conda Environments: its settings, tools and `conda` methods. */
export const ENVIRONMENTS_FLAG = "environments-feature";

/** The settings section's id (its path is `/settings/environments`). */
export const ENVIRONMENTS_SETTINGS_SECTION = "environments";

/** The `kernel/services` key of the conda bridge daemon. */
export const BRIDGE_SERVICE_KEY = "kilo.environments/bridge";

/** The conda environments widget's resource, shown for `conda.envs.list` calls. */
export const CONDA_ENVS_LIST_APP_URI = "ui://environments/conda-envs-list";

const nothing = z.undefined();

export const condaStatusSchema = z.enum([
	/** The `environments-feature` flag is off. */
	"disabled",
	/** The bundled conda bridge was not found. */
	"unavailable",
	"ready",
]);
export type CondaStatus = z.output<typeof condaStatusSchema>;

/**
 * The user's conda environments, packages and channels, through the bundled
 * conda bridge. Methods refuse (`UNAVAILABLE`) unless the state is `ready`.
 * Writes run one at a time and return when done (`jobId` names the job for
 * `job-progress` and `cancelJob`); reads are cached briefly and refreshed by
 * any write.
 */
export const Conda = defineDomain({
	id: "kilo.environments/conda",
	home: "main",
	state: z.object({ status: condaStatusSchema }),
	methods: {
		listEnvironments: method(nothing, z.array(condaEnvSchema)),
		/** Conda installations found on this device (Anaconda, Miniconda…). */
		distributions: method(nothing, condaEnvsDistributionsResultSchema),
		createEnvironment: method(condaEnvsCreateInputSchema, condaEnvsCreateResultSchema),
		cloneEnvironment: method(condaEnvsCloneInputSchema, condaEnvsCloneResultSchema),
		/** Creates an environment from a file `readEnvironmentFile` staged for review. */
		createEnvironmentFromFile: method(
			condaEnvsCreateFromFileInputSchema,
			condaEnvsCreateFromFileResultSchema,
		),
		deleteEnvironment: method(condaEnvsDeleteInputSchema, condaEnvsDeleteResultSchema),
		/** Asks the person for an environment file (`.yml` / `.yaml`). */
		pickEnvironmentFile: method(condaEnvsPickFileInputSchema, condaEnvsPickFileResultSchema),
		/** Reads an environment file and stages a copy for `createEnvironmentFromFile`. */
		readEnvironmentFile: method(condaEnvsReadFileInputSchema, condaEnvsReadFileResultSchema),
		/** Where new environments can go, and the configured channels. */
		prefixOptions: method(nothing, condaEnvsPrefixOptionsResultSchema),
		/** Whether an environment can be created at a prefix. Never cached or queued. */
		checkPrefix: method(condaEnvsCheckPrefixInputSchema, condaEnvsCheckPrefixResultSchema),
		listPackages: method(condaPackagesListInputSchema, condaPackagesListResultSchema),
		installPackages: method(condaPackagesInstallInputSchema, condaPackagesInstallResultSchema),
		removePackages: method(condaPackagesRemoveInputSchema, condaPackagesRemoveResultSchema),
		updatePackages: method(condaPackagesUpdateInputSchema, condaPackagesUpdateResultSchema),
		/** What updating would change, without changing anything. */
		previewUpdate: method(condaPackagesPreviewInputSchema, condaPackagesPreviewResultSchema),
		/** What installing would change, without changing anything. */
		previewInstall: method(condaPackagesPreviewInputSchema, condaPackagesPreviewResultSchema),
		listChannels: method(nothing, condaChannelsListResultSchema),
		addChannel: method(condaChannelsAddInputSchema, condaChannelsListResultSchema),
		removeChannel: method(condaChannelsRemoveInputSchema, condaChannelsListResultSchema),
		findRepodata: method(condaRepodataFindInputSchema, condaRepodataFindResultSchema),
		cancelJob: method(cancelInputSchema, cancelResultSchema),
	},
	events: {
		/** A write's progress: queued, running, then succeeded, failed or cancelled. */
		"job-progress": jobProgressEventSchema,
		/** The agent asked to open Conda Environments settings (main windows show them). */
		"setup-requested": z.object({}),
	},
});

export const ensureEnvironmentInputSchema = z.object({
	name: environmentNameSchema,
	packages: z.array(matchSpecSchema),
	/**
	 * Exact channel list for the solve, in priority order. When omitted,
	 * channels named by `channel::` package prefixes are used, then `anaconda`
	 * and `defaults`.
	 */
	channels: z.array(channelSchema).optional(),
});
export type EnsureEnvironmentInput = z.input<typeof ensureEnvironmentInputSchema>;

export const ensureEnvironmentResultSchema = z.object({
	condaBinPath: z.string(),
	prefixPath: z.string(),
});
export type EnsureEnvironmentResult = z.output<typeof ensureEnvironmentResultSchema>;

/**
 * Plugin-owned conda environments (outside the person's own, in
 * `~/.kilo-desktop/conda`), e.g. the local model server's runtime.
 * `ensureEnvironment` creates or reuses one by name and package pin; it
 * works whatever the `environments-feature` flag says and starts the bridge
 * only when an environment must be created.
 */
export const CondaRuntime = defineDomain({
	id: "kilo.environments/conda-runtime",
	home: "main",
	state: z.object({}),
	methods: {
		ensureEnvironment: method(ensureEnvironmentInputSchema, ensureEnvironmentResultSchema),
	},
});

const EXECUTABLE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The path of an executable `name` in a conda environment at `prefixPath`. */
export function condaExecutable(
	prefixPath: string,
	name: string,
	platform: "win32" | "other",
): string {
	if (!EXECUTABLE_NAME_PATTERN.test(name)) {
		throw new Error(`Invalid executable name: ${name}`);
	}
	if (platform === "win32") {
		const executable = name.endsWith(".exe") ? name : `${name}.exe`;
		return `${prefixPath.replace(/[\\/]+$/, "")}\\Library\\bin\\${executable}`;
	}
	return `${prefixPath.replace(/\/+$/, "")}/bin/${name}`;
}

export const ENVIRONMENTS_DEFINITIONS: PluginDefinitions = {
	domains: [Conda, CondaRuntime],
};
