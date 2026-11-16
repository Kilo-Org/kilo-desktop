import { createElement, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	MarkdownExtension,
	type ChatMarkdownContext,
	type MarkdownExtensionImplementation,
} from "@kilo-desktop/plugin-chat/contracts";
import { MarkdownAnchor, MarkdownContent } from "@kilo-desktop/ui/components/markdown-content";

import type { FileLinkResolution } from "../../contracts/models.js";
import { FILE_OBJECT_TYPE, FILES_PANE_KIND } from "../../contracts/panes.js";
import { bootFilesHost, WORK_SESSION_ID, type FilesHost } from "../../test/files-host.js";
import type { DocumentMethods } from "../documents.js";

const CONTEXT: ChatMarkdownContext = {
	workSessionId: WORK_SESSION_ID,
	workspaceFolders: [{ path: "/workspace/project", isPrimary: true }],
};

const exactAt = (relativePath: string): FileLinkResolution => ({
	kind: "exact",
	paths: [relativePath],
	truncated: false,
});

/** kilo.files' markdown extension as kilo.chat makes it for a transcript. */
function extensionOf(host: FilesHost) {
	const contribution = host.renderer.extensions
		.list(MarkdownExtension)
		.find((candidate) => candidate.key === "kilo.files/file-links");
	const implementation = contribution?.implementation as MarkdownExtensionImplementation;
	return implementation(CONTEXT);
}

async function boot(documents: Partial<DocumentMethods>) {
	return bootFilesHost({ documents, folders: CONTEXT.workspaceFolders });
}

const opened = (path: string) => ({
	workSessionId: WORK_SESSION_ID,
	ref: { type: FILE_OBJECT_TYPE, id: `/workspace/project/${path}` },
});

describe("kilo.files' markdown extension", () => {
	it("renders a compact file chip that opens the file at its line and column", async () => {
		const host = await boot({
			resolveFileLink: async ({ relativePath }) => exactAt(relativePath),
			existingPaths: async () => ({ paths: [] }),
		});
		const FileAnchor = extensionOf(host).decorateComponents?.({ a: MarkdownAnchor }).a;
		if (typeof FileAnchor !== "function") throw new Error("Expected an anchor component");

		host.render(
			createElement(FileAnchor, {
				href: "apps/desktop/AGENTS.md#L42C7",
				children: "apps/desktop/AGENTS.md",
				"data-file-parent-suffix": "apps/desktop",
			} as ComponentProps<"a">),
		);

		const chip = page.getByTestId("markdown-file-link");
		await expect.element(chip).toHaveTextContent("AGENTS.md · apps/desktop · L42:C7");
		expect(chip.element().querySelector("[data-pierre-file-icon]")).not.toBeNull();

		await chip.click();
		await vi.waitFor(() => expect(host.openedObjects).toEqual([opened("apps/desktop/AGENTS.md")]));
		await vi.waitFor(() =>
			expect(host.sessionPanes().panes).toEqual([
				expect.objectContaining({
					kind: FILES_PANE_KIND,
					metadata: expect.objectContaining({ line: "42", column: "7" }),
				}),
			]),
		);
		expect(host.sessionPanes().panes[0]?.metadata.revealRequest).toMatch(/^[\w-]{36}$/u);
	});

	it("renders qualifying inline-code paths as file chips without a root existence check", async () => {
		const existingPaths = vi.fn(async () => ({ paths: [] }));
		const host = await boot({
			existingPaths,
			resolveFileLink: async ({ relativePath }) => exactAt(relativePath),
		});

		host.render(
			<MarkdownContent text="`notebooks/analysis.ipynb`" extensions={[extensionOf(host)]} />,
		);

		const chip = page.getByTestId("markdown-file-link");
		await expect.element(chip).toHaveTextContent("analysis.ipynb");
		await chip.click();
		await vi.waitFor(() =>
			expect(host.openedObjects).toEqual([opened("notebooks/analysis.ipynb")]),
		);
		expect(host.updates).toEqual([]);
		expect(existingPaths).not.toHaveBeenCalled();
	});

	it("renders a bare inline filename when it exists in the workspace", async () => {
		const existingPaths = vi.fn(async () => ({ paths: ["README.md"] }));
		const host = await boot({ existingPaths });
		const FileCode = extensionOf(host).decorateComponents?.({}).code;
		if (typeof FileCode !== "function") throw new Error("Expected a code component");
		const inlineCodeNode = (value: string) => ({
			type: "element" as const,
			tagName: "code",
			properties: { "data-inline-code": "" },
			children: [{ type: "text" as const, value }],
		});

		host.render(
			<>
				{createElement(FileCode, { children: "README.md", node: inlineCodeNode("README.md") })}
				{" and "}
				{createElement(FileCode, { children: "node.meta", node: inlineCodeNode("node.meta") })}
			</>,
		);

		const chip = page.getByTestId("markdown-file-link");
		await expect.element(chip).toHaveTextContent("README.md");
		expect(
			[...document.querySelectorAll("code")].some((element) => element.textContent === "node.meta"),
		).toBe(true);
		expect(existingPaths).toHaveBeenCalledTimes(1);
		expect(existingPaths).toHaveBeenCalledWith({
			workspaceDirectory: "/workspace/project",
			relativePaths: ["README.md", "node.meta"],
		});
	});

	it("renders plain paths as file chips only when they exist in the workspace", async () => {
		const list = vi.fn(async () => ({
			paths: ["AGENTS.md", "docs/", "docs/TESTING.md"],
			truncated: false,
		}));
		const existingPaths = vi.fn(async () => ({ paths: ["AGENTS.md", "docs/TESTING.md"] }));
		const host = await boot({
			existingPaths,
			list,
			resolveFileLink: async ({ relativePath }) => exactAt(relativePath),
		});

		const { container } = host.render(
			<MarkdownContent
				text={"- AGENTS.md\n- docs/TESTING.md\n- docs/missing.md"}
				extensions={[extensionOf(host)]}
			/>,
		);

		await expect
			.poll(() => container.querySelectorAll('[data-qa-id="markdown-file-link"]').length)
			.toBe(2);
		expect(
			[...container.querySelectorAll('[data-qa-id="markdown-file-link"]')].map((chip) =>
				chip.getAttribute("title"),
			),
		).toEqual(["AGENTS.md", "docs/TESTING.md"]);
		expect(container.querySelector('a[title="docs/missing.md"]')).toBeNull();
		expect(container.textContent).toContain("docs/missing.md");
		(container.querySelector('a[title="docs/TESTING.md"]') as HTMLAnchorElement).click();
		await vi.waitFor(() => expect(host.openedObjects).toEqual([opened("docs/TESTING.md")]));
		expect(existingPaths).toHaveBeenCalledTimes(1);
		expect(existingPaths).toHaveBeenCalledWith({
			workspaceDirectory: "/workspace/project",
			relativePaths: ["AGENTS.md", "docs/TESTING.md", "docs/missing.md"],
		});
		expect(list).not.toHaveBeenCalled();
	});

	describe("clicking an unresolved link", () => {
		async function renderSubfolderLink(resolution: FileLinkResolution) {
			const resolveFileLink = vi.fn(async () => resolution);
			const host = await boot({ resolveFileLink });
			host.render(
				<MarkdownContent text={"`src/kilo-plugin/index.ts`"} extensions={[extensionOf(host)]} />,
			);
			return { host, resolveFileLink };
		}

		it("opens the single suffix match", async () => {
			const { host, resolveFileLink } = await renderSubfolderLink({
				kind: "matches",
				paths: ["plugins/notebook/src/kilo-plugin/index.ts"],
				truncated: false,
			});

			await page.getByTestId("markdown-file-link").click();

			await vi.waitFor(() =>
				expect(host.openedObjects).toEqual([opened("plugins/notebook/src/kilo-plugin/index.ts")]),
			);
			expect(resolveFileLink).toHaveBeenCalledWith({
				workspaceDirectory: "/workspace/project",
				relativePath: "src/kilo-plugin/index.ts",
			});
		});

		it("offers a picker for several matches and opens only the chosen file", async () => {
			const { host } = await renderSubfolderLink({
				kind: "matches",
				paths: ["a/src/kilo-plugin/index.ts", "b/src/kilo-plugin/index.ts"],
				truncated: false,
			});

			await page.getByTestId("markdown-file-link").click();
			await page.getByTestId("file-link-candidate-b/src/kilo-plugin/index.ts").click();

			await vi.waitFor(() =>
				expect(host.openedObjects).toEqual([opened("b/src/kilo-plugin/index.ts")]),
			);
		});

		it("reports a missing file and does not open the Files pane", async () => {
			const { host } = await renderSubfolderLink({ kind: "none", paths: [], truncated: false });

			await page.getByTestId("markdown-file-link").click();

			await expect
				.element(page.getByText("File not found: src/kilo-plugin/index.ts", { exact: true }))
				.toBeVisible();
			expect(host.openedObjects).toEqual([]);
		});

		it("says the search was incomplete when a missing file was truncated", async () => {
			const { host } = await renderSubfolderLink({ kind: "none", paths: [], truncated: true });

			await page.getByTestId("markdown-file-link").click();

			await expect
				.element(
					page.getByText("File not found: src/kilo-plugin/index.ts. The search was incomplete."),
				)
				.toBeVisible();
			expect(host.openedObjects).toEqual([]);
		});
	});
});
