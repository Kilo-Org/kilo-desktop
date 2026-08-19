import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { filesContract, type FilesServiceContract } from "../contracts/schemas.js";
import { FilesView, type FilesViewProps } from "./FilesView.js";

const PROPS: FilesViewProps = {
	sessionId: "session-1",
	instanceId: "files-1",
	title: "Files 1",
	workspaceDirectory: "/workspace",
};

function renderView(
	handlers: FilesServiceContract,
	props: Partial<FilesViewProps> = {},
	panel: Record<string, unknown> = {},
	width = 900,
) {
	const sdk = createFakeSdk({ featureId: "files", channels: filesContract, handlers });
	const system = createFakeFeatureSystem({ sdks: { files: sdk } });
	system.getSdk("kilo-ui").plugins.expose("chatRightPanel", {
		setTabTitle: vi.fn(),
		setTabIconPath: vi.fn(),
		setTabDirty: vi.fn(),
		registerTabLifecycle: vi.fn(() => vi.fn()),
		...panel,
	});
	return render(
		<SdkProvider system={system}>
			<div className="flex" style={{ height: 600, width }}>
				<FilesView {...PROPS} {...props} />
			</div>
		</SdkProvider>,
	);
}

const handlers = (): FilesServiceContract => ({
	list: async () => ({
		paths: ["docs/", "docs/readme.md", "src/", "src/index.ts"],
		truncated: false,
	}),
	read: async ({ relativePath }) => ({
		kind: "text",
		contents: relativePath.endsWith(".md") ? "# Read me" : "export const value = 1;",
		byteLength: 23,
		truncated: false,
		revision: "a".repeat(64),
	}),
	write: async () => ({ status: "saved", revision: "b".repeat(64) }),
});

async function openTreePath(relativePath: string): Promise<void> {
	await vi.waitFor(() => {
		const host = document.querySelector('[data-qa-id="files-tree"]');
		expect(host?.shadowRoot?.querySelector(`[data-item-path="${relativePath}"]`)).not.toBeNull();
	});
	const host = document.querySelector('[data-qa-id="files-tree"]');
	host?.shadowRoot?.querySelector<HTMLElement>(`[data-item-path="${relativePath}"]`)?.click();
}

async function replaceEditorText(contents: string): Promise<void> {
	let editor: HTMLElement | null = null;
	await vi.waitFor(() => {
		editor =
			Array.from(document.querySelectorAll("diffs-container"))
				.map((host) =>
					host.shadowRoot?.querySelector<HTMLElement>('[data-content][contenteditable="true"]'),
				)
				.find((candidate) => candidate != null) ?? null;
		expect(editor).not.toBeNull();
	});
	if (!editor) throw new Error("Diffs editor was not mounted");
	const locator = page.elementLocator(editor);
	await locator.click();
	await userEvent.keyboard("{Control>}a{/Control}");
	await userEvent.keyboard(contents);
}

afterEach(() => {
	cleanup();
	localStorage.clear();
});

describe("FilesView", () => {
	it("shows an explicit state when the chat has no workspace", async () => {
		renderView(handlers(), { workspaceDirectory: undefined });
		await expect.element(page.getByTestId("files-no-workspace")).toBeVisible();
	});

	it("renders the real Trees explorer and opens a selected file with a breadcrumb", async () => {
		const setTabTitle = vi.fn();
		const setTabIconPath = vi.fn();
		renderView(handlers(), {}, { setTabIconPath, setTabTitle });
		await expect.element(page.getByTestId("files-tree")).toBeVisible();
		await vi.waitFor(() => {
			const host = document.querySelector('[data-qa-id="files-tree"]');
			expect(host?.shadowRoot?.querySelector('[data-item-path="docs/readme.md"]')).not.toBeNull();
		});
		const host = document.querySelector('[data-qa-id="files-tree"]');
		const row = host?.shadowRoot?.querySelector<HTMLElement>('[data-item-path="docs/readme.md"]');
		row?.click();

		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("docs/readme.md");
		await vi.waitFor(() =>
			expect(setTabTitle).toHaveBeenCalledWith("session-1", "files-1", "readme.md"),
		);
		expect(setTabIconPath).toHaveBeenCalledWith("session-1", "files-1", "docs/readme.md");
	});

	it("persists the t3code-style explorer toggle", async () => {
		renderView(handlers());
		await openTreePath("src/index.ts");
		await expect.element(page.getByTestId("files-tree-toggle")).toBeVisible();
		fireEvent.click(document.querySelector('[data-qa-id="files-tree-toggle"]')!);
		expect(localStorage.getItem("files.explorerOpen")).toBe("false");
		expect(document.querySelector('[data-qa-id="files-tree"]')).toBeNull();
	});

	it("shows active states for the file tree and Markdown toggles", async () => {
		renderView(handlers());
		await openTreePath("docs/readme.md");
		await expect.element(page.getByTestId("files-tree-toggle")).toBeVisible();
		await expect.element(page.getByTestId("files-markdown-toggle")).toBeVisible();

		const treeToggle = document.querySelector<HTMLElement>('[data-qa-id="files-tree-toggle"]')!;
		const markdownToggle = document.querySelector<HTMLElement>(
			'[data-qa-id="files-markdown-toggle"]',
		)!;
		expect(treeToggle.getAttribute("aria-pressed")).toBe("true");
		expect(treeToggle.classList.contains("bg-foreground/5")).toBe(true);
		expect(markdownToggle.getAttribute("aria-pressed")).toBe("false");
		expect(markdownToggle.classList.contains("bg-foreground/5")).toBe(false);

		fireEvent.click(treeToggle);
		fireEvent.click(markdownToggle);
		expect(treeToggle.getAttribute("aria-pressed")).toBe("false");
		expect(treeToggle.classList.contains("bg-foreground/5")).toBe(false);
		expect(markdownToggle.getAttribute("aria-pressed")).toBe("true");
		expect(markdownToggle.classList.contains("bg-foreground/5")).toBe(true);
	});

	it("resizes the file explorer by dragging its divider and persists the width", async () => {
		renderView(handlers());
		await openTreePath("src/index.ts");

		let explorer: HTMLElement | null = null;
		let handle: HTMLElement | null = null;
		await vi.waitFor(() => {
			explorer = document.querySelector<HTMLElement>(".files-explorer-pane");
			handle = document.querySelector<HTMLElement>('[data-qa-id="files-explorer-resize-handle"]');
			expect(explorer).not.toBeNull();
			expect(handle).not.toBeNull();
		});
		const initialWidth = explorer!.getBoundingClientRect().width;

		fireEvent.pointerDown(handle!, { buttons: 1, clientX: 600, pointerId: 7 });
		fireEvent.pointerMove(handle!, { buttons: 1, clientX: 520, pointerId: 7 });
		fireEvent.pointerUp(handle!, { clientX: 520, pointerId: 7 });

		await vi.waitFor(() => {
			expect(explorer!.getBoundingClientRect().width).toBeCloseTo(initialWidth + 80, 0);
		});
		expect(Number(localStorage.getItem("files.explorerWidth"))).toBeCloseTo(initialWidth + 80, 0);
	});

	it("resizes the file explorer from the keyboard", async () => {
		renderView(handlers());
		await openTreePath("src/index.ts");

		let explorer: HTMLElement | null = null;
		let handle: HTMLElement | null = null;
		await vi.waitFor(() => {
			explorer = document.querySelector<HTMLElement>(".files-explorer-pane");
			handle = document.querySelector<HTMLElement>('[data-qa-id="files-explorer-resize-handle"]');
			expect(explorer).not.toBeNull();
			expect(handle).not.toBeNull();
		});
		const initialWidth = explorer!.getBoundingClientRect().width;

		expect(handle!.tabIndex).toBe(0);
		fireEvent.keyDown(handle!, { key: "ArrowLeft" });
		await vi.waitFor(() => {
			expect(explorer!.getBoundingClientRect().width).toBeCloseTo(initialWidth + 16, 0);
		});
	});

	it("keeps the file content visible beside the explorer in a narrow panel", async () => {
		renderView(handlers(), {}, {}, 580);
		await openTreePath("src/index.ts");
		await expect.element(page.getByTestId("files-viewer-pane")).toBeVisible();

		const editor = document.querySelector<HTMLElement>('[data-qa-id="files-viewer-pane"]');
		const explorer = document.querySelector<HTMLElement>(".files-explorer-pane");
		if (!editor || !explorer) throw new Error("Expected the editor and explorer panes");
		const editorBounds = editor.getBoundingClientRect();
		const explorerBounds = explorer.getBoundingClientRect();

		expect(editorBounds.width).toBeGreaterThan(150);
		expect(explorerBounds.width).toBeGreaterThan(150);
		expect(editorBounds.right).toBeLessThanOrEqual(explorerBounds.left + 1);
	});

	it("lets the shell panel surface show through the tree and editor", async () => {
		renderView(handlers());
		await openTreePath("src/index.ts");

		const tree = document.querySelector<HTMLElement>('[data-qa-id="files-tree"]');
		let editor: HTMLElement | null = null;
		await vi.waitFor(() => {
			editor = document.querySelector<HTMLElement>("diffs-container");
			expect(tree).not.toBeNull();
			expect(editor).not.toBeNull();
		});

		await vi.waitFor(() => {
			expect(tree!.style.getPropertyValue("--trees-bg-override")).toBe("transparent");
			expect(getComputedStyle(tree!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
			expect(editor!.shadowRoot?.querySelector("[data-unsafe-css]")).not.toBeNull();
			expect(getComputedStyle(editor!).getPropertyValue("--diffs-bg").trim()).toBe("transparent");
			expect(getComputedStyle(editor!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
		});
	});

	it("wraps long editor lines within the file viewer", async () => {
		const read = vi.fn<FilesServiceContract["read"]>(async () => ({
			kind: "text",
			contents: `export const value = "${"x".repeat(300)}";`,
			byteLength: 324,
			truncated: false,
			revision: "a".repeat(64),
		}));
		renderView({ ...handlers(), read }, {}, {}, 580);
		await openTreePath("src/index.ts");

		let line: HTMLElement | null = null;
		await vi.waitFor(() => {
			line =
				Array.from(document.querySelectorAll("diffs-container"))
					.flatMap((host) =>
						Array.from(host.shadowRoot?.querySelectorAll<HTMLElement>("[data-line]") ?? []),
					)
					.at(0) ?? null;
			expect(line).not.toBeNull();
		});

		expect(getComputedStyle(line!).whiteSpace).toBe("pre-wrap");
		expect(getComputedStyle(line!).wordBreak).toBe("break-word");
		const viewer = document.querySelector<HTMLElement>('[data-qa-id="files-viewer-pane"]');
		expect(viewer).not.toBeNull();
		expect(viewer!.scrollWidth).toBeLessThanOrEqual(viewer!.clientWidth + 1);
	});

	it("edits with Diffs, publishes dirty state, and saves manually", async () => {
		const setTabDirty = vi.fn();
		const write = vi.fn(async () => ({ status: "saved" as const, revision: "b".repeat(64) }));
		renderView({ ...handlers(), write }, {}, { setTabDirty });
		await openTreePath("src/index.ts");
		await replaceEditorText("export const value = 2;");

		await vi.waitFor(() => expect(setTabDirty).toHaveBeenCalledWith("session-1", "files-1", true));
		fireEvent.click(document.querySelector('[data-qa-id="files-save"]')!);
		await vi.waitFor(() =>
			expect(write).toHaveBeenCalledWith(
				expect.objectContaining({
					relativePath: "src/index.ts",
					contents: expect.stringContaining("export const value = 2;"),
				}),
			),
		);
		await vi.waitFor(() => expect(setTabDirty).toHaveBeenCalledWith("session-1", "files-1", false));
	});

	it("renders Markdown without raw HTML and opens relative file links in the same tab", async () => {
		const markdownHandlers: FilesServiceContract = {
			...handlers(),
			read: async ({ relativePath }) => ({
				kind: "text",
				contents:
					relativePath === "docs/readme.md"
						? "<!-- hidden -->\n# Read me\n\n- First item\n\n<script>unsafe()</script>\n[Source](../src/index.ts)"
						: "export const value = 1;",
				byteLength: 96,
				truncated: false,
				revision: "a".repeat(64),
			}),
		};
		renderView(markdownHandlers);
		await openTreePath("docs/readme.md");
		await expect.element(page.getByTestId("files-markdown-toggle")).toBeVisible();
		fireEvent.click(document.querySelector('[data-qa-id="files-markdown-toggle"]')!);

		await expect.element(page.getByTestId("files-markdown-preview")).toBeVisible();
		expect(document.querySelector('[data-qa-id="files-markdown-preview"]')?.textContent).toContain(
			"Read me",
		);
		expect(document.querySelector('[data-qa-id="files-markdown-preview"] h1')?.classList).toContain(
			"aui-md-h1",
		);
		expect(document.querySelector('[data-qa-id="files-markdown-preview"] ul')?.classList).toContain(
			"list-disc",
		);
		expect(
			document.querySelector('[data-qa-id="files-markdown-preview"]')?.textContent,
		).not.toContain("hidden");
		expect(document.querySelector('[data-qa-id="files-markdown-preview"] script')).toBeNull();
		fireEvent.click(document.querySelector('[data-qa-id="files-markdown-preview"] a')!);
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("src/index.ts");
	});

	it("loads workspace-relative Markdown images and leaves fragment links in the preview", async () => {
		const read = vi.fn<FilesServiceContract["read"]>(async ({ relativePath }) =>
			relativePath === "assets/diagram.png"
				? { kind: "image", mimeType: "image/png", base64: "AQID", byteLength: 3 }
				: {
						kind: "text",
						contents:
							"# Read me\n![Diagram](../assets/diagram.png)\n[Heading](#read-me)\n![Outside](../../../outside.png)",
						byteLength: 96,
						truncated: false,
						revision: "a".repeat(64),
					},
		);
		renderView({ ...handlers(), read });
		await openTreePath("docs/readme.md");
		await expect.element(page.getByTestId("files-markdown-toggle")).toBeVisible();
		await page.getByTestId("files-markdown-toggle").click();

		await vi.waitFor(() =>
			expect(
				document.querySelector<HTMLImageElement>(
					'[data-qa-id="files-markdown-preview"] img[alt="Diagram"]',
				)?.src,
			).toBe("data:image/png;base64,AQID"),
		);
		expect(read).toHaveBeenCalledWith({
			workspaceDirectory: "/workspace",
			relativePath: "assets/diagram.png",
		});
		fireEvent.click(
			document.querySelector<HTMLAnchorElement>(
				'[data-qa-id="files-markdown-preview"] a[href="#read-me"]',
			)!,
		);
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("docs/readme.md");
		expect(document.querySelector('[data-qa-id="files-markdown-preview"]')?.textContent).toContain(
			"Outside",
		);
	});

	it("shows image and deferred preview states", async () => {
		const previewHandlers: FilesServiceContract = {
			...handlers(),
			list: async () => ({ paths: ["image.png", "manual.pdf"], truncated: false }),
			read: async ({ relativePath }) =>
				relativePath === "image.png"
					? { kind: "image", mimeType: "image/png", base64: "AQID", byteLength: 3 }
					: { kind: "unsupported", reason: "preview-deferred", byteLength: 20 },
		};
		renderView(previewHandlers);
		await openTreePath("image.png");
		await expect.element(page.getByTestId("files-image-preview")).toBeVisible();
		await openTreePath("manual.pdf");
		await expect
			.element(page.getByTestId("files-unsupported"))
			.toHaveTextContent("Preview support for this file type is not available yet.");
	});

	it("shows empty, truncated, list failure, and unsupported-file states", async () => {
		renderView({
			...handlers(),
			list: async () => ({ paths: [], truncated: false }),
		});
		await expect.element(page.getByTestId("files-empty")).toBeVisible();

		cleanup();
		renderView({
			...handlers(),
			list: async () => {
				throw new Error("scan failed");
			},
		});
		await expect.element(page.getByTestId("files-list-error")).toHaveTextContent("scan failed");

		cleanup();
		renderView({
			...handlers(),
			list: async () => ({ paths: ["large.txt", "archive.zip"], truncated: true }),
			read: async ({ relativePath }) =>
				relativePath === "large.txt"
					? { kind: "text", contents: "preview", byteLength: 2_000_000, truncated: true }
					: { kind: "unsupported", reason: "binary", byteLength: 42 },
		});
		await expect.element(page.getByText("Showing the first 25,000 entries.")).toBeVisible();
		await openTreePath("large.txt");
		await expect.element(page.getByTestId("files-truncated")).toBeVisible();
		expect(document.querySelector('[data-qa-id="files-save"]')).toBeNull();
		await openTreePath("archive.zip");
		await expect
			.element(page.getByTestId("files-unsupported"))
			.toHaveTextContent("This binary file cannot be previewed.");
	});

	it("guards file switches while dirty with cancel and discard", async () => {
		renderView(handlers());
		await openTreePath("src/index.ts");
		await replaceEditorText("changed");
		await openTreePath("docs/readme.md");
		await expect.element(page.getByTestId("files-unsaved-dialog")).toBeVisible();
		await page.getByTestId("files-unsaved-cancel").click();
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("src/index.ts");
		await vi.waitFor(() => {
			const host = document.querySelector('[data-qa-id="files-tree"]');
			expect(
				host?.shadowRoot
					?.querySelector('[data-item-path="src/index.ts"]')
					?.hasAttribute("data-item-selected"),
			).toBe(true);
		});

		await openTreePath("docs/readme.md");
		await expect.element(page.getByTestId("files-unsaved-dialog")).toBeVisible();
		await page.getByTestId("files-unsaved-discard").click();
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("docs/readme.md");
	});

	it("saves from the keyboard and through the dirty-switch guard", async () => {
		const write = vi.fn(async () => ({ status: "saved" as const, revision: "b".repeat(64) }));
		renderView({ ...handlers(), write });
		await openTreePath("src/index.ts");
		await replaceEditorText("keyboard change");
		await expect.element(page.getByTestId("files-save")).toBeEnabled();
		await userEvent.keyboard("{Control>}s{/Control}");
		await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));

		await replaceEditorText("guarded change");
		await openTreePath("docs/readme.md");
		await page.getByTestId("files-unsaved-save").click();
		await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("docs/readme.md");
	});

	it("keeps conflicts dirty and allows explicit overwrite", async () => {
		const write = vi
			.fn<FilesServiceContract["write"]>()
			.mockResolvedValueOnce({ status: "conflict", diskRevision: "c".repeat(64) })
			.mockResolvedValueOnce({ status: "saved", revision: "d".repeat(64) });
		renderView({ ...handlers(), write });
		await openTreePath("src/index.ts");
		await replaceEditorText("changed");
		fireEvent.click(document.querySelector('[data-qa-id="files-save"]')!);
		await expect.element(page.getByTestId("files-conflict-dialog")).toBeVisible();
		fireEvent.click(document.querySelector('[data-qa-id="files-conflict-overwrite"]')!);
		await vi.waitFor(() =>
			expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ force: true })),
		);
	});

	it("can cancel a conflict or reload the disk version", async () => {
		const read = vi
			.fn<FilesServiceContract["read"]>()
			.mockResolvedValueOnce({
				kind: "text",
				contents: "first",
				byteLength: 5,
				truncated: false,
				revision: "a".repeat(64),
			})
			.mockResolvedValueOnce({
				kind: "text",
				contents: "from disk",
				byteLength: 9,
				truncated: false,
				revision: "c".repeat(64),
			});
		const write = vi.fn<FilesServiceContract["write"]>(async () => ({
			status: "conflict",
			diskRevision: "c".repeat(64),
		}));
		renderView({ ...handlers(), read, write });
		await openTreePath("src/index.ts");
		await replaceEditorText("changed");
		fireEvent.click(document.querySelector('[data-qa-id="files-save"]')!);
		await expect.element(page.getByTestId("files-conflict-dialog")).toBeVisible();
		await page.getByTestId("files-conflict-cancel").click();
		await expect.element(page.getByTestId("files-conflict-dialog")).not.toBeInTheDocument();

		fireEvent.click(document.querySelector('[data-qa-id="files-save"]')!);
		await expect.element(page.getByTestId("files-conflict-dialog")).toBeVisible();
		await page.getByTestId("files-conflict-reload").click();
		await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("src/index.ts");
	});
});
