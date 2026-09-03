/**
 * Conda provider I/O contracts for the `environments` plugin.
 *
 * Every v1 conda handler (envs / packages / channels / jobs) is declared
 * here as one `defineMethod(input, output)` entry inside
 * {@link condaContract}. The main-process provider binds handlers via
 * `mainSdk.channels(condaContract).handleAll({ ... })`; the renderer types
 * calls through {@link CondaService}.
 *
 * Semantics (see the delivery plan `.kilo/plans/...conda-environments-plugin-approaches.md`):
 * - Mutating ops enqueue on the shared `JobQueue` and **return the
 *   terminal result inline**. `jobId` on the response lets the renderer
 *   correlate `environments.job-progress` events (for the live-progress
 *   banner) with the initiating call and drive `conda.jobs.cancel`.
 * - Reads (`conda.envs.list`, `conda.packages.list`, `conda.channels.list`)
 *   bypass the queue via a 5 s cache invalidated on any successful write
 *   for the same provider (sub-issue 5).
 *
 * Format decisions:
 * - Package specs are raw conda MatchSpec strings (e.g. `"numpy>=1.24"`),
 *   validated for shape at the contract boundary and semantically at the
 *   provider. See {@link matchSpecSchema}.
 * - Channels are raw conda channel identifiers (short names like
 *   `"conda-forge"`, URLs, or `file://` paths). See {@link channelSchema}.
 * - Environment names follow conda's own rules: start with an
 *   alphanumeric, then alphanumerics or `.`, `_`, `-`. See
 *   {@link environmentNameSchema}.
 */
import { z } from "zod";

import {
	defineContract,
	defineMethod,
	type InferContract,
} from "@anaconda-agentic-desktop/feature-sdk";

import { cancelInputSchema, cancelResultSchema, jobIdSchema } from "../common.js";

/* --------------------------------------------------------------------- */
/* Primitive value schemas                                               */
/* --------------------------------------------------------------------- */

/**
 * Regex enforcing conda's environment-name rules: first character must be
 * alphanumeric, remaining characters are alphanumerics or `.`, `_`, `-`.
 * Path separators, whitespace, and leading dots are rejected. Exported so
 * tests and consumers can validate ad hoc without re-deriving the rule.
 */
export const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A conda environment name (not a prefix path). */
export const environmentNameSchema = z.string().min(1).max(128).regex(ENVIRONMENT_NAME_PATTERN);
export type EnvironmentName = z.infer<typeof environmentNameSchema>;

/**
 * Absolute on-disk path to an environment root. Rejects a leading `-` so
 * the value cannot be mistaken for a conda CLI flag. Legitimate absolute
 * paths on every platform start with `/` (POSIX) or a drive letter
 * (Windows), never a dash.
 */
export const envPrefixSchema = z
	.string()
	.min(1)
	.max(4096)
	.refine((v) => !v.startsWith("-"), {
		message: "Prefix must not start with '-' — that would look like a conda CLI flag.",
	})
	.refine((v) => /^(?:\/|[A-Za-z]:[/\\])/.test(v), {
		message: "Prefix must be an absolute path (starts with / or a drive letter).",
	})
	// oxlint-disable-next-line no-control-regex -- intentionally rejecting control characters
	.refine((v) => !/[\u0000-\u001f]/.test(v), {
		message: "Prefix must not contain control characters.",
	});
export type EnvPrefix = z.infer<typeof envPrefixSchema>;

/**
 * Identifies a conda environment by **name** or **prefix**.
 *
 * `conda env list --json` reports `name: ""` for base installs and envs
 * created with `conda create -p /path` (prefix-addressed envs). Those
 * environments are fully functional — every conda operation accepts `-p
 * <prefix>` as an alternative to `-n <name>`. The contract mirrors that:
 * callers supply whichever identifier they have.
 *
 * When both are present, handlers prefer `prefix` because it is
 * unambiguous (a name can shadow envs across different `envs_dirs`).
 */
export const envTargetSchema = z
	.object({
		name: environmentNameSchema.optional(),
		prefix: envPrefixSchema.optional(),
	})
	.refine((v) => v.name !== undefined || v.prefix !== undefined, {
		message: "At least one of `name` or `prefix` must be provided.",
	});
export type EnvTarget = z.infer<typeof envTargetSchema>;

/**
 * Raw conda MatchSpec string, e.g. `"numpy"`, `"numpy>=1.24"`,
 * `"conda-forge::pandas=2.*=py311_*"`. The contract accepts any
 * non-empty, single-line, printable string; deeper validation
 * (`INVALID_MATCHSPEC`) is the provider's job because it needs the same
 * parser conda itself uses.
 *
 * Values whose first non-whitespace character is `-` are rejected so
 * they cannot smuggle a conda CLI flag through as a positional argv —
 * Python argparse accepts options interspersed with positionals, and
 * MatchSpec strings never legitimately start with a dash.
 */
export const matchSpecSchema = z
	.string()
	.min(1)
	.max(512)
	.refine((value) => !/[\r\n\t]/.test(value), {
		message: "MatchSpec must be a single line without tabs.",
	})
	.refine((value) => value.trim().length === value.length, {
		message: "MatchSpec must not have leading or trailing whitespace.",
	})
	.refine((value) => !value.startsWith("-"), {
		message: "MatchSpec must not start with '-' — that would look like a conda CLI flag.",
	});
export type MatchSpec = z.infer<typeof matchSpecSchema>;

/**
 * Raw conda channel identifier — a short name (`"conda-forge"`), a URL
 * (`"https://conda.anaconda.org/..."`), or a `file://` path. The contract
 * only checks for non-empty single-line input; provider-side validation
 * (`INVALID_CHANNEL`) applies conda's own rules.
 *
 * A leading `-` is rejected so a channel identifier cannot pass for a
 * conda CLI flag when appended to argv. Legitimate channel names, URLs,
 * and file paths never start with `-`.
 */
export const channelSchema = z
	.string()
	.min(1)
	.max(1024)
	.refine((value) => !/[\r\n\t]/.test(value), {
		message: "Channel must be a single line without tabs.",
	})
	.refine((value) => value.trim().length === value.length, {
		message: "Channel must not have leading or trailing whitespace.",
	})
	.refine((value) => !value.startsWith("-"), {
		message: "Channel must not start with '-' — that would look like a conda CLI flag.",
	});
export type Channel = z.infer<typeof channelSchema>;

/* --------------------------------------------------------------------- */
/* Domain value schemas                                                  */
/* --------------------------------------------------------------------- */

/**
 * One entry in `conda env list --json`.
 *
 * `name` is present for named envs; base and anonymous envs surface as
 * empty strings from conda, so the schema tolerates that. `prefix` is
 * always the absolute on-disk path to the env root.
 */
export const condaEnvSchema = z.object({
	name: z.string(),
	prefix: z.string().min(1),
});
export type CondaEnv = z.infer<typeof condaEnvSchema>;

/**
 * One installed package as reported by `conda list --json`. Fields kept
 * minimal for v1; extend as UI/tool needs grow.
 */
export const condaPackageSchema = z.object({
	name: z.string().min(1),
	version: z.string().min(1),
	build: z.string().min(1),
	channel: z.string().min(1),
});
export type CondaPackage = z.infer<typeof condaPackageSchema>;

/**
 * A discovered local conda distribution root, returned by
 * `conda_tools.find_distributions`. Higher priority means the
 * distribution is more likely to be the user's primary install.
 */
export const condaDistributionSchema = z.object({
	prefix: z.string().min(1),
	priority: z.number().int(),
});
export type CondaDistribution = z.infer<typeof condaDistributionSchema>;

/* --------------------------------------------------------------------- */
/* Method I/O — envs                                                     */
/* --------------------------------------------------------------------- */

/**
 * Input to `conda.envs.create`. `channels` and `packages` are optional so
 * callers can create an empty env; when provided, both must be non-empty
 * (an empty list would be a caller bug and is rejected as VALIDATION).
 */
export const condaEnvsCreateInputSchema = z.object({
	name: environmentNameSchema,
	channels: z.array(channelSchema).min(1).optional(),
	packages: z.array(matchSpecSchema).min(1).optional(),
});
export type CondaEnvsCreateInput = z.infer<typeof condaEnvsCreateInputSchema>;

/** Terminal result of `conda.envs.create`. */
export const condaEnvsCreateResultSchema = z.object({
	jobId: jobIdSchema,
	environment: condaEnvSchema,
});
export type CondaEnvsCreateResult = z.infer<typeof condaEnvsCreateResultSchema>;

export const condaEnvsDeleteInputSchema = envTargetSchema;
export type CondaEnvsDeleteInput = z.infer<typeof condaEnvsDeleteInputSchema>;

export const condaEnvsDeleteResultSchema = z.object({
	jobId: jobIdSchema,
	name: z.string(),
	prefix: envPrefixSchema.optional(),
});
export type CondaEnvsDeleteResult = z.infer<typeof condaEnvsDeleteResultSchema>;

/** Input to `conda.envs.clone`. Clones `sourceName` into a new env `name`. */
export const condaEnvsCloneInputSchema = z.object({
	sourceName: environmentNameSchema,
	name: environmentNameSchema,
});
export type CondaEnvsCloneInput = z.infer<typeof condaEnvsCloneInputSchema>;

/** Terminal result of `conda.envs.clone`. */
export const condaEnvsCloneResultSchema = z.object({
	jobId: jobIdSchema,
	environment: condaEnvSchema,
});
export type CondaEnvsCloneResult = z.infer<typeof condaEnvsCloneResultSchema>;

/**
 * Path to an exported conda environment file (`environment.yml`, or a
 * `--file` style spec list). Guards mirror {@link matchSpecSchema} and
 * {@link channelSchema} because this value crosses the same IPC boundary
 * and reaches the bridge as a conda argument:
 *
 * - A leading `-` is rejected so a path cannot pass for a conda CLI flag
 *   (Python argparse accepts options interspersed with positionals).
 * - Null bytes are rejected — they truncate paths in POSIX syscalls.
 * - CR/LF/TAB are rejected, and leading/trailing whitespace is rejected.
 *   Interior spaces are allowed: `/Users/me/My Documents/env.yml` is a
 *   legitimate path.
 * - Length is capped at Linux's `PATH_MAX` so the value stays bounded
 *   without rejecting legitimately deep paths.
 */
export const environmentFilePathSchema = z
	.string()
	.min(1)
	.max(4096)
	.refine((value) => !value.includes("\0"), {
		message: "File path must not contain null bytes.",
	})
	.refine((value) => !/[\r\n\t]/.test(value), {
		message: "File path must be a single line without tabs.",
	})
	.refine((value) => value.trim().length === value.length, {
		message: "File path must not have leading or trailing whitespace.",
	})
	.refine((value) => !value.startsWith("-"), {
		message: "File path must not start with '-' — that would look like a conda CLI flag.",
	});

/**
 * Input to `conda.envs.createFromFile`. Creates an environment from an
 * exported YAML/txt file. `name` overrides the name inside the file.
 */
export const condaEnvsCreateFromFileInputSchema = z.object({
	file: environmentFilePathSchema,
	name: environmentNameSchema.optional(),
});
export type CondaEnvsCreateFromFileInput = z.infer<typeof condaEnvsCreateFromFileInputSchema>;

/** Terminal result of `conda.envs.createFromFile`. */
export const condaEnvsCreateFromFileResultSchema = z.object({
	jobId: jobIdSchema,
	environment: condaEnvSchema,
});
export type CondaEnvsCreateFromFileResult = z.infer<typeof condaEnvsCreateFromFileResultSchema>;

/** Result of `conda.envs.distributions`. */
export const condaEnvsDistributionsResultSchema = z.object({
	distributions: z.array(condaDistributionSchema),
});
export type CondaEnvsDistributionsResult = z.infer<typeof condaEnvsDistributionsResultSchema>;

/* --------------------------------------------------------------------- */
/* Method I/O — packages                                                 */
/* --------------------------------------------------------------------- */

export const condaPackagesListInputSchema = envTargetSchema;
export type CondaPackagesListInput = z.infer<typeof condaPackagesListInputSchema>;

export const condaPackagesListResultSchema = z.object({
	envName: z.string(),
	packages: z.array(condaPackageSchema),
});
export type CondaPackagesListResult = z.infer<typeof condaPackagesListResultSchema>;

export const condaPackagesInstallInputSchema = envTargetSchema.and(
	z.object({
		packages: z.array(matchSpecSchema).min(1),
		channels: z.array(channelSchema).min(1).optional(),
	}),
);
export type CondaPackagesInstallInput = z.infer<typeof condaPackagesInstallInputSchema>;

export const condaPackagesInstallResultSchema = z.object({
	jobId: jobIdSchema,
	envName: z.string(),
	installed: z.array(condaPackageSchema),
});
export type CondaPackagesInstallResult = z.infer<typeof condaPackagesInstallResultSchema>;

export const condaPackagesRemoveInputSchema = envTargetSchema.and(
	z.object({
		packages: z.array(matchSpecSchema).min(1),
	}),
);
export type CondaPackagesRemoveInput = z.infer<typeof condaPackagesRemoveInputSchema>;

export const condaPackagesRemoveResultSchema = z.object({
	jobId: jobIdSchema,
	envName: z.string(),
	removed: z.array(z.string().min(1)),
});
export type CondaPackagesRemoveResult = z.infer<typeof condaPackagesRemoveResultSchema>;

/* --------------------------------------------------------------------- */
/* Method I/O — channels                                                 */
/* --------------------------------------------------------------------- */

/**
 * Ordered list of channels currently configured for the plugin-scoped
 * `CONDARC`. Order matters for solving — the response preserves it.
 */
export const condaChannelsListResultSchema = z.array(channelSchema);
export type CondaChannelsListResult = z.infer<typeof condaChannelsListResultSchema>;

export const condaChannelsAddInputSchema = z.object({ channel: channelSchema });
export type CondaChannelsAddInput = z.infer<typeof condaChannelsAddInputSchema>;

export const condaChannelsRemoveInputSchema = z.object({ channel: channelSchema });
export type CondaChannelsRemoveInput = z.infer<typeof condaChannelsRemoveInputSchema>;

/* --------------------------------------------------------------------- */
/* Contract                                                              */
/* --------------------------------------------------------------------- */

/**
 * Feature-SDK contract for the conda provider. Method names are
 * dot-namespaced (`<domain>.<op>`) — every tool the plugin ships shares
 * this key and the provider prefix (`conda.`) is stripped by the shell
 * when publishing wire names (see `providers/conda/tools.ts` in later
 * slices).
 *
 * @example
 * ```ts
 * const { client } = useSdk<CondaService>("environments");
 * const envs = await client["conda.envs.list"]();
 * ```
 */
export const condaContract = defineContract({
	"conda.envs.list": defineMethod(z.undefined(), z.array(condaEnvSchema)),
	"conda.envs.distributions": defineMethod(z.undefined(), condaEnvsDistributionsResultSchema),
	"conda.envs.create": defineMethod(condaEnvsCreateInputSchema, condaEnvsCreateResultSchema),
	"conda.envs.clone": defineMethod(condaEnvsCloneInputSchema, condaEnvsCloneResultSchema),
	"conda.envs.createFromFile": defineMethod(
		condaEnvsCreateFromFileInputSchema,
		condaEnvsCreateFromFileResultSchema,
	),
	"conda.envs.delete": defineMethod(condaEnvsDeleteInputSchema, condaEnvsDeleteResultSchema),

	"conda.packages.list": defineMethod(condaPackagesListInputSchema, condaPackagesListResultSchema),
	"conda.packages.install": defineMethod(
		condaPackagesInstallInputSchema,
		condaPackagesInstallResultSchema,
	),
	"conda.packages.remove": defineMethod(
		condaPackagesRemoveInputSchema,
		condaPackagesRemoveResultSchema,
	),

	"conda.channels.list": defineMethod(z.undefined(), condaChannelsListResultSchema),
	"conda.channels.add": defineMethod(condaChannelsAddInputSchema, condaChannelsListResultSchema),
	"conda.channels.remove": defineMethod(
		condaChannelsRemoveInputSchema,
		condaChannelsListResultSchema,
	),

	"conda.jobs.cancel": defineMethod(cancelInputSchema, cancelResultSchema),
});

/** Method-style service type inferred from the contract. */
export type CondaService = InferContract<typeof condaContract>;
