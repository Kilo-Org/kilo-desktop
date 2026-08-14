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
	type CondaEnvsCreateResult,
	type CondaEnvsDeleteInput,
	type CondaEnvsDeleteResult,
	type CondaPackage,
	type CondaPackagesInstallInput,
	type CondaPackagesInstallResult,
	type CondaPackagesRemoveInput,
	type CondaPackagesRemoveResult,
	type EnvironmentName,
} from "../../../contracts/providers/conda.js";

import type { CondaBackend, CondaCallContext } from "./CondaBackend.js";

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
 * Sub-issue 4 ships **only `list`** — every write op throws
 * `PROVIDER_NOT_READY` with the "not yet implemented" detail. Sub-issues
 * 6 – 8 fill in `create`, `remove`, `install`, `uninstall`, and channel
 * ops behind the same seam without touching the plumbing here.
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
		if (!this.#condaBinPath) {
			throw featureError("PROVIDER_NOT_READY", "Conda base has not been staged.");
		}
		const raw = await this.#runConda(["env", "list", "--json"], ctx);
		return parseEnvList(raw);
	}

	create(_input: CondaEnvsCreateInput, _ctx?: CondaCallContext): Promise<CondaEnvsCreateResult> {
		return notImplemented("conda.envs.create");
	}

	remove(_input: CondaEnvsDeleteInput, _ctx?: CondaCallContext): Promise<CondaEnvsDeleteResult> {
		return notImplemented("conda.envs.delete");
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
		const root = this.#condaFilesRoot;
		const env = {
			CONDA_ENVS_PATH: path.join(root, "envs"),
			CONDA_PKGS_DIRS: path.join(root, "pkgs"),
			CONDARC: path.join(root, ".condarc"),
		};
		try {
			const result = await this.#execute(this.#condaBinPath, args as string[], {
				env,
				// execa v9 renamed `signal` to `cancelSignal`; passing `signal`
				// throws a validation error instead of cancelling.
				...(ctx?.signal ? { cancelSignal: ctx.signal } : {}),
			});
			return result.stdout;
		} catch (error) {
			throw mapCondaError(error, this.#logger);
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
 */
export function mapCondaError(error: unknown, logger?: MainSdkLogger): FeatureError {
	if (error instanceof FeatureError) return error;

	// AbortSignal-triggered cancellation surfaces as an ExecaError with
	// `isCanceled` (v9+ uses `isTerminated` + a specific signal, but
	// `isCanceled` remains the stable public flag).
	if (isExecaError(error) && error.isCanceled === true) {
		return featureError("JOB_CANCELLED", "conda operation was cancelled.");
	}

	if (isExecaError(error)) {
		logger?.warn(`conda command failed: ${error.shortMessage}`);
		const stderr = typeof error.stderr === "string" ? error.stderr : "";
		if (/CondaEnvironmentNotFoundError|EnvironmentLocationNotFound/i.test(stderr)) {
			return featureError("ENV_NOT_FOUND", firstLine(stderr) ?? error.shortMessage);
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
