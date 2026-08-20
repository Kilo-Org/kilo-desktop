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
		getActiveTabId: vi.fn(() => props.instanceId ?? PROPS.instanceId),
		updateTab: vi.fn(),
		registerTabLifecycle: vi.fn(() => vi.fn()),
		...panel,
	});
	const renderTree = (nextProps: Partial<FilesViewProps>) => (
		<SdkProvider system={system}>
			<div className="flex" style={{ height: 600, width }}>
				<FilesView {...PROPS} {...nextProps} />
			</div>
		</SdkProvider>
	);
	const result = render(renderTree(props));
	return {
		...result,
		rerenderView(nextProps: Partial<FilesViewProps>) {
			result.rerender(renderTree(nextProps));
		},
	};
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
	listExternalEditors: async () => ({ editors: ["cursor", "vscode"] }),
	openExternalEditor: async () => ({ opened: true }),
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

	it("removes the generated ordinal from the initial Files tab title", async () => {
		const updateTab = vi.fn();
		renderView(handlers(), {}, { updateTab });

		await vi.waitFor(() =>
			expect(updateTab).toHaveBeenCalledWith("session-1", "files-1", { title: "Files" }),
		);
	});

	it("shows an editor empty state beside the workspace tree before a file is opened", async () => {
		renderView(handlers(), {}, {}, 580);

		await expect.element(page.getByTestId("files-editor-empty")).toBeVisible();
		await expect.element(page.getByRole("heading", { name: "Open file" })).toBeVisible();
		await expect.element(page.getByText("Select a file from the file list")).toBeVisible();
		await expect.element(page.getByTestId("files-tree")).toBeVisible();
	});

	it("switches between workspace folders from a selector above search", async () => {
		const service = handlers();
		const read = vi.fn(service.read);
		const list = vi.fn<FilesServiceContract["list"]>(async ({ workspaceDirectory }) => ({
			paths:
				workspaceDirectory === "/reference"
					? ["guides/", "guides/reference.md"]
					: ["src/", "src/index.ts"],
			truncated: false,
		}));
		renderView(
			{ ...service, list, read },
			{
				workspaceFolders: [
					{ path: "/workspace", isPrimary: true },
					{ path: "/reference", isPrimary: false },
				],
			},
		);

		const folderSelector = page.getByRole("combobox", { name: "Workspace folder" });
		await expect.element(folderSelector).toBeVisible();
		await vi.waitFor(() => expect(list).toHaveBeenCalledWith({ workspaceDirectory: "/workspace" }));

		await folderSelector.click();
		await page.getByRole("option", { name: "reference" }).click();

		await vi.waitFor(() => expect(list).toHaveBeenCalledWith({ workspaceDirectory: "/reference" }));
		await vi.waitFor(() => {
			const host = document.querySelector('[data-qa-id="files-tree"]');
			expect(
				host?.shadowRoot?.querySelector('[data-item-path="guides/reference.md"]'),
			).not.toBeNull();
		});
		await openTreePath("guides/reference.md");
		await vi.waitFor(() =>
			expect(read).toHaveBeenCalledWith({
				workspaceDirectory: "/reference",
				relativePath: "guides/reference.md",
			}),
		);
	});

	it("opens the workspace file requested by contributed tab metadata", async () => {
		const read = vi.fn<FilesServiceContract["read"]>(async () => ({
			kind: "text",
			contents: "first line\nsecond line\nthird line",
			byteLength: 32,
			truncated: false,
			revision: "a".repeat(64),
		}));
		renderView(
			{ ...handlers(), read },
			{
				metadata: {
					workspaceDirectory: "/workspace",
					relativePath: "src/index.ts",
					line: "2",
					column: "4",
				},
			},
		);

		await vi.waitFor(() =>
			expect(read).toHaveBeenCalledWith({
				workspaceDirectory: "/workspace",
				relativePath: "src/index.ts",
			}),
		);
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("src/index.ts");
		await vi.waitFor(() => {
			const selectedLines = Array.from(document.querySelectorAll("diffs-container")).flatMap(
				(host) =>
					Array.from(host.shadowRoot?.querySelectorAll<HTMLElement>("[data-selected-line]") ?? []),
			);
			expect(selectedLines.some((line) => line.dataset.line === "2")).toBe(true);
		});
	});

	it("does not show a folder selector for a single-folder workspace", async () => {
		renderView(handlers(), {
			workspaceFolders: [{ path: "/workspace", isPrimary: true }],
		});

		await expect
			.element(page.getByRole("combobox", { name: "Workspace folder" }))
			.not.toBeInTheDocument();
	});

	it("renders the real Trees explorer and opens a selected file with a breadcrumb", async () => {
		const updateTab = vi.fn();
		renderView(handlers(), {}, { updateTab });
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
			expect(updateTab).toHaveBeenCalledWith("session-1", "files-1", {
				title: "readme.md",
				iconKey: "docs/readme.md",
				metadata: {
					workspaceDirectory: "/workspace",
					relativePath: "docs/readme.md",
				},
			}),
		);
	});

	it("opens the latest file request when a reused tab receives new metadata", async () => {
		const view = renderView(handlers(), {
			metadata: { workspaceDirectory: "/workspace", relativePath: "src/index.ts" },
		});
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("src/index.ts");

		await openTreePath("docs/readme.md");
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("docs/readme.md");
		view.rerenderView({
			metadata: {
				workspaceDirectory: "/workspace",
				relativePath: "src/index.ts",
				line: "42",
			},
		});

		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("src/index.ts");
	});

	it("opens the selected file in an available external editor and remembers the choice", async () => {
		const openExternalEditor = vi.fn<FilesServiceContract["openExternalEditor"]>(async () => ({
			opened: true,
		}));
		renderView({ ...handlers(), openExternalEditor });
		await openTreePath("src/index.ts");

		await page.getByTestId("files-external-editor-menu").click();
		await page.getByRole("menuitem", { name: "VS Code" }).click();

		await vi.waitFor(() =>
			expect(openExternalEditor).toHaveBeenCalledWith({
				workspaceDirectory: "/workspace",
				relativePath: "src/index.ts",
				editor: "vscode",
			}),
		);
		expect(localStorage.getItem("files.preferredExternalEditor")).toBe("vscode");
	});

	it("opens a file in the default preferred editor", async () => {
		const openExternalEditor = vi.fn<FilesServiceContract["openExternalEditor"]>(async () => ({
			opened: true,
		}));
		renderView({ ...handlers(), openExternalEditor });
		await openTreePath("src/index.ts");

		const openButton = page.getByTestId("files-open-external-editor");
		await expect.element(openButton).toBeEnabled();

		await openButton.click();
		await vi.waitFor(() =>
			expect(openExternalEditor).toHaveBeenCalledWith({
				workspaceDirectory: "/workspace",
				relativePath: "src/index.ts",
				editor: "cursor",
			}),
		);
	});

	it("shows an inline error when an external editor cannot be opened", async () => {
		renderView({
			...handlers(),
			openExternalEditor: async () => {
				throw new Error("VS Code could not be launched");
			},
		});
		await openTreePath("src/index.ts");

		await page.getByTestId("files-external-editor-menu").click();
		await page.getByRole("menuitem", { name: "VS Code" }).click();

		await expect
			.element(page.getByTestId("files-external-editor-error"))
			.toHaveTextContent("VS Code could not be launched");
	});

	it("uses the file-operation fallback for a non-Error launch rejection", async () => {
		renderView({
			...handlers(),
			openExternalEditor: async () => Promise.reject("launch failed"),
		});
		await openTreePath("src/index.ts");

		await page.getByTestId("files-open-external-editor").click();

		await expect
			.element(page.getByTestId("files-external-editor-error"))
			.toHaveTextContent("The file operation failed.");
	});

	it("uses the stored available editor without adding a menu label", async () => {
		localStorage.setItem("files.preferredExternalEditor", "vscode");
		renderView(handlers());
		await openTreePath("src/index.ts");
		await expect
			.element(page.getByTestId("files-open-external-editor"))
			.toHaveAttribute("aria-label", "Open file in VS Code");
	});

	it("explains when no external editors are installed", async () => {
		renderView({
			...handlers(),
			listExternalEditors: async () => ({ editors: [] }),
		});
		await openTreePath("src/index.ts");
		await expect.element(page.getByTestId("files-open-external-editor")).toBeDisabled();

		await page.getByTestId("files-external-editor-menu").click();

		await expect.element(page.getByText("No installed editors found")).toBeVisible();
	});

	it("surfaces external editor discovery failures", async () => {
		renderView({
			...handlers(),
			listExternalEditors: async () => {
				throw new Error("Editor discovery failed");
			},
		});

		await expect
			.element(page.getByTestId("files-external-editor-error"))
			.toHaveTextContent("Editor discovery failed");
	});

	it("persists the t3code-style explorer toggle", async () => {
		renderView(handlers());
		await openTreePath("src/index.ts");
		await expect.element(page.getByTestId("files-tree-toggle")).toBeVisible();
		fireEvent.click(document.querySelector('[data-qa-id="files-tree-toggle"]')!);
		expect(localStorage.getItem("files.explorerOpen")).toBe("false");
		expect(document.querySelector('[data-qa-id="files-tree"]')).toBeNull();
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

	it("edits with Diffs, publishes dirty state, and saves manually", async () => {
		const updateTab = vi.fn();
		const write = vi.fn(async () => ({ status: "saved" as const, revision: "b".repeat(64) }));
		renderView({ ...handlers(), write }, {}, { updateTab });
		await openTreePath("src/index.ts");
		await replaceEditorText("export const value = 2;");

		await vi.waitFor(() =>
			expect(updateTab).toHaveBeenCalledWith("session-1", "files-1", { dirty: true }),
		);
		fireEvent.click(document.querySelector('[data-qa-id="files-save"]')!);
		await vi.waitFor(() =>
			expect(write).toHaveBeenCalledWith(
				expect.objectContaining({
					relativePath: "src/index.ts",
					contents: expect.stringContaining("export const value = 2;"),
				}),
			),
		);
		await vi.waitFor(() =>
			expect(updateTab).toHaveBeenCalledWith("session-1", "files-1", { dirty: false }),
		);
	});

	it("renders relative Markdown links as file chips that open in the same tab", async () => {
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
		expect(
			document.querySelector('[data-qa-id="files-markdown-preview"]')?.textContent,
		).not.toContain("hidden");
		expect(document.querySelector('[data-qa-id="files-markdown-preview"] script')).toBeNull();
		const fileLink = document.querySelector<HTMLElement>('[data-qa-id="markdown-file-link"]');
		expect(fileLink?.textContent).toBe("index.ts");
		fireEvent.click(fileLink!);
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

	it("keeps a text fallback when a Markdown image cannot be read", async () => {
		const read = vi.fn<FilesServiceContract["read"]>(async ({ relativePath }) => {
			if (relativePath === "assets/missing.png") throw new Error("File not found");
			return {
				kind: "text",
				contents: "![Missing diagram](../assets/missing.png)",
				byteLength: 47,
				truncated: false,
				revision: "a".repeat(64),
			};
		});
		renderView({ ...handlers(), read });
		await openTreePath("docs/readme.md");
		await page.getByTestId("files-markdown-toggle").click();

		await expect.element(page.getByText("Missing diagram")).toBeVisible();
		await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
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

	it("ignores the save shortcut while another right-panel tab is active", async () => {
		const write = vi.fn(async () => ({ status: "saved" as const, revision: "b".repeat(64) }));
		renderView({ ...handlers(), write }, {}, { getActiveTabId: () => "another-tab" });
		await openTreePath("src/index.ts");
		await replaceEditorText("background change");

		await userEvent.keyboard("{Control>}s{/Control}");

		expect(write).not.toHaveBeenCalled();
	});

	it("continues a guarded file switch after overwriting a conflict", async () => {
		const write = vi
			.fn<FilesServiceContract["write"]>()
			.mockResolvedValueOnce({ status: "conflict", diskRevision: "c".repeat(64) })
			.mockResolvedValueOnce({ status: "saved", revision: "d".repeat(64) });
		renderView({ ...handlers(), write });
		await openTreePath("src/index.ts");
		await replaceEditorText("changed");
		await openTreePath("docs/readme.md");
		await page.getByTestId("files-unsaved-save").click();
		await expect.element(page.getByTestId("files-conflict-dialog")).toBeVisible();

		await page.getByTestId("files-conflict-overwrite").click();

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
