/**
 * Shared cross-provider contracts for the `environments` plugin.
 *
 * v1 registers only the `conda` provider (see `./providers/conda.ts`), but
 * every type in this file is deliberately provider-agnostic so a future
 * provider (uv, pip, poetry, ...) plugs in by:
 *
 *   1. Appending its id to {@link providerSchema}.
 *   2. Adding a new file under `./providers/<id>.ts` with its own contract.
 *
 * Nothing here references conda-specific *types* (MatchSpecs, prefixes,
 * channel identifiers). {@link jobKindSchema} names operation kinds — v1
 * ships the conda set; future providers append their own entries the same
 * way {@link providerSchema} widens.
 */
import { z } from "zod";

/* --------------------------------------------------------------------- */
/* Provider identity                                                     */
/* --------------------------------------------------------------------- */

/**
 * Registered environment providers. Widen the tuple to onboard a future
 * provider — the type widens automatically and every consumer of
 * {@link Provider} is compile-checked exhaustively.
 */
export const providerSchema = z.enum(["conda"]);
export type Provider = z.infer<typeof providerSchema>;

/* --------------------------------------------------------------------- */
/* Error vocabulary                                                      */
/* --------------------------------------------------------------------- */

/**
 * Granular reason codes for expected failures inside the environments
 * plugin. {@link KernelError} carries only a coarse
 * `code` (VALIDATION | NOT_FOUND | BUSINESS); these strings ride in the
 * `message` field so callers can branch on the concrete reason across the
 * IPC boundary.
 *
 * Handlers throw `"<CODE>"` or `"<CODE>: <detail>"` (see
 * {@link formatEnvironmentsErrorMessage}); the message crosses IPC
 * unchanged, and {@link parseEnvironmentsErrorMessage} recovers the code
 * and detail on the renderer side from the same shape.
 *
 * All codes are uppercase, colon-space separated, single-line.
 */
export const environmentsErrorCodeSchema = z.enum([
	"PREFIX_NOT_STAGED",
	"STAGING_FAILED",
	"INSTALLER_DOWNLOAD_FAILED",
	"INSTALLER_SHA_MISMATCH",
	"ENV_NOT_FOUND",
	"ENV_EXISTS",
	"PACKAGE_NOT_FOUND",
	"CHANNEL_NOT_FOUND",
	"NO_CHANNELS_CONFIGURED",
	"SOLVE_FAILED",
	"JOB_NOT_FOUND",
	"JOB_CANCELLED",
	"INVALID_MATCHSPEC",
	"INVALID_CHANNEL",
	"PROVIDER_NOT_READY",
]);
export type EnvironmentsErrorCode = z.infer<typeof environmentsErrorCodeSchema>;

/**
 * Regex used by {@link parseEnvironmentsErrorMessage} to peel a granular
 * environments error code off the front of a KernelError message.
 *
 * Exposed so tests and consumers can share one definition.
 */
export const ENVIRONMENTS_ERROR_MESSAGE_PATTERN = /^([A-Z][A-Z0-9_]*)(?::\s+(.+))?$/s;

/**
 * Matches ANSI escape sequences emitted by conda's solver reports (SGR
 * color codes and other CSI sequences). The bridge sidecar captures conda
 * output with color enabled, so raw details arrive wrapped in e.g.
 * `\x1b[32m…\x1b[0m`; renderers are not terminals and would show the
 * leftover `[32m` fragments as literal text.
 */
// oxlint-disable-next-line no-control-regex -- intentionally matching terminal escape sequences
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * Encode a granular reason into the string form carried by
 * `KernelError.message` so downstream consumers can recover the reason
 * via {@link parseEnvironmentsErrorMessage}.
 *
 * `detail` is trimmed and stripped of ANSI escape sequences. Line breaks
 * are preserved (only trailing per-line whitespace is dropped): solver
 * conflict reports use newlines and indentation to draw a dependency tree,
 * and UI surfaces render the detail inside `whitespace-pre-wrap` blocks.
 * Multi-line details stay parseable because
 * {@link ENVIRONMENTS_ERROR_MESSAGE_PATTERN} matches across lines.
 */
export function formatEnvironmentsErrorMessage(
	code: EnvironmentsErrorCode,
	detail?: string,
): string {
	const trimmed = detail
		?.replace(ANSI_ESCAPE_PATTERN, "")
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trim();
	return trimmed ? `${code}: ${trimmed}` : code;
}

/**
 * Extract the granular reason encoded in a KernelError message
 * (`"CODE: detail"` — the shape {@link formatEnvironmentsErrorMessage}
 * produces). Returns `null` for messages that do not follow the convention
 * (they may still be legitimate KernelErrors — e.g. a kernel-level
 * VALIDATION from the router — just not ones this plugin authored).
 */
export function parseEnvironmentsErrorMessage(
	message: string,
): { code: EnvironmentsErrorCode; detail?: string } | null {
	const match = ENVIRONMENTS_ERROR_MESSAGE_PATTERN.exec(message);
	if (!match) return null;
	const parsed = environmentsErrorCodeSchema.safeParse(match[1]);
	if (!parsed.success) return null;
	return match[2] ? { code: parsed.data, detail: match[2] } : { code: parsed.data };
}

/**
 * Per-code transport bucket. A `Record` keyed by {@link EnvironmentsErrorCode}
 * so onboarding a new code without classifying it is a compile error — a
 * `switch` with a `default` would silently bucket new codes as BUSINESS.
 */
const kernelErrorCodeByEnvironmentsErrorCode: Record<
	EnvironmentsErrorCode,
	"VALIDATION" | "NOT_FOUND" | "BUSINESS"
> = {
	PREFIX_NOT_STAGED: "BUSINESS",
	STAGING_FAILED: "BUSINESS",
	INSTALLER_DOWNLOAD_FAILED: "BUSINESS",
	INSTALLER_SHA_MISMATCH: "BUSINESS",
	ENV_NOT_FOUND: "NOT_FOUND",
	ENV_EXISTS: "VALIDATION",
	PACKAGE_NOT_FOUND: "NOT_FOUND",
	CHANNEL_NOT_FOUND: "NOT_FOUND",
	NO_CHANNELS_CONFIGURED: "BUSINESS",
	SOLVE_FAILED: "BUSINESS",
	JOB_NOT_FOUND: "NOT_FOUND",
	JOB_CANCELLED: "BUSINESS",
	INVALID_MATCHSPEC: "VALIDATION",
	INVALID_CHANNEL: "VALIDATION",
	PROVIDER_NOT_READY: "BUSINESS",
};

/**
 * Map a granular reason to the three-value `KernelError.code` alphabet
 * so the shell's IPC layer picks the right transport bucket.
 *
 * Callers throw `new KernelError(environmentsErrorCodeToKernelErrorCode(code),
 * formatEnvironmentsErrorMessage(code, detail))`.
 */
export function environmentsErrorCodeToKernelErrorCode(
	code: EnvironmentsErrorCode,
): "VALIDATION" | "NOT_FOUND" | "BUSINESS" {
	return kernelErrorCodeByEnvironmentsErrorCode[code];
}

/* --------------------------------------------------------------------- */
/* Job identity + progress events                                        */
/* --------------------------------------------------------------------- */

/**
 * Opaque identifier for a queued or in-flight job. Emitted by the shared
 * `JobQueue` (sub-issue 5) when a mutating tool enqueues work.
 *
 * Callers must not assume any structure (uuid, monotonic id, ...) — treat
 * it as an opaque string.
 */
export const jobIdSchema = z.string().min(1);
export type JobId = z.infer<typeof jobIdSchema>;

/**
 * A short, stable identifier for the operation kind a job is performing.
 * Used by renderer banners to label the live-progress card
 * ("Creating environment...", "Installing packages...").
 *
 * v1 covers every mutating conda op. A future provider whose vocabulary
 * differs (e.g. uv/pip "indexes" instead of channels) appends its own
 * kinds here, mirroring how {@link providerSchema} widens. Each kind is
 * referenced from the provider's tool namespace (e.g. `conda.envs.create`
 * emits `envs.create`).
 */
export const jobKindSchema = z.enum([
	"envs.create",
	"envs.clone",
	"envs.createFromFile",
	"envs.delete",
	"packages.install",
	"packages.remove",
	"packages.update",
	"channels.add",
	"channels.remove",
]);
export type JobKind = z.infer<typeof jobKindSchema>;

/**
 * Structured error payload attached to terminal `failed` progress events.
 * `code` is one of the granular {@link environmentsErrorCodeSchema} values
 * (enforced at parse time); `message` is a human-readable detail suitable
 * for UI display.
 */
export const jobErrorSchema = z.object({
	code: environmentsErrorCodeSchema,
	message: z.string().min(1),
});
export type JobError = z.infer<typeof jobErrorSchema>;

const jobEnvelopeShape = {
	jobId: jobIdSchema,
	provider: providerSchema,
	kind: jobKindSchema,
} as const;

/**
 * Progress event emitted by the shared `JobQueue` as `kilo.environments/conda`'s
 * `job-progress`.
 *
 * Modelled as a discriminated union on `status` so callers can narrow to
 * the fields they need (e.g. `message` is only present while running;
 * `error` is only present when failed).
 *
 * State machine:
 * ```
 *  queued ──> running ──> succeeded
 *                │
 *                ├─────> failed
 *                └─────> cancelled
 * ```
 */
export const jobProgressEventSchema = z.discriminatedUnion("status", [
	z.object({ ...jobEnvelopeShape, status: z.literal("queued") }),
	z.object({
		...jobEnvelopeShape,
		status: z.literal("running"),
		message: z.string().min(1).optional(),
	}),
	z.object({ ...jobEnvelopeShape, status: z.literal("succeeded") }),
	z.object({ ...jobEnvelopeShape, status: z.literal("failed"), error: jobErrorSchema }),
	z.object({ ...jobEnvelopeShape, status: z.literal("cancelled") }),
]);
export type JobProgressEvent = z.infer<typeof jobProgressEventSchema>;

/* --------------------------------------------------------------------- */
/* Cancellation                                                          */
/* --------------------------------------------------------------------- */

/**
 * Input to the per-provider `<provider>.jobs.cancel` tool. Cancelling a
 * job that has already reached a terminal state or whose id is unknown
 * is a no-op (returns `cancelled: false`) — the queue evicts records
 * once a job settles, so the two cases are indistinguishable. This is
 * intentionally idempotent: a UI Cancel button that races the job's
 * own completion never errors.
 */
export const cancelInputSchema = z.object({ jobId: jobIdSchema });
export type CancelInput = z.infer<typeof cancelInputSchema>;

/** Terminal result of a cancel request. */
export const cancelResultSchema = z.object({
	jobId: jobIdSchema,
	cancelled: z.boolean(),
});
export type CancelResult = z.infer<typeof cancelResultSchema>;
