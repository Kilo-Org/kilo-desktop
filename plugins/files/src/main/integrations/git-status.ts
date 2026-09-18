import { stat } from "node:fs/promises";
import path from "node:path";

import type { MainSdk } from "@kilo-desktop/feature-sdk/main";

import type { FileGitStatus, FileGitStatusEntry } from "../../contracts/schemas.js";

/** git-client's `AppFileStatus` kind literals — asserted, not imported. */
const STATUS_KINDS = [
	"New",
	"Modified",
	"Deleted",
	"Copied",
	"Renamed",
	"Untracked",
	"Conflicted",
] as const;
type StatusKind = (typeof STATUS_KINDS)[number];

/** Structural capability shape from the git plugin — asserted, not imported. */
interface GitPluginCapability extends Record<string, unknown> {
	gitService: {
		status(workingDirectory: string): Promise<{
			workingDirectory: { files: ReadonlyArray<{ path: string; status: { kind: StatusKind } }> };
		} | null>;
	};
}

/**
 * git-client kind → tree decoration status. Exhaustive over the structural
 * kind literals so a new upstream kind becomes a compile error here; a kind
 * that still slips past the structural assertion at runtime is skipped with a
 * warning rather than failing the lookup. Copied collapses into `added`
 * (pierre has no copy status) and Conflicted into `modified` (pierre has no
 * conflict status); `ignored` never occurs because the status run does not
 * pass `--ignored`.
 */
const FILE_STATUS_BY_KIND: Record<StatusKind, FileGitStatus> = {
	New: "added",
	Modified: "modified",
	Deleted: "deleted",
	Copied: "added",
	Renamed: "renamed",
	Untracked: "untracked",
	Conflicted: "modified",
};

/**
 * Best-effort git status lookup for tree decorations.
 *
 * `git status --porcelain=2` always reports paths relative to the repository
 * root, while the files tree renders paths relative to the workspace folder.
 * The two only align when the workspace folder *is* the worktree root, so a
 * `.git` entry (directory or file — linked worktrees and submodules carry a
 * `.git` file) in the workspace directory gates every probe: subdirectory
 * workspaces get no decorations in v1 rather than misattributed ones. The
 * cheap stat deliberately runs before delegating to git, and a missing or
 * inactive git plugin degrades to `null` — decorations are never worth an
 * error surface.
 */
export function createGitStatusLookup(
	mainSdk: MainSdk,
): (canonicalWorkspaceDirectory: string) => Promise<FileGitStatusEntry[] | null> {
	return async (workspaceDirectory) => {
		const gitService = mainSdk.plugins.get<GitPluginCapability>("git")?.gitService;
		if (!gitService) {
			return null;
		}
		try {
			await stat(path.join(workspaceDirectory, ".git"));
		} catch {
			return null;
		}
		try {
			const status = await gitService.status(workspaceDirectory);
			if (!status) {
				return null;
			}
			const unknownKinds = new Set<string>();
			const entries = status.workingDirectory.files.flatMap(({ path, status: fileStatus }) => {
				const mapped: FileGitStatus | undefined = FILE_STATUS_BY_KIND[fileStatus.kind];
				if (mapped !== undefined) return [{ path, status: mapped }];
				unknownKinds.add(fileStatus.kind);
				return [];
			});
			if (unknownKinds.size > 0) {
				mainSdk.logger.warn(
					`Git status skipped unknown status kinds: ${[...unknownKinds].join(", ")}`,
				);
			}
			return entries;
		} catch (error) {
			mainSdk.logger.warn(`Git status lookup failed: ${String(error)}`);
			return null;
		}
	};
}
