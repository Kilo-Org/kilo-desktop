import path from "node:path";

import { execa, type ExecaError } from "execa";
import isObjectLike from "lodash/isObjectLike.js";

import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk";
import type { MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk/main";

import {
	environmentsErrorCodeToFeatureErrorCode,
	formatEnvironmentsErrorMessage,
	type EnvironmentsErrorCode,
} from "../../../contracts/common.js";
import {
	condaEnvSchema,
	type Channel,
	type CondaChannelsListResult,
	type CondaEnv,
	type CondaEnvsCreateInput,
	type CondaEnvsDeleteInput,
	type CondaPackage,
	type CondaPackagesInstallInput,
	type CondaPackagesInstallResult,
	type CondaPackagesRemoveInput,
	type CondaPackagesRemoveResult,
	type EnvironmentName,
} from "../../../contracts/providers/conda.js";

import type { CondaBackend, CondaCallContext } from "./CondaBackend.js";

/**
 * Maximum stderr lines the streaming write path keeps for error
 * classification. conda's fatal errors print at the very end of stderr,
 * so a bounded tail is sufficient — and it keeps memory flat even if a
 * solve emits megabytes of stderr noise before failing.
 */
const STDERR_TAIL_MAX_LINES = 50;

/**
 * Options for constructing a {@link CondaService}. Injected instead of
 * captured from process globals so unit tests can point `condaBinPath` at
 * a stub script and control the logger.
 */
export interface CondaServiceOptions {
	/** Absolute path to the resolved `conda` executable (from `stageConda`). */
	readonly condaBinPath: string;
	/**
	 * Plugin-scoped root for conda working state (from `stageConda`).
	 * Isolation env vars anchor here — never at the conda binary's own
	 * install root, which for the system-conda strategy would point at
	 * the user's personal envs and package cache.
	 */
	readonly condaFilesRoot: string;
	/** Feature-scoped logger for diagnostics. */
	readonly logger: MainSdkLogger;
	/**
	 * `execa` implementation, overridable for unit tests. Signature matches
	 * the subset of `execa` this service uses (positional args + options).
	 */
	readonly execute?: typeof execa;
}

/**
 * Concrete {@link CondaBackend} implementation that shells out to the
 * staged `conda` binary via `execa`.
 *
 * Isolation strategy (per delivery plan "Isolation" decision):
 * - `CONDA_ENVS_PATH` → `<condaFilesRoot>/envs`
 * - `CONDA_PKGS_DIRS` → `<condaFilesRoot>/pkgs`
 * - `CONDARC` → `<condaFilesRoot>/.condarc` (created lazily by later
 *   slices; conda tolerates a missing file)
 *
 * The isolation root is plugin-scoped and independent of which conda
 * binary executes, so the user's own `~/.condarc` and envs stay
 * invisible for both the bundled and system-conda strategies — and
 * re-staging the bundled prefix (a swap-replace) can never destroy
 * user-created environments living beside it.
 *
 * Sub-issue 4 wired `list` (read); sub-issue 6 layers `create` +
 * `remove` (write) on the same isolation seam. Write ops call the
 * caller-supplied `onProgress` at high-level phase boundaries and let
 * the JobQueue republish those on the plugin's event bus.
 * The remaining write ops still throw `PROVIDER_NOT_READY` with the
 * "not yet implemented" detail — sub-issues 7 – 8 fill them in without
 * touching the plumbing here.
 */
export class CondaService implements CondaBackend {
	readonly #condaBinPath: string;
	readonly #condaFilesRoot: string;
	readonly #logger: MainSdkLogger;
	readonly #execute: typeof execa;

	constructor(options: CondaServiceOptions) {
		this.#condaBinPath = options.condaBinPath;
		this.#condaFilesRoot = options.condaFilesRoot;
		this.#logger = options.logger;
		this.#execute = options.execute ?? execa;
	}

	async list(ctx?: CondaCallContext): Promise<CondaEnv[]> {
		this.#assertStaged();
		const raw = await this.#runConda(["env", "list", "--json"], ctx);
		return parseEnvList(raw);
	}

	/**
	 * Create a named conda environment inside the plugin-scoped envs
	 * directory (`CONDA_ENVS_PATH`). Emits high-level phase progress
	 * lines via `ctx.onProgress` — conda's own stdout stream is
	 * line-forwarded to the caller so the JobQueue can republish
	 * "Solving package specifications…", download percentages, etc. to
	 * the renderer live-progress banner.
	 *
	 * Argv safety: package specs and channels are appended after an
	 * explicit `--` sentinel (defence in depth on top of the
	 * leading-`-` refinements on `matchSpecSchema` and `channelSchema`)
	 * so a stray dash cannot be parsed as a conda CLI flag and escape
	 * the plugin-scoped isolation.
	 *
	 * We deliberately do NOT pass `--json` for writes: it would buffer
	 * a large structured stream we do not consume (errors come from
	 * stderr classification, not the JSON payload) and it suppresses
	 * conda's human-readable stdout progress that the banner surfaces.
	 * Cancellation still works via execa's `cancelSignal`; the process
	 * exit code + stderr drive {@link mapCondaError}.
	 */
	async create(input: CondaEnvsCreateInput, ctx?: CondaCallContext): Promise<CondaEnv> {
		this.#assertStaged();
		ctx?.onProgress?.(`Creating environment "${input.name}"…`);

		const args: string[] = ["create", "--name", input.name, "--yes"];
		for (const channel of input.channels ?? []) {
			args.push("--channel", channel);
		}
		if (input.packages && input.packages.length > 0) {
			// End-of-options sentinel: everything after `--` is a positional
			// argument. `matchSpecSchema` also rejects leading-`-` values —
			// the sentinel is defence in depth in case a future op forgets
			// the schema-side check.
			args.push("--", ...input.packages);
		}

		await this.#runCondaStreaming(args, ctx);
		ctx?.onProgress?.(`Environment "${input.name}" created.`);

		// The prefix is deterministic because `CONDA_ENVS_PATH` anchors
		// every named env under `<condaFilesRoot>/envs`. Running
		// `env list --json` here would work too but adds a second
		// subprocess for no additional information.
		return condaEnvSchema.parse({
			name: input.name,
			prefix: path.join(this.#condaFilesRoot, "envs", input.name),
		});
	}

	/**
	 * Remove a named conda environment. Emits `"Removing environment
	 * '<name>'..."` via `ctx.onProgress` and streams conda's own stdout
	 * lines through the same reporter. Errors bubble through
	 * {@link mapCondaError} — a missing env surfaces as
	 * `ENV_NOT_FOUND`.
	 */
	async remove(input: CondaEnvsDeleteInput, ctx?: CondaCallContext): Promise<void> {
		this.#assertStaged();
		ctx?.onProgress?.(`Removing environment "${input.name}"…`);
		await this.#runCondaStreaming(["env", "remove", "--name", input.name, "--yes"], ctx);
		ctx?.onProgress?.(`Environment "${input.name}" removed.`);
	}

	listPackages(_envName: EnvironmentName, _ctx?: CondaCallContext): Promise<CondaPackage[]> {
		return notImplemented("conda.packages.list");
	}

	install(
		_input: CondaPackagesInstallInput,
		_ctx?: CondaCallContext,
	): Promise<CondaPackagesInstallResult> {
		return notImplemented("conda.packages.install");
	}

	uninstall(
		_input: CondaPackagesRemoveInput,
		_ctx?: CondaCallContext,
	): Promise<CondaPackagesRemoveResult> {
		return notImplemented("conda.packages.remove");
	}

	listChannels(_ctx?: CondaCallContext): Promise<CondaChannelsListResult> {
		return notImplemented("conda.channels.list");
	}

	addChannel(_channel: Channel, _ctx?: CondaCallContext): Promise<CondaChannelsListResult> {
		return notImplemented("conda.channels.add");
	}

	removeChannel(_channel: Channel, _ctx?: CondaCallContext): Promise<CondaChannelsListResult> {
		return notImplemented("conda.channels.remove");
	}

	async #runConda(args: readonly string[], ctx?: CondaCallContext): Promise<string> {
		try {
			const result = await this.#execute(this.#condaBinPath, args as string[], {
				env: this.#isolationEnv(),
				// execa v9 renamed `signal` to `cancelSignal`; passing `signal`
				// throws a validation error instead of cancelling.
				...(ctx?.signal ? { cancelSignal: ctx.signal } : {}),
			});
			return result.stdout;
		} catch (error) {
			throw mapCondaError(error, this.#logger);
		}
	}

	/**
	 * Streaming variant used by write ops. Runs conda without buffering
	 * stdout (`buffer: false`) and forwards each stdout/stderr line to
	 * `ctx.onProgress`. Because `buffer: false` also stops execa from
	 * attaching `stderr` to a thrown error, the forwarder keeps a bounded
	 * tail of stderr lines and hands it to {@link mapCondaError} so a
	 * non-zero exit still classifies to the granular error vocabulary
	 * (ENV_EXISTS, SOLVE_FAILED, ...) instead of a bare exit-code message.
	 *
	 * Skipping the stdout buffer keeps memory flat for very long solves
	 * and unblocks the JobQueue → renderer banner pipeline: the banner
	 * shows the current phase in real time instead of sitting at
	 * "running" for the whole subprocess.
	 */
	async #runCondaStreaming(args: readonly string[], ctx?: CondaCallContext): Promise<void> {
		const subprocess = this.#execute(this.#condaBinPath, args as string[], {
			env: this.#isolationEnv(),
			// Do not buffer stdout in memory — we consume it as it arrives.
			buffer: false,
			...(ctx?.signal ? { cancelSignal: ctx.signal } : {}),
		});

		const onProgress = ctx?.onProgress;
		// Bounded tail of stderr lines for post-mortem error classification.
		// `buffer: false` means execa will NOT put stderr on the error, so
		// this is the only copy that survives the subprocess.
		const stderrTail: string[] = [];
		const forwardLines = async (
			stream: NodeJS.ReadableStream | null,
			collect?: string[],
		): Promise<void> => {
			if (!stream) return;
			stream.setEncoding("utf8");
			let buffered = "";
			const emit = (line: string) => {
				if (!line) return;
				onProgress?.(line);
				if (collect) {
					collect.push(line);
					if (collect.length > STDERR_TAIL_MAX_LINES) collect.shift();
				}
			};
			for await (const chunk of stream) {
				buffered += chunk as string;
				let newlineIndex = buffered.indexOf("\n");
				while (newlineIndex >= 0) {
					emit(buffered.slice(0, newlineIndex).trim());
					buffered = buffered.slice(newlineIndex + 1);
					newlineIndex = buffered.indexOf("\n");
				}
			}
			emit(buffered.trim());
		};

		// Read both streams concurrently with the subprocess; a misbehaving
		// reporter (or a stream error after the process already resolved)
		// must not surface as an unhandled rejection. Awaiting all three
		// together guarantees the caller sees every line before returning.
		const streamsDrained = Promise.all([
			forwardLines(subprocess.stdout),
			forwardLines(subprocess.stderr, stderrTail),
		]).catch(() => {
			// Stream errors are surfaced by the subprocess promise itself.
		});

		try {
			await subprocess;
		} catch (error) {
			// Await stream drain even on failure so we surface every log line
			// that arrived before the process died — often the most useful
			// diagnostic. Swallow drain errors (already handled above).
			await streamsDrained;
			throw mapCondaError(error, this.#logger, stderrTail.join("\n"));
		}
		await streamsDrained;
	}

	#isolationEnv(): Record<string, string> {
		const root = this.#condaFilesRoot;
		return {
			CONDA_ENVS_PATH: path.join(root, "envs"),
			CONDA_PKGS_DIRS: path.join(root, "pkgs"),
			CONDARC: path.join(root, ".condarc"),
			// conda >= 25.7 ships the conda-anaconda-tos plugin: default
			// channels (repo.anaconda.com pkgs/main, pkgs/r) require a one-time
			// Terms-of-Service acceptance, tracked per conda installation. The
			// plugin-scoped CONDARC + state isolation means the user's own
			// acceptance never carries over, so every non-interactive write
			// would die with CondaToSNonInteractiveError. This is Anaconda's
			// first-party desktop app talking to Anaconda's own repo — the ToS
			// was presented as part of the product onboarding, so auto-accept
			// inside the plugin scope is the intended UX. mapCondaError keeps
			// a ToS classification as a fallback for any channel this flag
			// does not cover.
			CONDA_PLUGINS_AUTO_ACCEPT_TOS: "yes",
		};
	}

	#assertStaged(): void {
		if (!this.#condaBinPath) {
			throw featureError("PROVIDER_NOT_READY", "Conda base has not been staged.");
		}
	}
}

function notImplemented(op: string): Promise<never> {
	return Promise.reject(
		featureError("PROVIDER_NOT_READY", `${op} is not yet implemented in this slice.`),
	);
}

function featureError(code: EnvironmentsErrorCode, detail?: string): FeatureError {
	return new FeatureError(
		formatEnvironmentsErrorMessage(code, detail),
		environmentsErrorCodeToFeatureErrorCode(code),
	);
}

/**
 * Translate raw `execa` failures and JSON-parse errors into the plugin's
 * granular {@link EnvironmentsErrorCode} vocabulary. Kept exported so
 * higher-level layers (JobQueue) can reuse it on subprocess failures they
 * observe outside a direct method call.
 *
 * `fallbackStderr` carries stderr collected out-of-band by the streaming
 * write path — with execa's `buffer: false` the thrown error has no
 * `stderr` of its own, so classification would otherwise degrade to a
 * bare "Command failed with exit code N".
 */
export function mapCondaError(
	error: unknown,
	logger?: MainSdkLogger,
	fallbackStderr?: string,
): FeatureError {
	if (error instanceof FeatureError) return error;

	// AbortSignal-triggered cancellation surfaces as an ExecaError with
	// `isCanceled` (v9+ uses `isTerminated` + a specific signal, but
	// `isCanceled` remains the stable public flag).
	if (isExecaError(error) && error.isCanceled === true) {
		return featureError("JOB_CANCELLED", "conda operation was cancelled.");
	}

	if (isExecaError(error)) {
		logger?.warn(`conda command failed: ${error.shortMessage}`);
		const stderr =
			typeof error.stderr === "string" && error.stderr.length > 0
				? error.stderr
				: (fallbackStderr ?? "");
		if (/CondaEnvironmentNotFoundError|EnvironmentLocationNotFound/i.test(stderr)) {
			return featureError("ENV_NOT_FOUND", firstLine(stderr) ?? error.shortMessage);
		}
		// `conda create` refuses to overwrite an existing prefix and reports
		// "prefix already exists" (wrapped in either CondaValueError or a
		// bare CondaError depending on version). Match the message text so
		// we do not couple to the exception class conda picks that day.
		if (/prefix already exists/i.test(stderr)) {
			return featureError("ENV_EXISTS", firstLine(stderr) ?? error.shortMessage);
		}
		// conda-anaconda-tos (conda >= 25.7) refuses non-interactive use of
		// channels whose Terms of Service were not accepted. The isolation
		// env sets CONDA_PLUGINS_AUTO_ACCEPT_TOS for the default channels,
		// but a user-added channel could still trip this — surface an
		// actionable message rather than a generic failure.
		if (/CondaToSNonInteractiveError|Terms of Service have not been accepted/i.test(stderr)) {
			return featureError(
				"PROVIDER_NOT_READY",
				"Channel Terms of Service not accepted. " +
					(firstLine(stderr) ?? "Accept the channel ToS with `conda tos accept`."),
			);
		}
		if (/PackagesNotFoundError|ResolvePackageNotFound/i.test(stderr)) {
			return featureError("PACKAGE_NOT_FOUND", firstLine(stderr) ?? error.shortMessage);
		}
		if (/UnsatisfiableError|Solver.*conflict/i.test(stderr)) {
			return featureError("SOLVE_FAILED", firstLine(stderr) ?? error.shortMessage);
		}
		if (/CondaValueError|InvalidMatchSpec/i.test(stderr)) {
			return featureError("INVALID_MATCHSPEC", firstLine(stderr) ?? error.shortMessage);
		}
		if (/(ENOENT|not found|No such file or directory)/i.test(error.shortMessage)) {
			return featureError("PROVIDER_NOT_READY", "conda binary is not accessible.");
		}
		return featureError(
			"PROVIDER_NOT_READY",
			firstLine(stderr) ?? error.shortMessage ?? "conda command failed.",
		);
	}

	if (error instanceof SyntaxError) {
		return featureError("PROVIDER_NOT_READY", `conda returned non-JSON output: ${error.message}`);
	}

	const message = error instanceof Error ? error.message : String(error);
	logger?.warn(`conda command failed with unexpected error: ${message}`);
	return featureError("PROVIDER_NOT_READY", message);
}

function firstLine(text: string): string | undefined {
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	return trimmed.split(/\r?\n/, 1)[0];
}

function isExecaError(value: unknown): value is ExecaError {
	return value instanceof Error && "shortMessage" in value && "command" in value;
}

/**
 * Parse `conda env list --json` output into the schema shape the contract
 * declares. `conda` returns `{ envs: ["<prefix>", ...] }` sorted
 * alphabetically — the base prefix is NOT guaranteed to come first, so
 * position must not be used to identify it.
 *
 * Naming follows conda's own display rule: an environment has a name only
 * when it lives directly under an `envs/` directory (an entry of
 * `envs_dirs`); the base prefix and path-based envs (`-p /some/dir`)
 * surface with an empty name.
 */
export function parseEnvList(stdout: string): CondaEnv[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout) as unknown;
	} catch (error) {
		throw featureError(
			"PROVIDER_NOT_READY",
			`conda env list returned non-JSON output: ${(error as Error).message}`,
		);
	}
	if (!isObjectLike(parsed) || !Array.isArray((parsed as { envs?: unknown }).envs)) {
		throw featureError("PROVIDER_NOT_READY", "conda env list output missing `envs` array.");
	}
	const rawEnvs = (parsed as { envs: unknown[] }).envs;
	return rawEnvs
		.filter((entry): entry is string => typeof entry === "string")
		.map((prefix) => {
			const isNamed = path.basename(path.dirname(prefix)) === "envs";
			const name = isNamed ? path.basename(prefix) : "";
			return condaEnvSchema.parse({ name, prefix });
		});
}
