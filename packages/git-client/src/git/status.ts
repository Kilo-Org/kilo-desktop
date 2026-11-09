import type { IAheadBehind } from "../models/branch.js";
import { AppFileStatusKind, GitStatusEntry } from "../models/status.js";
import type {
	AppFileStatus,
	ConflictedFileStatus,
	FileEntry,
	UnmergedEntry,
	WorkingDirectoryFileChange,
	WorkingDirectoryStatus,
} from "../models/status.js";
import type { IGitBufferExecutionOptions, IGitBufferResult } from "./core.js";
import type { IStatusEntry, IStatusHeader } from "../lib/status-parser.js";
import {
	isStatusEntry,
	isStatusHeader,
	mapStatus,
	parsePorcelainStatus,
} from "../lib/status-parser.js";

/** Structural exec parameter — satisfied by `GitClient["exec"]` (buffer overload). */
export type StatusExec = (
	args: string[],
	name: string,
	options: IGitBufferExecutionOptions,
) => Promise<IGitBufferResult>;

export interface StatusOptions {
	/** Whether to report untracked files. Defaults to `true`. */
	readonly includeUntracked?: boolean;

	/** Working directory override for this call. Defaults to the client's `path`. */
	readonly cwd?: string;
}

/** The encapsulation of the result from 'git status' */
export interface IStatusResult {
	/** The name of the current branch */
	readonly currentBranch?: string | undefined;

	/** The name of the current upstream branch */
	readonly currentUpstreamBranch?: string | undefined;

	/** The SHA of the tip commit of the current branch */
	readonly currentTip?: string | undefined;

	/**
	 * How many commits ahead and behind
	 * the `currentBranch` is compared to the `currentUpstreamBranch`
	 */
	readonly branchAheadBehind?: IAheadBehind | undefined;

	/** true if the repository exists at the given location */
	readonly exists: boolean;

	/** the state of the repository's working directory */
	readonly workingDirectory: WorkingDirectoryStatus;

	/** whether conflicting files present on repository */
	readonly doConflictedFilesExist: boolean;
}

interface IStatusHeadersData {
	currentBranch?: string | undefined;
	currentUpstreamBranch?: string | undefined;
	currentTip?: string | undefined;
	branchAheadBehind?: IAheadBehind | undefined;
	match: RegExpMatchArray | null;
}

function convertToAppStatus(entry: FileEntry, oldPath?: string): AppFileStatus {
	if (entry.kind === "ordinary") {
		switch (entry.type) {
			case "added":
				return {
					kind: AppFileStatusKind.New,
					submoduleStatus: entry.submoduleStatus,
				};
			case "modified":
				return {
					kind: AppFileStatusKind.Modified,
					submoduleStatus: entry.submoduleStatus,
				};
			case "deleted":
				return {
					kind: AppFileStatusKind.Deleted,
					submoduleStatus: entry.submoduleStatus,
				};
		}
	} else if (entry.kind === "copied" && oldPath != null) {
		return {
			kind: AppFileStatusKind.Copied,
			oldPath,
			submoduleStatus: entry.submoduleStatus,
			renameIncludesModifications: false,
		};
	} else if (entry.kind === "renamed" && oldPath != null) {
		return {
			kind: AppFileStatusKind.Renamed,
			oldPath,
			submoduleStatus: entry.submoduleStatus,
			renameIncludesModifications:
				entry.workingTree === GitStatusEntry.Modified ||
				(entry.renameOrCopyScore !== undefined && entry.renameOrCopyScore < 100),
		};
	} else if (entry.kind === "untracked") {
		return {
			kind: AppFileStatusKind.Untracked,
			submoduleStatus: entry.submoduleStatus,
		};
	} else if (entry.kind === "conflicted") {
		return toConflictedFileStatus(entry);
	}

	throw new Error(`Unknown file status kind '${entry.kind}'`);
}

function toConflictedFileStatus(entry: UnmergedEntry): ConflictedFileStatus {
	return {
		kind: AppFileStatusKind.Conflicted,
		entry,
	};
}

// List of known conflicted index entries for a file, extracted from mapStatus
// inside `status-parser.ts` for convenience
const conflictStatusCodes = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"];

/**
 *  Retrieve the status of the bound repository,
 *  and fail gracefully if the location is not a Git repository
 */
export async function getStatus(
	exec: StatusExec,
	options?: StatusOptions,
): Promise<IStatusResult | null> {
	const includeUntracked = options?.includeUntracked ?? true;

	const args = [
		"--no-optional-locks",
		"status",
		...(includeUntracked ? ["--untracked-files=all"] : []),
		"--branch",
		"--porcelain=2",
		"-z",
	];

	const { stdout, exitCode } = await exec(args, "getStatus", {
		successExitCodes: new Set([0, 128]),
		encoding: "buffer",
	});

	if (exitCode === 128) {
		// 'git status' returned 128 and the location is likely missing its
		// .git directory (or hit another fatal error — Desktop makes the
		// same trade-off)
		return null;
	}

	const parsed = parsePorcelainStatus(stdout);
	const headers = parsed.filter(isStatusHeader);
	const entries = parsed.filter(isStatusEntry);

	const conflictedFilesInIndex = entries.filter((e) => conflictStatusCodes.includes(e.statusCode));

	// Map of files keyed on their paths.
	const files = entries.reduce(
		(files, entry) => buildStatusMap(files, entry),
		new Map<string, WorkingDirectoryFileChange>(),
	);

	const { currentBranch, currentUpstreamBranch, currentTip, branchAheadBehind } = headers.reduce(
		parseStatusHeader,
		{
			currentBranch: undefined,
			currentUpstreamBranch: undefined,
			currentTip: undefined,
			branchAheadBehind: undefined,
			match: null,
		},
	);

	const workingDirectory: WorkingDirectoryStatus = {
		files: [...files.values()],
	};

	return {
		currentBranch,
		currentTip,
		currentUpstreamBranch,
		branchAheadBehind,
		exists: true,
		workingDirectory,
		doConflictedFilesExist: conflictedFilesInIndex.length > 0,
	};
}

/**
 *
 * Update map of working directory changes with a file status entry.
 * Reducer(ish).
 *
 * (Map is used here to maintain insertion order.)
 */
function buildStatusMap(
	files: Map<string, WorkingDirectoryFileChange>,
	entry: IStatusEntry,
): Map<string, WorkingDirectoryFileChange> {
	const status = mapStatus(entry.statusCode, entry.submoduleStatusCode, entry.renameOrCopyScore);

	if (status.kind === "ordinary") {
		// when a file is added in the index but then removed in the working
		// directory, the file won't be part of the commit, so we can skip
		// displaying this entry in the changes list
		if (status.index === GitStatusEntry.Added && status.workingTree === GitStatusEntry.Deleted) {
			return files;
		}
	}

	if (status.kind === "untracked") {
		// when a delete has been staged, but an untracked file exists with the
		// same path, we should ensure that we only draw one entry in the
		// changes list - see if an entry already exists for this path and
		// remove it if found
		files.delete(entry.path);
	}

	// for now we just poke at the existing summary
	const appStatus = convertToAppStatus(status, entry.oldPath);

	files.set(entry.path, {
		path: entry.path,
		status: appStatus,
	});
	return files;
}

/**
 * Update status header based on the current header entry.
 * Reducer.
 */
function parseStatusHeader(results: IStatusHeadersData, header: IStatusHeader) {
	let { currentBranch, currentUpstreamBranch, currentTip, branchAheadBehind, match } = results;
	const value = header.value;

	// This intentionally does not match branch.oid initial
	if ((match = value.match(/^branch\.oid ([a-f0-9]+)$/))) {
		currentTip = match[1];
	} else if ((match = value.match(/^branch.head (.*)/))) {
		if (match[1] !== "(detached)") {
			currentBranch = match[1];
		}
	} else if ((match = value.match(/^branch.upstream (.*)/))) {
		currentUpstreamBranch = match[1];
	} else if ((match = value.match(/^branch.ab \+(\d+) -(\d+)$/))) {
		const ahead = Number.parseInt(match[1] ?? "", 10);
		const behind = Number.parseInt(match[2] ?? "", 10);

		if (!Number.isNaN(ahead) && !Number.isNaN(behind)) {
			branchAheadBehind = { ahead, behind };
		}
	}
	return {
		currentBranch,
		currentUpstreamBranch,
		currentTip,
		branchAheadBehind,
		match,
	};
}
