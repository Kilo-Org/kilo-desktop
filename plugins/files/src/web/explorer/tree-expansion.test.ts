import { describe, expect, it } from "vitest";

import type { FileTreeVisibleRow } from "@pierre/trees";

import { expandedDirectoryPaths } from "./tree-expansion.js";

function row(partial: Partial<FileTreeVisibleRow>): FileTreeVisibleRow {
	return {
		ancestorPaths: [],
		depth: 0,
		hasChildren: false,
		index: 0,
		isExpanded: false,
		isFlattened: false,
		isFocused: false,
		isSelected: false,
		kind: "file",
		level: 0,
		name: "",
		path: "",
		posInSet: 1,
		setSize: 1,
		...partial,
	};
}

describe("expandedDirectoryPaths", () => {
	it("captures the paths of expanded directories", () => {
		const rows = [
			row({ kind: "directory", path: "src/", isExpanded: true }),
			row({ kind: "file", path: "src/index.ts" }),
			row({ kind: "directory", path: "docs/", isExpanded: false }),
		];
		expect(expandedDirectoryPaths(rows)).toEqual(["src/"]);
	});

	it("skips collapsed directories and file rows entirely", () => {
		const rows = [
			row({ kind: "directory", path: "docs/" }),
			row({ kind: "file", path: "docs/readme.md", isExpanded: true }),
		];
		expect(expandedDirectoryPaths(rows)).toEqual([]);
	});

	it("unwraps flattened chains into the real paths of every segment", () => {
		const rows = [
			row({
				kind: "directory",
				path: "packages/core/",
				isExpanded: true,
				isFlattened: true,
				flattenedSegments: [
					{ isTerminal: false, name: "packages", path: "packages/" },
					{ isTerminal: false, name: "core", path: "packages/core/" },
					{ isTerminal: true, name: "src", path: "packages/core/src/" },
				],
			}),
		];
		expect(expandedDirectoryPaths(rows)).toEqual([
			"packages/",
			"packages/core/",
			"packages/core/src/",
		]);
	});

	it("returns an empty list when nothing is expanded", () => {
		expect(expandedDirectoryPaths([])).toEqual([]);
	});
});
