import type { MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk";
import { FeatureError } from "@anaconda-agentic-desktop/feature-sdk";
import type { GitClient } from "@anaconda-agentic-desktop/git-client";
import { GitNotDetectedError, createGitClient } from "@anaconda-agentic-desktop/git-client";

import type { GitStatus } from "../contracts/schemas.js";

/** The slice of `GitClient` the service actually uses; `GitClient` satisfies it. */
export type GitClientSlice = Pick<GitClient, "status" | "version">;

export interface GitServiceOptions {
	readonly logger: MainSdkLogger;
	/** Factory for the shared client. Overridable in tests. */
	readonly createClient?: () => GitClientSlice;
}

function createDefaultClient(logger: MainSdkLogger): GitClientSlice {
	// git-client's `GitLogger` is the narrow `{ error }` interface, which
	// `MainSdkLogger` satisfies directly.
	return createGitClient({ logger });
}

/**
 * Status service over git-client.
 *
 * Stateless, backed by one shared client: git-client resolves the git binary
 * lazily and memoizes it per instance, so the binary resolution cost is paid
 * once per service, not per call. Each `status` call selects its working
 * directory via the client's `cwd` option.
 *
 * Semantics inherited from git-client and deliberately not deviated from:
 * - `null` means `git status` exited 128 — a missing directory and a
 *   non-repo directory are indistinguishable.
 * - `GitNotDetectedError` (no git binary on PATH) is the one error mapped to
 *   a `FeatureError` so its message survives the IPC boundary; every other
 *   error propagates unwrapped (the IPC boundary scrubs generic errors, and
 *   git-client logs the detail via the adapted logger).
 *
 * `available` is a probe, so its error semantics differ from `status` on
 * purpose: every failure collapses to `false` — including
 * `GitNotDetectedError`, which `version()` can throw synchronously because
 * binary resolution runs before the memoized promise exists, hence
 * `try { await }` rather than a `.catch()` — and `false` is an expected
 * outcome, not an error, so nothing is logged. `version()` memoizes its
 * promise per client (rejections included) and the service shares one
 * client, so the probe result is effectively cached for the app's lifetime.
 */
export class GitService {
	readonly #client: GitClientSlice;

	constructor(options: GitServiceOptions) {
		this.#client = options.createClient?.() ?? createDefaultClient(options.logger);
	}

	async status(workingDirectory: string): Promise<GitStatus | null> {
		try {
			const result = await this.#client.status({ cwd: workingDirectory });
			if (result === null) {
				return null;
			}
			// `WorkingDirectoryStatus.files` is `ReadonlyArray` in git-client
			// while the contract's input type is a mutable array — a shallow
			// spread is the only mapping needed.
			return {
				...result,
				workingDirectory: { files: [...result.workingDirectory.files] },
			};
		} catch (error) {
			if (error instanceof GitNotDetectedError) {
				throw new FeatureError(
					"Git executable not found. Install git and make sure it is on your PATH.",
					"BUSINESS",
				);
			}
			throw error;
		}
	}

	async available(): Promise<boolean> {
		try {
			// Declared `Promise<string>`, but the probe does not trust the
			// declared type across the client seam: a falsey resolved value
			// means no usable version, so it collapses to `false` too.
			return Boolean(await this.#client.version());
		} catch {
			return false;
		}
	}
}
