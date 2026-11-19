import path from "node:path";

import type { TerminalProfileEnv } from "../../contracts/profiles.js";
import type { PtyAdapter, PtyProcess } from "./pty.js";

export interface ShellCandidate {
	readonly shell: string;
	readonly args: readonly string[];
	/** Variables the shell's profile adds (null unsets one). */
	readonly env?: TerminalProfileEnv;
}

const TERMINAL_ENV_BLOCKLIST = new Set([
	"ELECTRON_RUN_AS_NODE",
	"ELECTRON_RENDERER_PORT",
	"KILO_WEB_DEV_SERVER_URL",
]);

function candidate(command: string | undefined): ShellCandidate | null {
	const shell = command?.trim();
	return shell ? { shell, args: [] } : null;
}

function unique(candidates: readonly (ShellCandidate | null)[]): ShellCandidate[] {
	const seen = new Set<string>();
	return candidates.filter((value): value is ShellCandidate => {
		if (!value || seen.has(value.shell)) return false;
		seen.add(value.shell);
		return true;
	});
}

export function resolveShellCandidates(
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
): ShellCandidate[] {
	if (platform === "win32") {
		const systemRoot = env["SystemRoot"] ?? env["SYSTEMROOT"] ?? "C:\\Windows";
		return unique([
			candidate(env["COMSPEC"] ?? env["ComSpec"]),
			candidate("pwsh.exe"),
			candidate(
				path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
			),
			candidate("powershell.exe"),
			candidate(path.win32.join(systemRoot, "System32", "cmd.exe")),
			candidate("cmd.exe"),
		]);
	}
	return unique([
		candidate(env["SHELL"]),
		candidate("/bin/zsh"),
		candidate("/bin/bash"),
		candidate("/bin/sh"),
		candidate("zsh"),
		candidate("bash"),
		candidate("sh"),
	]);
}

export function terminalEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) continue;
		const normalized = key.toUpperCase();
		if (normalized.startsWith("VITE_") || TERMINAL_ENV_BLOCKLIST.has(normalized)) continue;
		result[key] = value;
	}
	result["TERM"] = "xterm-256color";
	result["COLORTERM"] = "truecolor";
	result["TERM_PROGRAM"] = "Kilo Desktop";
	return result;
}

/**
 * The environment with a profile's variables applied (null unsets one). Apply
 * it before `terminalEnvironment`, which then strips desktop-only variables
 * and sets TERM, so no profile can undo either.
 */
export function applyProfileEnv(
	env: NodeJS.ProcessEnv,
	profileEnv: TerminalProfileEnv | undefined,
): NodeJS.ProcessEnv {
	if (!profileEnv) return env;
	const result: NodeJS.ProcessEnv = { ...env };
	for (const [key, value] of Object.entries(profileEnv)) {
		if (value === null) delete result[key];
		else result[key] = value;
	}
	return result;
}

function isRetryableSpawnError(error: unknown): boolean {
	const message =
		error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
	return /enoent|not found|no such file|posix_spawnp failed/i.test(message);
}

/**
 * Spawns the first candidate that starts. `options.env` is the terminal's
 * environment; a candidate's profile variables are applied over it. Main checks
 * that candidates exist beforehand; falling through here is a backstop for
 * spawn errors that still name a missing file (Windows reports them; POSIX
 * shells that fail to exec exit instead).
 */
export function spawnFirstAvailableShell(
	adapter: PtyAdapter,
	options: Omit<Parameters<PtyAdapter["spawn"]>[0], "shell" | "args">,
	candidates: readonly ShellCandidate[],
): PtyProcess {
	let lastError: unknown;
	for (const item of candidates) {
		const env = item.env
			? terminalEnvironment(applyProfileEnv(options.env, item.env))
			: options.env;
		try {
			return adapter.spawn({ ...options, env, shell: item.shell, args: item.args });
		} catch (error) {
			lastError = error;
			if (!isRetryableSpawnError(error)) throw error;
		}
	}
	throw lastError instanceof Error ? lastError : new Error("No supported shell could be started.");
}
