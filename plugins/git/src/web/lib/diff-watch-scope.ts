import { escapeGlob, toPosixPath } from "@kilo-desktop/feature-sdk";

import { KILO_WORKTREE_SEGMENTS, type GitRepositoryType } from "../../contracts/schemas.js";
import { folderName } from "./folder-name.js";

export interface DiffWatchScope {
	/** Native directories for `useWorkspaceWatcher`'s `dirs` (it escapes them). */
	readonly workingTreeDirs: string[];
	/** Final globs suppressed on the working-tree subscription. */
	readonly workingTreeExcludes: string[];
	/** Final globs for the git-dir subscription. */
	readonly gitDirIncludes: string[];
}

const LINKED_WORKTREE_GIT_DIR = /\/\.git\/worktrees\/([^/]+)$/u;
const TRAILING_SLASHES = /\/+$/u;

function toGlobPrefix(path: string): string {
	return escapeGlob(toPosixPath(path).replace(TRAILING_SLASHES, ""));
}

function workingTreeExcludes(root: string): string[] {
	return [
		"**/.git/**",
		"**/.watchman-cookie-*",
		`${toGlobPrefix(root)}/${KILO_WORKTREE_SEGMENTS.join("/")}/**`,
	];
}

/**
 * `gitDir` may be realpath'd (`/var` → `/private/var`) while watcher events
 * carry workspace-path form, so a glob is built from it only when no
 * syntactic form exists: a `.git` dir is re-anchored to the syntactic
 * top-level directory, and a linked worktree's admin dir is matched by name.
 */
function gitDirInclude(topLevelWorkingDirectory: string, gitDir: string): string {
	const posixGitDir = toPosixPath(gitDir).replace(TRAILING_SLASHES, "");
	if (folderName(posixGitDir) === ".git") return `${toGlobPrefix(topLevelWorkingDirectory)}/.git/*`;
	const worktreeName = LINKED_WORKTREE_GIT_DIR.exec(posixGitDir)?.[1];
	if (worktreeName !== undefined) return `**/.git/worktrees/${escapeGlob(worktreeName)}/*`;
	return `${escapeGlob(posixGitDir)}/*`;
}

/**
 * The live-reload watch scope for a Changes view of `directory`. A resolved
 * `regular` repository widens it to the whole repo (the patch is
 * tree-wide); otherwise it falls back to assuming `directory` is the repo
 * root, guessing a linked worktree's admin dir from the folder name, which
 * also covers a `git init` run after the view opened.
 */
export function resolveDiffWatchScope(
	directory: string,
	repositoryType: GitRepositoryType | undefined,
): DiffWatchScope {
	if (repositoryType?.kind !== "regular") {
		return {
			workingTreeDirs: [directory],
			workingTreeExcludes: workingTreeExcludes(directory),
			gitDirIncludes: [
				`${toGlobPrefix(directory)}/.git/*`,
				`**/.git/worktrees/${escapeGlob(folderName(directory))}/*`,
			],
		};
	}
	const { topLevelWorkingDirectory, gitDir } = repositoryType;
	return {
		workingTreeDirs: [topLevelWorkingDirectory],
		workingTreeExcludes: workingTreeExcludes(topLevelWorkingDirectory),
		gitDirIncludes: [gitDirInclude(topLevelWorkingDirectory, gitDir)],
	};
}
