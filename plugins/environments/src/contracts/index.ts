import { z } from "zod";

import { defineDomainObject, method, type PluginDefinitions } from "@kilo-desktop/kernel";

import { cancelInputSchema, cancelResultSchema, jobProgressEventSchema } from "./common";
import {
	channelSchema,
	condaChannelsAddInputSchema,
	condaChannelsListResultSchema,
	condaChannelsRemoveInputSchema,
	condaChannelsResolveInputSchema,
	condaChannelsResolveResultSchema,
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
} from "./providers/conda";

export * from "./common";
export * from "./providers/conda";

/**
 * kilo.environments' public surface: the user's conda environments
 * (`conda`, behind the `environments-feature` flag) and plugin-owned
 * environments other plugins ask for (`conda-runtime`), both served by one
 * bundled conda bridge in main. It gives the Local Model Server llama.cpp
 * from a `conda-runtime` environment (a `kilo.local-inference/llama-runtime`
 * contribution).
 */
export const ENVIRONMENTS_PLUGIN_ID = "kilo.environments";

/** The LaunchDarkly flag behind Conda Environments: its settings, tools and `conda` methods. */
export const ENVIRONMENTS_FLAG = "environments-feature";

/** The settings section's id (its path is `/settings/environments`). */
export const ENVIRONMENTS_SETTINGS_SECTION = "environments";

/** The `kernel/services` key of the conda bridge daemon. */
export const BRIDGE_SERVICE_KEY = "kilo.environments/bridge";

/**
 * Origin's agent tools (`kilo.core/tool` ids), so Kilo still sees
 * `desktop_environments_conda_envs_list`…; all offered to paired external
 * apps, as origin's default did.
 */
export const CONDA_SETUP_TOOL = "conda.setup.open";
export const CONDA_TOOL_IDS = [
	"conda.envs.list",
	"conda.envs.create",
	"conda.envs.delete",
	"conda.envs.clone",
	"conda.packages.list",
	"conda.packages.install",
	"conda.packages.remove",
	"conda.packages.update",
	"conda.channels.list",
	"conda.channels.add",
	"conda.channels.remove",
	"conda.repodata.find",
] as const;

/** The conda tools that change something: they ask first, and `conda-tools` details their requests. */
export const MUTATING_CONDA_TOOL_IDS = [
	"conda.envs.create",
	"conda.envs.delete",
	"conda.envs.clone",
	"conda.packages.install",
	"conda.packages.remove",
	"conda.packages.update",
	"conda.channels.add",
	"conda.channels.remove",
] as const;

/** Its `kilo.core/chat-config` contribution: hides the conda tools while conda isn't ready, asks before conda-family `bash` commands. */
export const CONDA_CHAT_CONFIG = "conda";

/** Its `kilo.local-inference/llama-runtime` contribution: llama.cpp from a `conda-runtime` environment. */
export const CONDA_LLAMA_RUNTIME = "conda";

/** Its `kilo.chat/permission-renderer` contributions. */
export const PERMISSION_RENDERERS = {
	condaTools: "conda-tools",
	condaCli: "conda-cli",
	localFileAnswers: "local-file-answers",
} as const;

/** The telemetry events kilo.environments declares (`kernel/telemetry-event` ids). */
export const ENVIRONMENTS_TELEMETRY_EVENTS = {
	environmentCreated: "environment-created",
	environmentRemoved: "environment-removed",
} as const;

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
export const Conda = defineDomainObject({
	id: "kilo.environments/conda",
	home: "main",
	description:
		"The person's conda environments, packages and channels, through the bundled conda bridge.",
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
		/** Whether the configured channels already provide a channel. Not an agent tool. */
		resolveChannel: method(condaChannelsResolveInputSchema, condaChannelsResolveResultSchema),
		findRepodata: method(condaRepodataFindInputSchema, condaRepodataFindResultSchema),
		cancelJob: method(cancelInputSchema, cancelResultSchema),
	},
	events: {
		/** A write's progress: queued, running, then succeeded, failed or cancelled. */
		"job-progress": jobProgressEventSchema,
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
export const CondaRuntime = defineDomainObject({
	id: "kilo.environments/conda-runtime",
	home: "main",
	description: "Conda environments plugins own, created on demand.",
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
	domainObjects: [Conda, CondaRuntime],
};
