/**
 * The status entry code as reported by Git.
 */
export enum GitStatusEntry {
	Modified = "M",
	Added = "A",
	Deleted = "D",
	Renamed = "R",
	Copied = "C",
	Unchanged = ".",
	Untracked = "?",
	Ignored = "!",
	UpdatedButUnmerged = "U",
}

/** The representation of a Git file change kind. */
export enum AppFileStatusKind {
	New = "New",
	Modified = "Modified",
	Deleted = "Deleted",
	Copied = "Copied",
	Renamed = "Renamed",
	Conflicted = "Conflicted",
	Untracked = "Untracked",
}

/**
 * Normal changes to a repository
 */
export type PlainFileStatus = {
	kind: AppFileStatusKind.New | AppFileStatusKind.Modified | AppFileStatusKind.Deleted;
	submoduleStatus?: SubmoduleStatus | undefined;
};

/**
 * Copied or renamed files are change staged in the index that have a source
 * as well as a destination.
 *
 * The `oldPath` of a copied file also exists in the working directory, but the
 * `oldPath` of a renamed file will be missing from the working directory.
 */
export type CopiedOrRenamedFileStatus = {
	kind: AppFileStatusKind.Copied | AppFileStatusKind.Renamed;
	oldPath: string;
	renameIncludesModifications: boolean;
	submoduleStatus?: SubmoduleStatus | undefined;
};

/**
 * Details about a file marked as conflicted in the index which may have
 * conflict markers to inspect.
 */
export type ConflictsWithMarkers = {
	kind: AppFileStatusKind.Conflicted;
	entry: TextConflictEntry;
	conflictMarkerCount: number;
	submoduleStatus?: SubmoduleStatus | undefined;
};

/**
 * Details about a file marked as conflicted in the index which needs to be
 * resolved manually by the user.
 */
export type ManualConflict = {
	kind: AppFileStatusKind.Conflicted;
	entry: ManualConflictEntry;
	submoduleStatus?: SubmoduleStatus | undefined;
};

/** Union of potential conflict scenarios the application should handle */
export type ConflictedFileStatus = ConflictsWithMarkers | ManualConflict;

/** Custom typeguard to differentiate Conflict files from other types */
export function isConflictedFileStatus(
	appFileStatus: AppFileStatus,
): appFileStatus is ConflictedFileStatus {
	return appFileStatus.kind === AppFileStatusKind.Conflicted;
}

/** Custom typeguard to differentiate ConflictsWithMarkers from other Conflict types */
export function isConflictWithMarkers(
	conflictedFileStatus: ConflictedFileStatus,
): conflictedFileStatus is ConflictsWithMarkers {
	return Object.prototype.hasOwnProperty.call(conflictedFileStatus, "conflictMarkerCount");
}

/** Custom typeguard to differentiate ManualConflict from other Conflict types */
export function isManualConflict(
	conflictedFileStatus: ConflictedFileStatus,
): conflictedFileStatus is ManualConflict {
	return !Object.prototype.hasOwnProperty.call(conflictedFileStatus, "conflictMarkerCount");
}

/** Denotes an untracked file in the working directory) */
export type UntrackedFileStatus = {
	kind: AppFileStatusKind.Untracked;
	submoduleStatus?: SubmoduleStatus | undefined;
};

/** The union of potential states associated with a file change */
export type AppFileStatus =
	| PlainFileStatus
	| CopiedOrRenamedFileStatus
	| ConflictedFileStatus
	| UntrackedFileStatus;

/** The status of a submodule */
export type SubmoduleStatus = {
	/** Whether or not the submodule is pointing to a different commit */
	readonly commitChanged: boolean;
	/**
	 * Whether or not the submodule contains modified changes that haven't been
	 * committed yet
	 */
	readonly modifiedChanges: boolean;
	/**
	 * Whether or not the submodule contains untracked changes that haven't been
	 * committed yet
	 */
	readonly untrackedChanges: boolean;
};

/** The porcelain status for an ordinary changed entry */
export type OrdinaryEntry = {
	readonly kind: "ordinary";
	/** how we should represent the file in the application */
	readonly type: "added" | "modified" | "deleted";
	/** the status of the index for this entry (if known) */
	readonly index?: GitStatusEntry;
	/** the status of the working tree for this entry (if known) */
	readonly workingTree?: GitStatusEntry;
	/** the submodule status for this entry */
	readonly submoduleStatus?: SubmoduleStatus | undefined;
};

/** The porcelain status for a renamed or copied entry */
export type RenamedOrCopiedEntry = {
	readonly kind: "renamed" | "copied";
	/** the status of the index for this entry (if known) */
	readonly index?: GitStatusEntry;
	/** the status of the working tree for this entry (if known) */
	readonly workingTree?: GitStatusEntry;
	/** the submodule status for this entry */
	readonly submoduleStatus?: SubmoduleStatus | undefined;
	/** The rename or copy score in the case of a renamed file */
	readonly renameOrCopyScore?: number | undefined;
};

export enum UnmergedEntrySummary {
	AddedByUs = "added-by-us",
	DeletedByUs = "deleted-by-us",
	AddedByThem = "added-by-them",
	DeletedByThem = "deleted-by-them",
	BothDeleted = "both-deleted",
	BothAdded = "both-added",
	BothModified = "both-modified",
}

/**
 * Valid Git index states that the application should detect text conflict
 * markers
 */
type TextConflictDetails =
	| {
			readonly action: UnmergedEntrySummary.BothAdded;
			readonly us: GitStatusEntry.Added;
			readonly them: GitStatusEntry.Added;
	  }
	| {
			readonly action: UnmergedEntrySummary.BothModified;
			readonly us: GitStatusEntry.UpdatedButUnmerged;
			readonly them: GitStatusEntry.UpdatedButUnmerged;
	  };

export type TextConflictEntry = {
	readonly kind: "conflicted";
	/** the submodule status for this entry */
	readonly submoduleStatus?: SubmoduleStatus | undefined;
} & TextConflictDetails;

/**
 * Valid Git index states where the user needs to choose one of `us` or `them`
 * in the app.
 */
export type ManualConflictDetails = {
	/** the submodule status for this entry */
	readonly submoduleStatus?: SubmoduleStatus | undefined;
} & (
	| {
			readonly action: UnmergedEntrySummary.BothAdded;
			readonly us: GitStatusEntry.Added;
			readonly them: GitStatusEntry.Added;
	  }
	| {
			readonly action: UnmergedEntrySummary.BothModified;
			readonly us: GitStatusEntry.UpdatedButUnmerged;
			readonly them: GitStatusEntry.UpdatedButUnmerged;
	  }
	| {
			readonly action: UnmergedEntrySummary.AddedByUs;
			readonly us: GitStatusEntry.Added;
			readonly them: GitStatusEntry.UpdatedButUnmerged;
	  }
	| {
			readonly action: UnmergedEntrySummary.DeletedByThem;
			readonly us: GitStatusEntry.UpdatedButUnmerged;
			readonly them: GitStatusEntry.Deleted;
	  }
	| {
			readonly action: UnmergedEntrySummary.AddedByThem;
			readonly us: GitStatusEntry.UpdatedButUnmerged;
			readonly them: GitStatusEntry.Added;
	  }
	| {
			readonly action: UnmergedEntrySummary.DeletedByUs;
			readonly us: GitStatusEntry.Deleted;
			readonly them: GitStatusEntry.UpdatedButUnmerged;
	  }
	| {
			readonly action: UnmergedEntrySummary.BothDeleted;
			readonly us: GitStatusEntry.Deleted;
			readonly them: GitStatusEntry.Deleted;
	  }
);

export type ManualConflictEntry = {
	readonly kind: "conflicted";
	/** the submodule status for this entry */
	readonly submoduleStatus?: SubmoduleStatus | undefined;
} & ManualConflictDetails;

/** The porcelain status for an unmerged entry */
export type UnmergedEntry = TextConflictEntry | ManualConflictEntry;

/** The porcelain status for an unmerged entry */
export type UntrackedEntry = {
	readonly kind: "untracked";
	/** the submodule status for this entry */
	readonly submoduleStatus?: SubmoduleStatus | undefined;
};

/** The union of possible entries from the git status */
export type FileEntry = OrdinaryEntry | RenamedOrCopiedEntry | UnmergedEntry | UntrackedEntry;

/** encapsulate the changes to a file in the working directory */
export interface WorkingDirectoryFileChange {
	/** The relative path to the file in the repository. */
	readonly path: string;
	/** The status of the change to the file. */
	readonly status: AppFileStatus;
}

/** the state of the working directory for a repository */
export interface WorkingDirectoryStatus {
	/** The list of changes in the repository's working directory. */
	readonly files: ReadonlyArray<WorkingDirectoryFileChange>;
}
