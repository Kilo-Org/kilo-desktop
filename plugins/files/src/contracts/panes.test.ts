import { describe, expect, it } from "vitest";

import { absoluteFilePath, basename, FILE_OBJECT_TYPE, filePaneTarget } from "./panes";

const FOLDERS = [
	{ path: "/work/app", isPrimary: true },
	{ path: "/work/docs", isPrimary: false },
];

describe("a Files pane's file", () => {
	it("is the opened object's path, inside the deepest folder holding it", () => {
		expect(
			filePaneTarget({ objectType: FILE_OBJECT_TYPE, objectId: "/work/docs/a/b.md" }, FOLDERS),
		).toEqual({ workspaceDirectory: "/work/docs", relativePath: "a/b.md" });
	});

	it("is origin's folder and relative path when the folder is the session's", () => {
		expect(
			filePaneTarget({ workspaceDirectory: "/work/app", relativePath: "src/a.ts" }, FOLDERS),
		).toEqual({ workspaceDirectory: "/work/app", relativePath: "src/a.ts" });
		expect(
			filePaneTarget({ workspaceDirectory: "/elsewhere", relativePath: "src/a.ts" }, FOLDERS),
		).toBeNull();
	});

	it("is none for an explorer, a folder, another object type or a path outside the folders", () => {
		expect(filePaneTarget({ workspaceDirectory: "/work/app" }, FOLDERS)).toBeNull();
		expect(
			filePaneTarget({ objectType: FILE_OBJECT_TYPE, objectId: "/work/app" }, FOLDERS),
		).toBeNull();
		expect(
			filePaneTarget({ objectType: "kilo.browser/page", objectId: "/work/app/a" }, FOLDERS),
		).toBeNull();
		expect(
			filePaneTarget({ objectType: FILE_OBJECT_TYPE, objectId: "/etc/hosts" }, FOLDERS),
		).toBeNull();
	});
});

describe("file paths", () => {
	it("join a folder and a relative path with the folder's separator", () => {
		expect(absoluteFilePath("/work/app/", "/src/a.ts")).toBe("/work/app/src/a.ts");
		expect(absoluteFilePath("C:\\src\\app", "lib/main.py")).toBe("C:\\src\\app\\lib\\main.py");
	});

	it("name the last segment", () => {
		expect(basename("/work/app/src/a.ts")).toBe("a.ts");
		expect(basename("C:\\src\\app\\")).toBe("app");
		expect(basename("")).toBe("");
	});
});
