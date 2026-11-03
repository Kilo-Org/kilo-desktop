import { stat } from "node:fs/promises";
import path from "node:path";

import type { KernelLogger } from "@kilo-desktop/kernel";
import type {
	VcsFileStatusKind,
	VcsImplementation,
} from "@kilo-desktop/plugin-workspaces/contracts";

import type { FileGitStatus, FileGitStatusEntry } from "../contracts/models.js";

/**
 * Version control kind → tree decoration status. Copied collapses into
 * `added` (Pierre has no copy status) and Conflicted into `modified` (no
 * conflict status); `ignored` never occurs because ignored files aren't listed.
 */
const FILE_STATUS_BY_KIND: Record<VcsFileStatusKind, FileGitStatus> = {
	New: "added",
	Modified: "modified",
	Deleted: "deleted",
	Copied: "added",
	Renamed: "renamed",
	Untracked: "untracked",
	Conflicted: "modified",
};

/**
 * Best-effort status lookup for tree decorations, through
 * `kilo.workspaces/vcs` (decision 55). Status paths are relative to the
 * repository root while the tree's are relative to the workspace folder, so
 * they only align when the folder *is* the worktree root: a `.git` entry
 * (directory, or the file of a linked worktree or submodule) gates every
 * probe, and other folders get no decorations rather than misattributed ones.
 * No provider, or a failing one, degrades to `null`.
 */
export function createGitStatusLookup(
	vcs: () => VcsImplementation | undefined,
	logger: KernelLogger,
): (canonicalWorkspaceDirectory: string) => Promise<FileGitStatusEntry[] | null> {
	return async (workspaceDirectory) => {
		const provider = vcs();
		if (!provider) return null;
		try {
			await stat(path.join(workspaceDirectory, ".git"));
		} catch {
			return null;
		}
		try {
			const status = await provider.status(workspaceDirectory);
			if (!status) return null;
			const unknownKinds = new Set<string>();
			const entries = status.workingDirectory.files.flatMap(({ path: filePath, status: file }) => {
				const mapped: FileGitStatus | undefined = FILE_STATUS_BY_KIND[file.kind];
				if (mapped !== undefined) return [{ path: filePath, status: mapped }];
				unknownKinds.add(file.kind);
				return [];
			});
			if (unknownKinds.size > 0) {
				logger.warn(`Git status skipped unknown status kinds: ${[...unknownKinds].join(", ")}`);
			}
			return entries;
		} catch (error) {
			logger.warn(`Git status lookup failed: ${String(error)}`);
			return null;
		}
	};
}
