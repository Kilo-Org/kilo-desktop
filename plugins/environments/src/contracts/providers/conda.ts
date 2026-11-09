/**
 * Conda provider I/O contracts for the `environments` plugin.
 *
 * The input and output schemas of `kilo.environments/conda`'s methods
 * (envs / packages / channels / jobs); the domain object itself is in
 * `contracts/index.ts`.
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
 *   Agent-initiated tools accept only named channels — see
 *   {@link agentChannelSchema}.
 * - Environment names follow conda's own rules: start with an
 *   alphanumeric, then alphanumerics or `.`, `_`, `-`. See
 *   {@link environmentNameSchema}.
 */
import { z } from "zod";

import { jobIdSchema } from "../common.js";

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
 * True when a package spec names a source directly rather than a
 * channel-hosted package: a URL, a `file:` URI, or a local filesystem path.
 *
 * Such a spec would make conda install the referenced artifact directly and
 * run its link scripts outside any channel trust decision. Mirrors the
 * renderer's warning predicate in `conda-tool-invocation.ts`; duplicated
 * rather than imported because a cross-plugin runtime import is forbidden.
 */
function isUrlOrPathSpec(value: string): boolean {
	const spec = value.trim();
	return (
		spec.includes("://") ||
		/^file:/i.test(spec) ||
		spec.startsWith("/") ||
		spec.startsWith("~") ||
		spec.startsWith("./") ||
		spec.startsWith("../") ||
		/^[a-z]:[\\/]/i.test(spec)
	);
}

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
 *
 * Values that name a source directly — a URL, a `file:` URI, or a local
 * filesystem path — are also rejected. A package argument like
 * `/…/pkg.tar.bz2` makes conda install that artifact directly and run its
 * link scripts outside any channel trust decision, so the managed tools
 * refuse it and require installation from a channel instead.
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
	})
	.refine((value) => !isUrlOrPathSpec(value), {
		message:
			"A conda package cannot be a local file path or URL — installing from a local file " +
			"has a high security risk and is not recommended. Install from a channel instead.",
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
 *
 * This permissive form is for UI-driven flows (e.g. `conda.channels.add`)
 * where a user may legitimately configure a URL channel. Agent-initiated
 * installs use {@link agentChannelSchema} instead.
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

export const AGENT_CHANNEL_REFUSAL_MESSAGE =
	"A conda channel cannot be a URL or a local path — pointing conda at an untrusted " +
	"or local source is high risk (its packages run link scripts in your real conda) and " +
	"is not supported for agent-initiated installs. Use a named channel such as " +
	"`defaults` or `conda-forge`.";

/**
 * Agent-facing channel: a **named** channel only. URLs (`https://…`) and local
 * sources (`file://…`, `/…`, `~/…`, `C:\…`) are refused — a prompt injection
 * that supplies such a channel is the C1 code-execution vector, since conda
 * links packages from it with their post-link scripts executed.
 *
 * The permissive {@link channelSchema} stays in place for UI flows like
 * `conda.channels.add`, where a user may configure a URL channel deliberately.
 */
export const agentChannelSchema = channelSchema.refine((value) => !isUrlOrPathSpec(value), {
	message: AGENT_CHANNEL_REFUSAL_MESSAGE,
});
export type AgentChannel = z.infer<typeof agentChannelSchema>;

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
 *
 * `prefix` is an optional absolute filesystem path where the environment
 * should be created (equivalent to `conda create --prefix <path>`). When
 * provided, it takes precedence over `name` for the on-disk location.
 * The MCP-exposed tool uses a narrower schema without `prefix` so LLMs
 * cannot target arbitrary filesystem locations.
 */
export const condaEnvsCreateInputSchema = z.object({
	name: environmentNameSchema,
	channels: z.array(channelSchema).min(1).optional(),
	packages: z.array(matchSpecSchema).min(1).optional(),
	prefix: envPrefixSchema.optional(),
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
	sourcePrefix: envPrefixSchema.optional(),
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
 * Opaque, server-minted handle for a staged environment-file copy. `readFile`
 * returns it; `createFromFile` accepts only it, never a path, so the import is
 * bound to the bytes the user reviewed.
 */
export const STAGED_IMPORT_HANDLE_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const stagedImportHandleSchema = z.string().regex(STAGED_IMPORT_HANDLE_PATTERN, {
	message: "Staged import handle must be a server-minted id.",
});

/**
 * Input to `conda.envs.createFromFile`. Creates an environment from the staged
 * copy of a reviewed YAML environment file; `name` overrides the name inside it.
 */
export const condaEnvsCreateFromFileInputSchema = z.object({
	stagedHandle: stagedImportHandleSchema,
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

/**
 * Input to `conda.envs.pickFile` — opens a native OS file picker dialog
 * filtered to `.yml`/`.yaml` environment files. The handler runs in the
 * main process and returns the selected file path or `null` if cancelled.
 */
export const condaEnvsPickFileInputSchema = z.object({});
export type CondaEnvsPickFileInput = z.infer<typeof condaEnvsPickFileInputSchema>;

export const condaEnvsPickFileResultSchema = z.object({
	filePath: z.string().nullable(),
});
export type CondaEnvsPickFileResult = z.infer<typeof condaEnvsPickFileResultSchema>;

/** True when a path ends in a YAML environment-file extension. */
export function isYamlEnvFilePath(value: string): boolean {
	return /\.ya?ml$/i.test(value);
}

/**
 * Input to `conda.envs.readFile` — reads the text content of a YAML env file.
 * Reuses {@link environmentFilePathSchema} so the same path guards (null
 * bytes, control characters, padding, length cap, leading `-`) apply; the
 * extension refinement is the only `readFile`-specific rule.
 */
export const condaEnvsReadFileInputSchema = z.object({
	filePath: environmentFilePathSchema.refine(isYamlEnvFilePath, {
		message: "File must be a YAML environment file (.yml or .yaml).",
	}),
});
export type CondaEnvsReadFileInput = z.infer<typeof condaEnvsReadFileInputSchema>;

/** Result of `conda.envs.readFile`: the reviewed text plus its staged handle. */
export const condaEnvsReadFileResultSchema = z.object({
	content: z.string(),
	stagedHandle: stagedImportHandleSchema,
});
export type CondaEnvsReadFileResult = z.infer<typeof condaEnvsReadFileResultSchema>;

/**
 * Result of `conda.envs.prefixOptions` — the directories where conda
 * looks for and creates environments (`envs_dirs` from `conda info`).
 * The first entry is the default location used when no prefix is specified.
 */
export const condaEnvsPrefixOptionsResultSchema = z.object({
	envsDirs: z.array(z.string().min(1)),
	channels: z.array(z.string().min(1)),
});
export type CondaEnvsPrefixOptionsResult = z.infer<typeof condaEnvsPrefixOptionsResultSchema>;

export const condaEnvsCheckPrefixInputSchema = z.object({ prefix: envPrefixSchema });
export type CondaEnvsCheckPrefixInput = z.infer<typeof condaEnvsCheckPrefixInputSchema>;

/**
 * Why a create target is unusable. `exists-*` mirror conda's own
 * "prefix already exists" rule; the rest are failures conda would hit
 * later in the create (reserved name, path delimiter, unwritable or
 * unreadable location).
 */
export const createPrefixUnavailableReasonSchema = z.enum([
	"exists-environment",
	"exists-file",
	"reserved-name",
	"invalid-path",
	"not-writable",
	"inaccessible",
]);
export type CreatePrefixUnavailableReason = z.infer<typeof createPrefixUnavailableReasonSchema>;

/** Result of `conda.envs.checkPrefix` — whether `conda.create` may target the prefix. */
export const condaEnvsCheckPrefixResultSchema = z.discriminatedUnion("available", [
	z.object({ available: z.literal(true) }),
	z.object({ available: z.literal(false), reason: createPrefixUnavailableReasonSchema }),
]);
export type CondaEnvsCheckPrefixResult = z.infer<typeof condaEnvsCheckPrefixResultSchema>;

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

/**
 * Kept as a single flat `z.object(...).refine(...)` rather than
 * `envTargetSchema.and(...)`: an intersection lowers to a JSON Schema
 * `allOf` of two objects that each carry `additionalProperties: false`,
 * which is unsatisfiable (each branch forbids the other's keys) and breaks
 * MCP hosts validating tool input against the published schema. A flat
 * object emits one clean `{ properties, required, additionalProperties }`.
 */
export const condaPackagesInstallInputSchema = z
	.object({
		name: environmentNameSchema.optional(),
		prefix: envPrefixSchema.optional(),
		packages: z.array(matchSpecSchema).min(1),
		channels: z.array(channelSchema).min(1).optional(),
	})
	.refine((v) => v.name !== undefined || v.prefix !== undefined, {
		message: "At least one of `name` or `prefix` must be provided.",
	});
export type CondaPackagesInstallInput = z.infer<typeof condaPackagesInstallInputSchema>;

export const condaPackagesInstallResultSchema = z.object({
	jobId: jobIdSchema,
	envName: z.string(),
	installed: z.array(condaPackageSchema),
});
export type CondaPackagesInstallResult = z.infer<typeof condaPackagesInstallResultSchema>;

/** Flat object for the same reason as {@link condaPackagesInstallInputSchema}. */
export const condaPackagesRemoveInputSchema = z
	.object({
		name: environmentNameSchema.optional(),
		prefix: envPrefixSchema.optional(),
		packages: z.array(matchSpecSchema).min(1),
	})
	.refine((v) => v.name !== undefined || v.prefix !== undefined, {
		message: "At least one of `name` or `prefix` must be provided.",
	});
export type CondaPackagesRemoveInput = z.infer<typeof condaPackagesRemoveInputSchema>;

export const condaPackagesRemoveResultSchema = z.object({
	jobId: jobIdSchema,
	envName: z.string(),
	removed: z.array(z.string().min(1)),
});
export type CondaPackagesRemoveResult = z.infer<typeof condaPackagesRemoveResultSchema>;

/**
 * Input to `conda.packages.update`.
 *
 * Two mutually exclusive modes:
 * - **targeted**: pass `packages` (>=1 MatchSpec) to update just those. A
 *   version-less spec (`"numpy"`) resolves to the newest version installable
 *   under the environment's EXISTING constraints (latest-*compatible*, via
 *   conda's `UPDATE_SPECS` modifier) — not an unconditional jump to the
 *   absolute latest. Pin a version (`"numpy=1.26"`) to constrain the target version.
 *   Note the solver may relink/downgrade other installed packages and their
 *   dependencies to keep the environment consistent.
 * - **update_all**: set `updateAll: true` (and omit `packages`) to update
 *   every package in the environment to its latest compatible version.
 *
 * Providing neither or both is a VALIDATION error — the two modes stay
 * crisp. Mirrors (and tightens) the bridge's own rule ("Either provide
 * packages or set update_all=True").
 *
 * Flat object for the same reason as {@link condaPackagesInstallInputSchema}.
 */
export const condaPackagesUpdateInputSchema = z
	.object({
		name: environmentNameSchema.optional(),
		prefix: envPrefixSchema.optional(),
		packages: z.array(matchSpecSchema).min(1).optional(),
		updateAll: z.boolean().optional(),
		channels: z.array(channelSchema).min(1).optional(),
	})
	.refine((v) => v.name !== undefined || v.prefix !== undefined, {
		message: "At least one of `name` or `prefix` must be provided.",
	})
	.refine((v) => (v.packages !== undefined) !== (v.updateAll === true), {
		message: "Provide either `packages` (targeted) or `updateAll: true`, not both and not neither.",
	});
export type CondaPackagesUpdateInput = z.infer<typeof condaPackagesUpdateInputSchema>;

/**
 * Terminal result of `conda.packages.update`.
 *
 * `updated` is the set of packages conda newly linked to satisfy the
 * update: the requested packages at their new versions, plus any
 * dependencies conda added or changed to keep the environment consistent.
 * It is a "what changed" set rather than strictly "the packages you named",
 * and is empty when nothing changed (the environment was already current).
 */
export const condaPackagesUpdateResultSchema = z.object({
	jobId: jobIdSchema,
	envName: z.string(),
	updated: z.array(condaPackageSchema),
});
export type CondaPackagesUpdateResult = z.infer<typeof condaPackagesUpdateResultSchema>;

/** A single package change in a solver preview (dry-run). */
export const condaPackageChangeSchema = z.object({
	name: z.string().min(1),
	/** Version before the operation, or null for newly added packages. */
	fromVersion: z.string().nullable(),
	/** Version after the operation, or null for removed packages. */
	toVersion: z.string().nullable(),
	channel: z.string().default(""),
});
export type CondaPackageChange = z.infer<typeof condaPackageChangeSchema>;

/**
 * Flat object + refine for the same reason as `condaPackagesInstallInputSchema`:
 * a `z.intersection` (`.and()`) emits an unsatisfiable JSON Schema `allOf` when
 * both sides carry `additionalProperties: false`.
 */
export const condaPackagesPreviewInputSchema = z
	.object({
		name: environmentNameSchema.optional(),
		prefix: envPrefixSchema.optional(),
		packages: z.array(matchSpecSchema).min(1),
		channels: z.array(channelSchema).min(1).optional(),
	})
	.refine((v) => v.name !== undefined || v.prefix !== undefined, {
		message: "At least one of `name` or `prefix` must be provided.",
	});
export type CondaPackagesPreviewInput = z.infer<typeof condaPackagesPreviewInputSchema>;

export const condaPackagesPreviewResultSchema = z.object({
	/** Packages that will be upgraded. */
	upgraded: z.array(condaPackageChangeSchema),
	/** Packages that will be downgraded. */
	downgraded: z.array(condaPackageChangeSchema),
	/** Packages that will be newly installed (transitive dependencies). */
	added: z.array(condaPackageChangeSchema),
	/** Packages that will be removed. */
	removed: z.array(condaPackageChangeSchema),
	/** Packages reinstalled at the same version but different build or channel. */
	rebuilt: z.array(condaPackageChangeSchema),
	/** True when the solver found no changes needed. */
	nothingToDo: z.boolean(),
});
export type CondaPackagesPreviewResult = z.infer<typeof condaPackagesPreviewResultSchema>;

/* --------------------------------------------------------------------- */
/* Method I/O — channels                                                 */
/* --------------------------------------------------------------------- */

/**
 * Ordered list of channels currently configured for the plugin-scoped
 * `CONDARC`. Order matters for solving — the response preserves it.
 */
export const condaChannelsListResultSchema = z.array(channelSchema);
export type CondaChannelsListResult = z.infer<typeof condaChannelsListResultSchema>;

export const condaChannelsAddInputSchema = z.object({
	channel: channelSchema,
	/**
	 * 1-based priority rank for the channel: `1` is the highest priority (first
	 * in the list), larger values rank lower, and a rank past the end lands at
	 * the bottom. Omitted, the bridge appends it last, so the channels already
	 * configured keep precedence. When given for an already-configured channel,
	 * the existing entry is moved to that rank (never duplicated).
	 */
	position: z.number().int().min(1).optional(),
});
export type CondaChannelsAddInput = z.infer<typeof condaChannelsAddInputSchema>;

export const condaChannelsRemoveInputSchema = z.object({ channel: channelSchema });
export type CondaChannelsRemoveInput = z.infer<typeof condaChannelsRemoveInputSchema>;

/* --------------------------------------------------------------------- */
/* Method I/O — repodata                                                 */
/* --------------------------------------------------------------------- */

/**
 * An exact conda package name used to filter `repodata.find`.
 *
 * The bridge's `repodata.find` matches names **exactly** — it has no
 * substring or glob support — so this is an identifier, not a search term.
 * Constrained like {@link matchSpecSchema}: names reach conda as
 * identifiers, and a value starting with `-` could smuggle a CLI flag
 * (e.g. `--override-channels`) across the argv boundary. Legitimate
 * package names never start with a dash.
 */
export const repodataPackageNameSchema = z
	.string()
	.min(1)
	.max(256)
	.refine((value) => !/[\r\n\t]/.test(value), {
		message: "Package name must be a single line without tabs.",
	})
	.refine((value) => value.trim().length === value.length, {
		message: "Package name must not have leading or trailing whitespace.",
	})
	.refine((value) => !value.startsWith("-"), {
		message: "Package name must not start with '-' — that would look like a conda CLI flag.",
	});
export type RepodataPackageName = z.infer<typeof repodataPackageNameSchema>;

/**
 * A partial-match package search term for `conda.repodata.find`.
 *
 * Unlike {@link repodataPackageNameSchema} this is a *search term*, not an
 * identifier: the main process applies it as a case-insensitive partial
 * match against the cached full channel index (the bridge itself has no
 * substring support, so the term never reaches the bridge). It carries the
 * same argv-boundary guards anyway — single line, no tabs, no padding, no
 * leading `-` — because defence in depth is cheap and a flag-like "search
 * term" is never legitimate. Empty strings are rejected: omitting `query`
 * already means "no filter".
 */
export const repodataQuerySchema = z
	.string()
	.min(1)
	.max(256)
	.refine((value) => !/[\r\n\t]/.test(value), {
		message: "Query must be a single line without tabs.",
	})
	.refine((value) => value.trim().length === value.length, {
		message: "Query must not have leading or trailing whitespace.",
	})
	.refine((value) => !value.startsWith("-"), {
		message: "Query must not start with '-' — that would look like a conda CLI flag.",
	});
export type RepodataQuery = z.infer<typeof repodataQuerySchema>;

/**
 * A conda platform subdir (e.g. `"linux-64"`, `"osx-arm64"`, `"noarch"`).
 * Carries the same argv-boundary guards as {@link repodataPackageNameSchema}:
 * subdirs reach conda as identifiers, so a value with an embedded newline/tab
 * or a leading `-` could smuggle a CLI flag across the argv boundary.
 */
export const subdirSchema = z
	.string()
	.min(1)
	.max(64)
	.refine((value) => !/[\r\n\t]/.test(value), {
		message: "Subdir must be a single line without tabs.",
	})
	.refine((value) => value.trim().length === value.length, {
		message: "Subdir must not have leading or trailing whitespace.",
	})
	.refine((value) => !value.startsWith("-"), {
		message: "Subdir must not start with '-' — that would look like a conda CLI flag.",
	});
export type Subdir = z.infer<typeof subdirSchema>;

/**
 * Ceiling on how many packages one `conda.repodata.find` call returns.
 *
 * Omitting both `names` and `query` matches **every package in every
 * configured channel** (tens of thousands of records). Each returned record
 * crosses the main → renderer IPC boundary, enters the read cache, and —
 * because `conda.repodata.find` is an MCP tool — can land in a model's
 * context window. The default keeps a typical call small;
 * `REPODATA_FIND_MAX_LIMIT` caps what a caller may request (and bounds what
 * the bridge sends back).
 */
export const REPODATA_FIND_DEFAULT_LIMIT = 100;
export const REPODATA_FIND_MAX_LIMIT = 500;

/**
 * Input to `conda.repodata.find`.
 *
 * Mirrors the bridge's `repodata.find` params. Every filter is optional:
 * - `names` restricts to these **exact** package names. Omit it to walk the
 *   whole channel index — correct for building a catalog, but expensive, so
 *   `limit` still applies. An empty array is rejected as a caller bug: use
 *   omission to mean "no filter", since the bridge reads `[]` as "return
 *   nothing".
 * - `query` is a case-insensitive **partial** match, applied by the bridge
 *   over its package-name index. Results are ranked exact > prefix >
 *   substring. Mutually exclusive with `names` so the two filter modes stay
 *   crisp.
 * - `channels` overrides the configured channels.
 * - `subdirs` restricts to specific platform subdirs; omitted uses conda's
 *   defaults for the host.
 * - `limit` bounds the response — see {@link REPODATA_FIND_DEFAULT_LIMIT}.
 */
export const condaRepodataFindInputSchema = z
	.object({
		names: z.array(repodataPackageNameSchema).min(1).optional(),
		query: repodataQuerySchema.optional(),
		channels: z.array(channelSchema).min(1).optional(),
		subdirs: z.array(subdirSchema).min(1).optional(),
		limit: z
			.number()
			.int()
			.min(1)
			.max(REPODATA_FIND_MAX_LIMIT)
			.default(REPODATA_FIND_DEFAULT_LIMIT),
	})
	.refine((value) => value.names === undefined || value.query === undefined, {
		message: "Provide either `names` (exact) or `query` (partial), not both.",
	});
export type CondaRepodataFindInput = z.infer<typeof condaRepodataFindInputSchema>;

/** One available version of a package, with its artifact size in bytes. */
export const condaRepodataVersionSchema = z.object({
	version: z.string().min(1),
	size: z.number().int().min(0),
});
export type CondaRepodataVersion = z.infer<typeof condaRepodataVersionSchema>;

/**
 * One package from conda repodata, aggregated across every version and
 * channel the index holds — this is the bridge's shape, not one row per
 * name × version × build.
 *
 * `version` is the newest available version (null when the index held no
 * usable version) and `build` is its **build number**, not a build string.
 * `channel`, `summary`, and `home` are empty strings when the index does not
 * supply them, so none of them are `.min(1)`. `versions` is ordered newest
 * first, matching the bridge's own sort.
 */
export const condaRepodataPackageSchema = z.object({
	name: z.string().min(1),
	version: z.string().min(1).nullable(),
	build: z.number().int(),
	channel: z.string(),
	summary: z.string(),
	home: z.string(),
	versions: z.array(condaRepodataVersionSchema),
});
export type CondaRepodataPackage = z.infer<typeof condaRepodataPackageSchema>;

/**
 * `packages` is capped at the request's `limit`. `truncated` is true when
 * the index held more packages than were returned, signalling the caller
 * (or model) to narrow `names` rather than assume it saw everything.
 */
export const condaRepodataFindResultSchema = z.object({
	packages: z.array(condaRepodataPackageSchema),
	truncated: z.boolean(),
});
export type CondaRepodataFindResult = z.infer<typeof condaRepodataFindResultSchema>;
