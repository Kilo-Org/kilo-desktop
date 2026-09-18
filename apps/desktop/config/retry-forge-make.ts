/**
 * Hardens `electron-forge make` against a well-known flake on shared macOS
 * runners: after appdmg finishes assembling the DMG, its cleanup step runs
 * `hdiutil detach /Volumes/<VolumeName>`. On loaded runners the volume can be
 * unmounted by the OS (or never fully mounted) before that call happens, so
 * `hdiutil` exits 1 with `detach failed - No such file or directory`. appdmg
 * only retries hdiutil exit code 16 (busy), so the ENOENT case surfaces as an
 * unhandled rejection and fails `electron-forge make` even though the image
 * was otherwise ready.
 *
 * Strategy: run forge normally. If it fails and the failure output matches the
 * detach-ENOENT signature, force-detach any leftover `/Volumes/<title>` mounts
 * (so a retry starts from a clean slate rather than colliding with the stale
 * mount and appdmg allocating a suffixed volume name such as `Kilo Preview 1`) and re-run. Give up
 * after a small number of attempts so a real, non-flaky failure still fails
 * the job.
 *
 * Kept as a standalone helper so it stays unit-testable without spawning
 * electron-forge or `hdiutil`.
 */

const HDIUTIL_DETACH_ENOENT = /hdiutil:\s*detach\s+failed\s*-\s*No such file or directory/i;

export interface ForgeInvocation {
	readonly command: string;
	readonly args: readonly string[];
}

export interface ExecutionOutcome {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly failed: boolean;
}

export type Executor = (invocation: ForgeInvocation) => Promise<ExecutionOutcome>;

export interface RetryForgeMakeOptions {
	/** Volume titles at `/Volumes/<title>` that must be force-detached between attempts. */
	readonly volumeTitles: readonly string[];
	/** Total attempts before giving up (default: 3). Must be >= 1. */
	readonly maxAttempts?: number;
	/** Milliseconds to wait between a failed attempt and the retry (default: 500). */
	readonly retryDelayMs?: number;
	/** Runs the actual forge command. Non-injected callers use `execa`. */
	readonly runForge: Executor;
	/**
	 * Runs `hdiutil detach -force <path>`. The helper always swallows failures
	 * here — a missing mount is the happy path (that is precisely the state
	 * we want before retrying), so an implementation that throws must not
	 * abort the retry loop.
	 */
	readonly forceDetach: (volumePath: string) => Promise<void>;
	/** Injectable sleep so tests do not wait wall-clock. */
	readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * True when the output smells like the appdmg hdiutil-detach ENOENT flake.
 *
 * We intentionally accept `stdout` matches too because appdmg pipes hdiutil's
 * stderr through its own progress reporter, so the string can appear on either
 * stream depending on Node/execa buffering on the runner.
 */
export function isHdiutilDetachEnoent(outcome: ExecutionOutcome): boolean {
	if (!outcome.failed) return false;
	return HDIUTIL_DETACH_ENOENT.test(outcome.stderr) || HDIUTIL_DETACH_ENOENT.test(outcome.stdout);
}

/**
 * Run `electron-forge make` (or a compatible invocation) with a targeted retry
 * for the hdiutil-detach-ENOENT flake. On any other failure the first outcome
 * is returned unchanged so the caller surfaces the real error.
 */
export async function runForgeMakeWithDetachRetry(
	invocation: ForgeInvocation,
	options: RetryForgeMakeOptions,
): Promise<ExecutionOutcome> {
	const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
	const retryDelayMs = options.retryDelayMs ?? 500;
	const sleep = options.sleep ?? defaultSleep;

	let lastOutcome: ExecutionOutcome | undefined;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const outcome = await options.runForge(invocation);
		lastOutcome = outcome;
		if (!outcome.failed) return outcome;
		if (!isHdiutilDetachEnoent(outcome)) return outcome;
		if (attempt === maxAttempts) return outcome;

		for (const title of options.volumeTitles) {
			try {
				await options.forceDetach(`/Volumes/${title}`);
			} catch {
				// Missing mount == happy path; a throwing implementation must
				// not stop us from detaching the remaining titles or retrying.
			}
		}
		if (retryDelayMs > 0) await sleep(retryDelayMs);
	}
	// Unreachable — the loop always returns — but TypeScript needs this.
	// The `!` is safe because `maxAttempts >= 1` guarantees one assignment.
	return lastOutcome!;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
