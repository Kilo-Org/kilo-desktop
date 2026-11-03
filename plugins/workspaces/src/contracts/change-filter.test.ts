import { afterEach, describe, expect, it } from "vitest";

import { createWorkspaceChangeFilter, escapeGlob, toPosixPath } from "./change-filter";
import type { FileChangeEvent } from "./index";

const BATCH = {
	root: "/work/project",
	changes: [
		{ path: "/work/project/src/a.py", type: "create" },
		{ path: "/work/project/src/a.py", type: "update" },
		{ path: "/work/project/src/a.ts", type: "delete" },
		{ path: "/work/project/test/a.py", type: "create" },
	],
} satisfies FileChangeEvent;

describe("createWorkspaceChangeFilter", () => {
	it("passes every change through when no filters are set", () => {
		const filter = createWorkspaceChangeFilter({});
		expect(filter(BATCH.changes)).toHaveLength(4);
	});

	it("keeps only changes matching an include glob", () => {
		const filter = createWorkspaceChangeFilter({ includes: ["**/*.py"] });
		expect(filter(BATCH.changes).map(({ path }) => path)).toEqual([
			"/work/project/src/a.py",
			"/work/project/src/a.py",
			"/work/project/test/a.py",
		]);
	});

	it("drops changes matching an exclude glob", () => {
		const filter = createWorkspaceChangeFilter({ excludes: ["**/test/**"] });
		expect(filter(BATCH.changes).map(({ path }) => path)).toEqual([
			"/work/project/src/a.py",
			"/work/project/src/a.py",
			"/work/project/src/a.ts",
		]);
	});

	it("keeps only the requested event types", () => {
		const filter = createWorkspaceChangeFilter({ types: ["delete"] });
		expect(filter(BATCH.changes)).toEqual([{ path: "/work/project/src/a.ts", type: "delete" }]);
	});

	it("combines filters", () => {
		const filter = createWorkspaceChangeFilter({
			includes: ["**/*.py"],
			excludes: ["**/test/**"],
			types: ["create"],
		});
		expect(filter(BATCH.changes)).toEqual([{ path: "/work/project/src/a.py", type: "create" }]);
	});

	describe("case sensitivity (nocase off-Linux)", () => {
		// feature-sdk has no @types/node — stub via the same globalThis cast the
		// implementation uses; bare `process` is not in scope here.
		const nodeGlobal = globalThis as { process?: { platform?: string } };
		const originalPlatform = nodeGlobal.process?.platform;

		afterEach(() => {
			if (nodeGlobal.process) {
				Object.defineProperty(nodeGlobal.process, "platform", { value: originalPlatform });
			}
		});

		it("matches case-insensitively on darwin (include glob)", () => {
			Object.defineProperty(nodeGlobal.process, "platform", { value: "darwin" });
			const filter = createWorkspaceChangeFilter({ includes: ["**/*.PY"] });
			expect(filter(BATCH.changes).map(({ path }) => path)).toEqual([
				"/work/project/src/a.py",
				"/work/project/src/a.py",
				"/work/project/test/a.py",
			]);
		});

		it("matches case-insensitively on win32 (include glob)", () => {
			Object.defineProperty(nodeGlobal.process, "platform", { value: "win32" });
			const filter = createWorkspaceChangeFilter({ includes: ["**/*.PY"] });
			expect(filter(BATCH.changes).map(({ path }) => path)).toEqual([
				"/work/project/src/a.py",
				"/work/project/src/a.py",
				"/work/project/test/a.py",
			]);
		});

		it("matches case-sensitively on linux (include glob)", () => {
			Object.defineProperty(nodeGlobal.process, "platform", { value: "linux" });
			const filter = createWorkspaceChangeFilter({ includes: ["**/*.PY"] });
			// *.PY should not match a.py on Linux (case-sensitive)
			expect(filter(BATCH.changes)).toHaveLength(0);
		});
	});

	describe("Windows backslash paths (vscode-style separator-insensitive matching)", () => {
		const WINDOWS_CHANGES = [
			{ path: "C:\\work\\project\\src\\a.py", type: "create" },
			{ path: "C:\\work\\project\\src\\a.ts", type: "update" },
			{ path: "C:\\work\\project2\\b.py", type: "create" },
		] as const;

		it("matches a forward-slash file glob against a backslash path, preserving the native path", () => {
			const filter = createWorkspaceChangeFilter({
				includes: ["C:/work/project/src/a.py"],
			});
			expect(filter(WINDOWS_CHANGES)).toEqual([
				{ path: "C:\\work\\project\\src\\a.py", type: "create" },
			]);
		});

		it("matches a forward-slash subtree glob without crossing into sibling prefixes", () => {
			const filter = createWorkspaceChangeFilter({ includes: ["C:/work/project/**"] });
			expect(filter(WINDOWS_CHANGES).map(({ path }) => path)).toEqual([
				"C:\\work\\project\\src\\a.py",
				"C:\\work\\project\\src\\a.ts",
			]);
		});

		it("does not let a single segment glob cross backslash separators", () => {
			const filter = createWorkspaceChangeFilter({
				includes: ["C:/work/project/*.py"],
			});
			expect(filter(WINDOWS_CHANGES)).toHaveLength(0);
		});

		it("matches suffix globs against backslash paths", () => {
			const filter = createWorkspaceChangeFilter({ includes: ["**/*.py"] });
			expect(filter(WINDOWS_CHANGES).map(({ path }) => path)).toEqual([
				"C:\\work\\project\\src\\a.py",
				"C:\\work\\project2\\b.py",
			]);
		});

		it("suppresses backslash paths matching a forward-slash exclude glob", () => {
			const filter = createWorkspaceChangeFilter({ excludes: ["C:/work/project/**"] });
			expect(filter(WINDOWS_CHANGES)).toEqual([
				{ path: "C:\\work\\project2\\b.py", type: "create" },
			]);
		});

		it("matches globs built by escaping a toPosixPath-normalized native path with special chars", () => {
			// Subscriber pattern: escapeGlob(toPosixPath("C:\\work\\proj[1]")) + "/**"
			const filter = createWorkspaceChangeFilter({ includes: ["C:/work/proj\\[1\\]/**"] });
			expect(filter([{ path: "C:\\work\\proj[1]\\src\\a.ts", type: "update" }])).toHaveLength(1);
			expect(filter([{ path: "C:\\work\\proj1\\src\\a.ts", type: "update" }])).toHaveLength(0);
		});

		it("escapeGlob round-trip: include glob built from a native path with all magic chars matches only that exact path", () => {
			// Native path has brackets, negation, wildcard, and question mark.
			// The TS string literal doubles backslashes for the escape sequences.
			const nativePath = "C:\\work\\proj[1]\\!(x)\\a*b?.ts";
			const glob = escapeGlob(toPosixPath(nativePath));
			const filter = createWorkspaceChangeFilter({ includes: [glob] });
			expect(filter([{ path: nativePath, type: "update" }])).toHaveLength(1);
			// Sibling path that shares the numeric suffix but no brackets — must not match.
			expect(filter([{ path: "C:\\work\\proj1\\!(x)\\a*b?.ts", type: "update" }])).toHaveLength(0);
		});
	});
});

describe("escapeGlob", () => {
	it.each([
		["*", "\\*"],
		["?", "\\?"],
		["[", "\\["],
		["]", "\\]"],
		["{", "\\{"],
		["}", "\\}"],
		["(", "\\("],
		[")", "\\)"],
		["!", "\\!"],
		["\\", "\\\\"],
	])("escapes glob metachar %s", (input, expected) => {
		expect(escapeGlob(input)).toBe(expected);
	});

	it.each(["/", ".", "-", "_", "a", "Z", "0"])("leaves ordinary char %s untouched", (ch) => {
		expect(escapeGlob(ch)).toBe(ch);
	});
});

describe("toPosixPath", () => {
	it("converts backslash separators to forward slashes", () => {
		expect(toPosixPath("C:\\work\\project\\src\\a.ts")).toBe("C:/work/project/src/a.ts");
	});

	it("is an identity for forward-slash paths", () => {
		expect(toPosixPath("/work/project/src/a.ts")).toBe("/work/project/src/a.ts");
	});
});
