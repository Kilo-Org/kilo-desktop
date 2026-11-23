import type { ExecaError } from "execa";

import { KernelError } from "@kilo-desktop/kernel";
import type { UnsupportedGitVersionError } from "@kilo-desktop/git-client";

/**
 * User-facing copy for a git binary that could not be resolved. git-client
 * memoizes the failed resolution for the client's lifetime, so installing
 * git only takes effect after a restart — the copy says so.
 */
export const GIT_NOT_FOUND_MESSAGE = "Git was not found. Install Git, then restart Kilo Desktop.";

/** "2.17.0" → "2.17": git releases are referred to by major.minor. */
function displayVersion(version: string): string {
	return version.replace(/\.0$/, "");
}

/**
 * User-facing copy for a git older than the client's minimum. Asks for a
 * restart because git-client checks the version once per client and keeps
 * the "too old" verdict for the app's lifetime.
 */
export function unsupportedGitVersionToKernelError(error: UnsupportedGitVersionError): KernelError {
	return new KernelError(
		"BUSINESS",
		`Kilo Desktop needs Git ${displayVersion(error.minimumVersion)} or newer, but found Git ${displayVersion(error.version)}. Update Git, then restart Kilo Desktop.`,
	);
}

/** A failed `gh` run as user-facing copy: not installed, not signed in, or its own stderr. */
export function ghErrorToKernelError(error: unknown): KernelError {
	const failure = error as Partial<ExecaError>;
	const detail = typeof failure.stderr === "string" ? failure.stderr.trim() : "";
	if ((failure as { code?: string }).code === "ENOENT") {
		return new KernelError(
			"BUSINESS",
			"GitHub CLI (gh) is not installed. Install it from https://cli.github.com/.",
		);
	}
	if (/auth login|not logged|authentication/i.test(detail)) {
		return new KernelError(
			"BUSINESS",
			"Not authenticated with GitHub CLI. Run 'gh auth login' first.",
		);
	}
	return new KernelError("BUSINESS", detail || "GitHub CLI operation failed.");
}
