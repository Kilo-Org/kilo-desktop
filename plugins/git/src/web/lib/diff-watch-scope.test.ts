import { describe, expect, it } from "vitest";

import type { GitRepositoryType } from "../../contracts/schemas.js";
import { resolveDiffWatchScope } from "./diff-watch-scope.js";

const regular = (topLevelWorkingDirectory: string, gitDir: string): GitRepositoryType => ({
	kind: "regular",
	topLevelWorkingDirectory,
	gitDir,
});

const WORKING_TREE_NOISE = ["**/.git/**", "**/.watchman-cookie-*"];

describe("resolveDiffWatchScope", () => {
	it("watches the repo root and its .git dir for a root view", () => {
		expect(resolveDiffWatchScope("/repo", regular("/repo", "/repo/.git"))).toEqual({
			workingTreeDirs: ["/repo"],
			workingTreeExcludes: [...WORKING_TREE_NOISE, "/repo/.kilo/worktrees/**"],
			gitDirIncludes: ["/repo/.git/*"],
		});
	});

	it("widens a subfolder view to the repo root, never globbing the realpath git dir", () => {
		expect(resolveDiffWatchScope("/repo/pkg/a", regular("/repo", "/private/repo/.git"))).toEqual({
			workingTreeDirs: ["/repo"],
			workingTreeExcludes: [...WORKING_TREE_NOISE, "/repo/.kilo/worktrees/**"],
			gitDirIncludes: ["/repo/.git/*"],
		});
	});

	it("matches a linked worktree's real admin dir name, not the folder basename", () => {
		const scope = resolveDiffWatchScope(
			"/main/.kilo/worktrees/slug",
			regular("/main/.kilo/worktrees/slug", "/main/.git/worktrees/slug1"),
		);
		expect(scope).toEqual({
			workingTreeDirs: ["/main/.kilo/worktrees/slug"],
			workingTreeExcludes: [...WORKING_TREE_NOISE, "/main/.kilo/worktrees/slug/.kilo/worktrees/**"],
			gitDirIncludes: ["**/.git/worktrees/slug1/*"],
		});
	});

	it("globs a separate git dir by its absolute path", () => {
		expect(
			resolveDiffWatchScope("/repo", regular("/repo", "/elsewhere/repo.git")).gitDirIncludes,
		).toEqual(["/elsewhere/repo.git/*"]);
	});

	it.each<[string, GitRepositoryType | undefined]>([
		["unresolved", undefined],
		["missing", { kind: "missing" }],
		["bare", { kind: "bare" }],
		["unsafe", { kind: "unsafe", path: "/workspace/project" }],
	])("falls back to the directory-anchored scope when %s", (_label, repositoryType) => {
		expect(resolveDiffWatchScope("/workspace/project", repositoryType)).toEqual({
			workingTreeDirs: ["/workspace/project"],
			workingTreeExcludes: [...WORKING_TREE_NOISE, "/workspace/project/.kilo/worktrees/**"],
			gitDirIncludes: ["/workspace/project/.git/*", "**/.git/worktrees/project/*"],
		});
	});

	it("posix-normalizes Windows paths", () => {
		expect(resolveDiffWatchScope("C:\\repo\\pkg", regular("C:\\repo", "C:\\repo\\.git"))).toEqual({
			workingTreeDirs: ["C:\\repo"],
			workingTreeExcludes: [...WORKING_TREE_NOISE, "C:/repo/.kilo/worktrees/**"],
			gitDirIncludes: ["C:/repo/.git/*"],
		});
		expect(
			resolveDiffWatchScope(
				"C:\\main\\wt",
				regular("C:\\main\\wt", "C:\\main\\.git\\worktrees\\wt2"),
			).gitDirIncludes,
		).toEqual(["**/.git/worktrees/wt2/*"]);
	});

	it("escapes glob metacharacters in paths", () => {
		const scope = resolveDiffWatchScope("/r[1]/pkg", regular("/r[1]", "/r[1]/.git"));
		expect(scope.workingTreeExcludes).toContain("/r\\[1\\]/.kilo/worktrees/**");
		expect(scope.gitDirIncludes).toEqual(["/r\\[1\\]/.git/*"]);
		expect(
			resolveDiffWatchScope("/w/a{b}", regular("/w/a{b}", "/m/.git/worktrees/a{b}")).gitDirIncludes,
		).toEqual(["**/.git/worktrees/a\\{b\\}/*"]);
		expect(resolveDiffWatchScope("/w/(x)", undefined).gitDirIncludes).toEqual([
			"/w/\\(x\\)/.git/*",
			"**/.git/worktrees/\\(x\\)/*",
		]);
	});
});
