import type { FileEntry, SubmoduleStatus } from "../models/status.js";
import { GitStatusEntry, UnmergedEntrySummary } from "../models/status.js";
import { splitBuffer } from "./split-buffer.js";

type StatusItem = IStatusHeader | IStatusEntry;

export interface IStatusHeader {
	readonly kind: "header";
	readonly value: string;
}

/** A representation of a parsed status entry from git status */
export interface IStatusEntry {
	readonly kind: "entry";

	/** The path to the file relative to the repository root */
	readonly path: string;

	/** The two character long status code */
	readonly statusCode: string;

	/** The four character long submodule status code */
	readonly submoduleStatusCode: string;

	/** The original path in the case of a renamed file */
	readonly oldPath?: string;

	/** The rename or copy score in the case of a renamed file */
	readonly renameOrCopyScore?: number;
}

export function isStatusHeader(statusItem: StatusItem): statusItem is IStatusHeader {
	return statusItem.kind === "header";
}

export function isStatusEntry(statusItem: StatusItem): statusItem is IStatusEntry {
	return statusItem.kind === "entry";
}

const ChangedEntryType = "1";
const RenamedOrCopiedEntryType = "2";
const UnmergedEntryType = "u";
const UntrackedEntryType = "?";
const IgnoredEntryType = "!";

/** Parses output from git status --porcelain -z into file status entries */
export function parsePorcelainStatus(output: Buffer): ReadonlyArray<StatusItem> {
	const entries = new Array<StatusItem>();

	// See https://git-scm.com/docs/git-status
	//
	// In the short-format, the status of each path is shown as
	// XY PATH1 -> PATH2
	//
	// There is also an alternate -z format recommended for machine parsing. In that
	// format, the status field is the same, but some other things change. First,
	// the -> is omitted from rename entries and the field order is reversed (e.g
	// from -> to becomes to from). Second, a NUL (ASCII 0) follows each filename,
	// replacing space as a field separator and the terminating newline (but a space
	// still separates the status field from the first filename). Third, filenames
	// containing special characters are not specially formatted; no quoting or
	// backslash-escaping is performed.

	const tokens = splitBuffer(output, "\0");

	for (let i = 0; i < tokens.length; i++) {
		const field = tokens[i]?.toString() ?? "";
		if (field.startsWith("# ") && field.length > 2) {
			entries.push({ kind: "header", value: field.substring(2) });
			continue;
		}

		const entryKind = field.substring(0, 1);

		if (entryKind === ChangedEntryType) {
			entries.push(parseChangedEntry(field));
		} else if (entryKind === RenamedOrCopiedEntryType) {
			const next = tokens[++i];
			entries.push(parsedRenamedOrCopiedEntry(field, next?.toString()));
		} else if (entryKind === UnmergedEntryType) {
			entries.push(parseUnmergedEntry(field));
		} else if (entryKind === UntrackedEntryType) {
			entries.push(parseUntrackedEntry(field));
		} else if (entryKind === IgnoredEntryType) {
			// Ignored, we don't care about these for now
		}
	}

	return entries;
}

// 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
const changedEntryRe =
	/^1 ([MADRCUTX?!.]{2}) (N\.\.\.|S[C.][M.][U.]) (\d+) (\d+) (\d+) ([a-f0-9]+) ([a-f0-9]+) ([\s\S]*?)$/;

function parseChangedEntry(field: string): IStatusEntry {
	const match = changedEntryRe.exec(field);

	if (!match || !match[1] || !match[2] || !match[8]) {
		throw new Error(`Failed to parse status line for changed entry: ${field}`);
	}

	return {
		kind: "entry",
		statusCode: match[1],
		submoduleStatusCode: match[2],
		path: match[8],
	};
}

// 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path><sep><origPath>
const renamedOrCopiedEntryRe =
	/^2 ([MADRCUTX?!.]{2}) (N\.\.\.|S[C.][M.][U.]) (\d+) (\d+) (\d+) ([a-f0-9]+) ([a-f0-9]+) ([RC]\d+) ([\s\S]*?)$/;

function parsedRenamedOrCopiedEntry(field: string, oldPath: string | undefined): IStatusEntry {
	const match = renamedOrCopiedEntryRe.exec(field);

	if (!match || !match[1] || !match[2] || !match[8] || !match[9]) {
		throw new Error(`Failed to parse status line for renamed or copied entry: ${field}`);
	}

	if (!oldPath) {
		throw new Error("Failed to parse renamed or copied entry, could not parse old path");
	}

	return {
		kind: "entry",
		statusCode: match[1],
		submoduleStatusCode: match[2],
		oldPath,
		renameOrCopyScore: Number.parseInt(match[8].substring(1), 10),
		path: match[9],
	};
}

// u <xy> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
const unmergedEntryRe =
	/^u ([DAU]{2}) (N\.\.\.|S[C.][M.][U.]) (\d+) (\d+) (\d+) (\d+) ([a-f0-9]+) ([a-f0-9]+) ([a-f0-9]+) ([\s\S]*?)$/;

function parseUnmergedEntry(field: string): IStatusEntry {
	const match = unmergedEntryRe.exec(field);

	if (!match || !match[1] || !match[2] || !match[10]) {
		throw new Error(`Failed to parse status line for unmerged entry: ${field}`);
	}

	return {
		kind: "entry",
		statusCode: match[1],
		submoduleStatusCode: match[2],
		path: match[10],
	};
}

function parseUntrackedEntry(field: string): IStatusEntry {
	const path = field.substring(2);
	return {
		kind: "entry",
		// NOTE: We return ?? instead of ? here to play nice with mapStatus,
		// might want to consider changing this (and mapStatus) in the future.
		statusCode: "??",
		submoduleStatusCode: "????",
		path,
	};
}

function mapSubmoduleStatus(submoduleStatusCode: string): SubmoduleStatus | undefined {
	if (!submoduleStatusCode.startsWith("S")) {
		return undefined;
	}

	return {
		commitChanged: submoduleStatusCode[1] === "C",
		modifiedChanges: submoduleStatusCode[2] === "M",
		untrackedChanges: submoduleStatusCode[3] === "U",
	};
}

type StatusFactory = (
	submoduleStatus: SubmoduleStatus | undefined,
	renameOrCopyScore: number | undefined,
) => FileEntry;

const S = GitStatusEntry;
const U = UnmergedEntrySummary;

const statusTable: Record<string, StatusFactory> = {
	"??": (sub) => ({ kind: "untracked", submoduleStatus: sub }),

	// Ordinary changes
	".M": (sub) => ({
		kind: "ordinary",
		type: "modified",
		index: S.Unchanged,
		workingTree: S.Modified,
		submoduleStatus: sub,
	}),
	"M.": (sub) => ({
		kind: "ordinary",
		type: "modified",
		index: S.Modified,
		workingTree: S.Unchanged,
		submoduleStatus: sub,
	}),
	".A": (sub) => ({
		kind: "ordinary",
		type: "added",
		index: S.Unchanged,
		workingTree: S.Added,
		submoduleStatus: sub,
	}),
	"A.": (sub) => ({
		kind: "ordinary",
		type: "added",
		index: S.Added,
		workingTree: S.Unchanged,
		submoduleStatus: sub,
	}),
	".D": (sub) => ({
		kind: "ordinary",
		type: "deleted",
		index: S.Unchanged,
		workingTree: S.Deleted,
		submoduleStatus: sub,
	}),
	"D.": (sub) => ({
		kind: "ordinary",
		type: "deleted",
		index: S.Deleted,
		workingTree: S.Unchanged,
		submoduleStatus: sub,
	}),
	AD: (sub) => ({
		kind: "ordinary",
		type: "added",
		index: S.Added,
		workingTree: S.Deleted,
		submoduleStatus: sub,
	}),
	AM: (sub) => ({
		kind: "ordinary",
		type: "added",
		index: S.Added,
		workingTree: S.Modified,
		submoduleStatus: sub,
	}),

	// Renames
	"R.": (sub, score) => ({
		kind: "renamed",
		index: S.Renamed,
		workingTree: S.Unchanged,
		renameOrCopyScore: score,
		submoduleStatus: sub,
	}),
	".R": (sub, score) => ({
		kind: "renamed",
		index: S.Unchanged,
		workingTree: S.Renamed,
		renameOrCopyScore: score,
		submoduleStatus: sub,
	}),
	RM: (sub, score) => ({
		kind: "renamed",
		index: S.Renamed,
		workingTree: S.Modified,
		renameOrCopyScore: score,
		submoduleStatus: sub,
	}),
	RD: (sub, score) => ({
		kind: "renamed",
		index: S.Renamed,
		workingTree: S.Deleted,
		renameOrCopyScore: score,
		submoduleStatus: sub,
	}),

	// Copies
	"C.": (sub) => ({
		kind: "copied",
		index: S.Copied,
		workingTree: S.Unchanged,
		submoduleStatus: sub,
	}),
	".C": (sub) => ({
		kind: "copied",
		index: S.Unchanged,
		workingTree: S.Copied,
		submoduleStatus: sub,
	}),

	// Conflicts
	DD: (sub) => ({
		kind: "conflicted",
		action: U.BothDeleted,
		us: S.Deleted,
		them: S.Deleted,
		submoduleStatus: sub,
	}),
	AU: (sub) => ({
		kind: "conflicted",
		action: U.AddedByUs,
		us: S.Added,
		them: S.UpdatedButUnmerged,
		submoduleStatus: sub,
	}),
	UD: (sub) => ({
		kind: "conflicted",
		action: U.DeletedByThem,
		us: S.UpdatedButUnmerged,
		them: S.Deleted,
		submoduleStatus: sub,
	}),
	UA: (sub) => ({
		kind: "conflicted",
		action: U.AddedByThem,
		us: S.UpdatedButUnmerged,
		them: S.Added,
		submoduleStatus: sub,
	}),
	DU: (sub) => ({
		kind: "conflicted",
		action: U.DeletedByUs,
		us: S.Deleted,
		them: S.UpdatedButUnmerged,
		submoduleStatus: sub,
	}),
	AA: (sub) => ({
		kind: "conflicted",
		action: U.BothAdded,
		us: S.Added,
		them: S.Added,
		submoduleStatus: sub,
	}),
	UU: (sub) => ({
		kind: "conflicted",
		action: U.BothModified,
		us: S.UpdatedButUnmerged,
		them: S.UpdatedButUnmerged,
		submoduleStatus: sub,
	}),
};

/**
 * Map the raw status text from Git to a structure we can work with in the app.
 */
export function mapStatus(
	statusCode: string,
	submoduleStatusCode: string,
	renameOrCopyScore: number | undefined,
): FileEntry {
	const submoduleStatus = mapSubmoduleStatus(submoduleStatusCode);
	const factory = statusTable[statusCode];

	if (factory !== undefined) {
		return factory(submoduleStatus, renameOrCopyScore);
	}

	// Fallback: assume the file is modified in some way
	return { kind: "ordinary", type: "modified", submoduleStatus };
}
