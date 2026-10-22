import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { htmlPageFileStem } from "../../contracts/html-render/schemas.js";
import { createSaveHtmlPageHandler } from "./save-html-page.js";

let root: string;
let workspace: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "kilo-save-html-"));
	workspace = path.join(root, "project");
	await mkdir(workspace);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const save = createSaveHtmlPageHandler(() => [workspace]);

describe("chat.saveHtmlPage", () => {
	it("writes the page at the workspace root and never overwrites an existing file", async () => {
		await expect(
			save({ workspaceDirectory: workspace, title: "Sales chart", html: "<p>one</p>" }),
		).resolves.toEqual({ relativePath: "Sales chart.html" });
		await expect(
			save({ workspaceDirectory: workspace, title: "Sales chart", html: "<p>two</p>" }),
		).resolves.toEqual({ relativePath: "Sales chart 2.html" });

		expect(await readFile(path.join(workspace, "Sales chart.html"), "utf8")).toBe("<p>one</p>");
		expect(await readFile(path.join(workspace, "Sales chart 2.html"), "utf8")).toBe("<p>two</p>");
	});

	it("keeps path separators in the title from leaving the workspace", async () => {
		const { relativePath } = await save({
			workspaceDirectory: workspace,
			title: "../../escape/../me",
			html: "<p>x</p>",
		});

		expect(relativePath).not.toMatch(/[\\/]/);
		expect(await readdir(workspace)).toEqual([relativePath]);
		expect(await readdir(root)).toEqual(["project"]);
	});

	it("does not write through a symlink planted at the target name", async () => {
		const outside = path.join(root, "outside.html");
		await writeFile(outside, "original");
		await symlink(outside, path.join(workspace, "Chart.html"));

		await expect(
			save({ workspaceDirectory: workspace, title: "Chart", html: "<p>x</p>" }),
		).resolves.toEqual({ relativePath: "Chart 2.html" });
		expect(await readFile(outside, "utf8")).toBe("original");
	});

	it("accepts a managed chat worktree of a registered folder", async () => {
		const worktree = path.join(workspace, ".kilo", "worktrees", "feature");
		await mkdir(worktree, { recursive: true });

		await expect(
			save({ workspaceDirectory: worktree, title: "Chart", html: "<p>x</p>" }),
		).resolves.toEqual({ relativePath: "Chart.html" });
	});

	it("rejects folders that are not registered workspaces", async () => {
		const other = path.join(root, "other");
		await mkdir(other);

		await expect(
			save({ workspaceDirectory: other, title: "Chart", html: "<p>x</p>" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(
			save({ workspaceDirectory: path.join(root, "missing"), title: "Chart", html: "<p>x</p>" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			save({
				workspaceDirectory: path.join(workspace, ".kilo", "worktrees"),
				title: "Chart",
				html: "<p>x</p>",
			}),
		).rejects.toBeDefined();
	});
});

describe("htmlPageFileStem", () => {
	it("makes a safe, visible file name stem", () => {
		expect(htmlPageFileStem('Q3: "Revenue" / Costs')).toBe("Q3 Revenue Costs");
		expect(htmlPageFileStem("..hidden")).toBe("hidden");
		expect(htmlPageFileStem("...")).toBe("Page");
		expect(htmlPageFileStem("trailing dots...")).toBe("trailing dots");
		expect(htmlPageFileStem("CON")).toBe("CON page");
		expect(htmlPageFileStem("nul.report")).toBe("nul page.report");
		expect(htmlPageFileStem("Console")).toBe("Console");
	});
});
