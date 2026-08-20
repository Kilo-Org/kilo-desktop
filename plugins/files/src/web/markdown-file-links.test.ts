import { describe, expect, it } from "vitest";

import { resolveMarkdownFileLink } from "./markdown-file-links.js";
import { remarkWorkspaceFileLinks, type MarkdownAstNode } from "./remark-workspace-file-links.js";

describe("resolveMarkdownFileLink", () => {
	it("resolves a workspace-relative Markdown link with a source position", () => {
		expect(
			resolveMarkdownFileLink("src/components/App.tsx#L42C7", [
				{ path: "/workspace/project", isPrimary: true },
			]),
		).toEqual({
			workspaceDirectory: "/workspace/project",
			relativePath: "src/components/App.tsx",
			line: 42,
			column: 7,
		});
	});

	it("maps an absolute file URL to the workspace that owns it", () => {
		expect(
			resolveMarkdownFileLink("file:///workspace/docs/My%20Guide.md#L8", [
				{ path: "/workspace/project", isPrimary: true },
				{ path: "/workspace/docs", isPrimary: false },
			]),
		).toEqual({
			workspaceDirectory: "/workspace/docs",
			relativePath: "My Guide.md",
			line: 8,
		});
	});

	it("does not claim web links or paths outside the workspace", () => {
		const folders = [{ path: "/workspace/project", isPrimary: true }] as const;

		expect(resolveMarkdownFileLink("https://example.com/docs", folders)).toBeNull();
		expect(resolveMarkdownFileLink("../../secrets.txt", folders)).toBeNull();
		expect(resolveMarkdownFileLink("settings", folders)).toBeNull();
	});

	it("normalizes Windows file URLs before matching a workspace", () => {
		expect(
			resolveMarkdownFileLink("file:///C:/project/src/App.tsx#L9", [
				{ path: "C:\\project", isPrimary: true },
			]),
		).toEqual({
			workspaceDirectory: "C:/project",
			relativePath: "src/App.tsx",
			line: 9,
		});
	});

	it("parses Codex-style path line and column suffixes", () => {
		expect(
			resolveMarkdownFileLink("/workspace/project/src/App.tsx:42:7", [
				{ path: "/workspace/project", isPrimary: true },
			]),
		).toEqual({
			workspaceDirectory: "/workspace/project",
			relativePath: "src/App.tsx",
			line: 42,
			column: 7,
		});
	});
});

describe("remarkWorkspaceFileLinks", () => {
	it("linkifies plain workspace paths and disambiguates duplicate basenames", () => {
		const tree: MarkdownAstNode = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [
						{
							type: "text",
							value: "Open apps/desktop/README.md and packages/sdk-react/README.md.",
						},
					],
				},
			],
		};

		remarkWorkspaceFileLinks({
			workspaceFolders: [{ path: "/workspace/project", isPrimary: true }],
		})(tree);

		const links = tree.children?.[0]?.children?.filter((node) => node.type === "link") ?? [];
		expect(links.map((link) => link.url)).toEqual([
			"apps/desktop/README.md",
			"packages/sdk-react/README.md",
		]);
		expect(links.map((link) => link.data?.hProperties?.["data-file-parent-suffix"])).toEqual([
			"apps/desktop",
			"packages/sdk-react",
		]);
	});

	it("rewrites file URLs before React Markdown sanitizes them", () => {
		const tree: MarkdownAstNode = {
			type: "root",
			children: [
				{
					type: "link",
					url: "file:///workspace/project/src/My%20App.tsx#L8",
					children: [{ type: "text", value: "My App" }],
				},
			],
		};

		remarkWorkspaceFileLinks({
			workspaceFolders: [{ path: "/workspace/project", isPrimary: true }],
		})(tree);

		expect(tree.children?.[0]?.url).toBe("/workspace/project/src/My%20App.tsx#L8");
	});
});
