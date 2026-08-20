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

export const condaEnvsDeleteInputSchema = z.object({ name: environmentNameSchema });
export type CondaEnvsDeleteInput = z.infer<typeof condaEnvsDeleteInputSchema>;

export const condaEnvsDeleteResultSchema = z.object({
	jobId: jobIdSchema,
	name: environmentNameSchema,
});
export type CondaEnvsDeleteResult = z.infer<typeof condaEnvsDeleteResultSchema>;

/* --------------------------------------------------------------------- */
/* Method I/O — packages                                                 */
/* --------------------------------------------------------------------- */

export const condaPackagesListInputSchema = z.object({ envName: environmentNameSchema });
export type CondaPackagesListInput = z.infer<typeof condaPackagesListInputSchema>;

export const condaPackagesListResultSchema = z.object({
	envName: environmentNameSchema,
	packages: z.array(condaPackageSchema),
});
export type CondaPackagesListResult = z.infer<typeof condaPackagesListResultSchema>;

export const condaPackagesInstallInputSchema = z.object({
	envName: environmentNameSchema,
	packages: z.array(matchSpecSchema).min(1),
	channels: z.array(channelSchema).min(1).optional(),
});
export type CondaPackagesInstallInput = z.infer<typeof condaPackagesInstallInputSchema>;

export const condaPackagesInstallResultSchema = z.object({
	jobId: jobIdSchema,
	envName: environmentNameSchema,
	installed: z.array(condaPackageSchema),
});
export type CondaPackagesInstallResult = z.infer<typeof condaPackagesInstallResultSchema>;

export const condaPackagesRemoveInputSchema = z.object({
	envName: environmentNameSchema,
	packages: z.array(matchSpecSchema).min(1),
});
export type CondaPackagesRemoveInput = z.infer<typeof condaPackagesRemoveInputSchema>;

export const condaPackagesRemoveResultSchema = z.object({
	jobId: jobIdSchema,
	envName: environmentNameSchema,
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
	"conda.envs.create": defineMethod(condaEnvsCreateInputSchema, condaEnvsCreateResultSchema),
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
