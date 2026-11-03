import { describe, expect, it } from "vitest";

import { resolveInlineCodeFileLink, resolveMarkdownFileLink } from "./markdown-file-links.js";
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

	it("does not claim scheme-less web hostnames as workspace files", () => {
		const folders = [{ path: "/workspace/project", isPrimary: true }];

		expect(resolveMarkdownFileLink("github.com/acme/repo", folders)).toBeNull();
		expect(resolveMarkdownFileLink("docs.anaconda.com/guide.html", folders)).toBeNull();
		expect(resolveMarkdownFileLink("docs.anaconda.com/guide.html#L3", folders)).toBeNull();
		expect(resolveMarkdownFileLink("src/github.com/a.ts", folders)).toEqual({
			workspaceDirectory: "/workspace/project",
			relativePath: "src/github.com/a.ts",
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
			workspaceDirectory: "C:\\project",
			relativePath: "src/App.tsx",
			line: 9,
		});
	});

	it("keeps the registered Windows workspace path so the file viewer recognizes it", () => {
		const folders = [{ path: "C:\\Users\\me\\project\\", isPrimary: true }] as const;

		expect(resolveMarkdownFileLink("docs/plans/plan.md", folders)).toEqual({
			workspaceDirectory: "C:\\Users\\me\\project\\",
			relativePath: "docs/plans/plan.md",
		});
		expect(resolveMarkdownFileLink("c:\\users\\me\\project\\docs\\plan.md", folders)).toEqual({
			workspaceDirectory: "C:\\Users\\me\\project\\",
			relativePath: "docs/plan.md",
		});
	});

	it("normalizes t3code-style angle-bracketed and slash-prefixed Windows paths", () => {
		const folders = [{ path: "D:/Programme/t3code", isPrimary: true }] as const;

		expect(
			resolveMarkdownFileLink("</D:/Programme/t3code/apps/web/src/ChatMarkdown.tsx:9>", folders),
		).toEqual({
			workspaceDirectory: "D:/Programme/t3code",
			relativePath: "apps/web/src/ChatMarkdown.tsx",
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

describe("resolveInlineCodeFileLink", () => {
	const workspaceFolders = [{ path: "/workspace/project", isPrimary: true }] as const;

	it("matches t3code's conservative inline-code path detection", () => {
		expect(resolveInlineCodeFileLink("src/analysis.ipynb", workspaceFolders)).toMatchObject({
			workspaceDirectory: "/workspace/project",
			relativePath: "src/analysis.ipynb",
		});
		expect(resolveInlineCodeFileLink("src\\analysis.ipynb", workspaceFolders)).toMatchObject({
			relativePath: "src/analysis.ipynb",
		});
		expect(resolveInlineCodeFileLink("script.ts:10", workspaceFolders)).toMatchObject({
			relativePath: "script.ts",
			line: 10,
		});
		expect(resolveInlineCodeFileLink("Makefile:12", workspaceFolders)).toMatchObject({
			relativePath: "Makefile",
			line: 12,
		});
	});

	it("rejects the same ambiguous inline-code shapes as t3code", () => {
		expect(resolveInlineCodeFileLink("analysis.ipynb", workspaceFolders)).toBeNull();
		expect(resolveInlineCodeFileLink("node.meta", workspaceFolders)).toBeNull();
		expect(resolveInlineCodeFileLink("origin/main", workspaceFolders)).toBeNull();
		expect(resolveInlineCodeFileLink("apps/web", workspaceFolders)).toBeNull();
		expect(resolveInlineCodeFileLink("src/**/*.ts", workspaceFolders)).toBeNull();
		expect(resolveInlineCodeFileLink("127.0.0.1:3000", workspaceFolders)).toBeNull();
		expect(resolveInlineCodeFileLink("example.com/index.html", workspaceFolders)).toBeNull();
		expect(resolveInlineCodeFileLink("example.uk/index.html", workspaceFolders)).toBeNull();
		expect(resolveInlineCodeFileLink("localhost:3000", workspaceFolders)).toBeNull();
		expect(resolveInlineCodeFileLink("git worktree list --porcelain", workspaceFolders)).toBeNull();
	});

	it("prefers file references over hostname-like extensions when t3code does", () => {
		expect(resolveInlineCodeFileLink("src/setup.sh:3", workspaceFolders)).not.toBeNull();
		expect(resolveInlineCodeFileLink("Makefile.in:12", workspaceFolders)).not.toBeNull();
		expect(resolveInlineCodeFileLink("conf.d/nginx.conf", workspaceFolders)).not.toBeNull();
		expect(resolveInlineCodeFileLink("script.pl:10", workspaceFolders)).toMatchObject({
			relativePath: "script.pl",
			line: 10,
		});
	});
});

describe("remarkWorkspaceFileLinks", () => {
	it("leaves plain text unchanged unless candidate verification is available", () => {
		const text: MarkdownAstNode = { type: "text", value: "Open docs/TESTING.md." };
		const tree: MarkdownAstNode = { type: "root", children: [text] };

		remarkWorkspaceFileLinks({
			workspaceFolders: [{ path: "/workspace/project", isPrimary: true }],
		})(tree);

		expect(tree.children).toEqual([text]);
	});

	it("marks plain path candidates for workspace existence checks", () => {
		const tree: MarkdownAstNode = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [
						{
							type: "text",
							value: "Open apps/desktop/README.md.",
						},
					],
				},
			],
		};

		remarkWorkspaceFileLinks({
			workspaceFolders: [{ path: "/workspace/project", isPrimary: true }],
			linkifyPlainText: true,
		})(tree);

		expect(tree.children?.[0]?.children).toEqual([
			{ type: "text", value: "Open " },
			{
				type: "link",
				url: "apps/desktop/README.md",
				data: { hProperties: { "data-workspace-file-candidate": "" } },
				children: [{ type: "text", value: "apps/desktop/README.md" }],
			},
			{ type: "text", value: "." },
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
