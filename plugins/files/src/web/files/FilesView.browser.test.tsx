import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
	WORKSPACE_FILE_CHANGE_EVENT,
	type WorkspaceFileChangeEvent,
} from "@kilo-desktop/feature-sdk";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";
import { FIND_BAR_FEATURE_FLAG } from "@kilo-desktop/ui/components/find-bar";

import { filesContract, type FilesServiceContract } from "../../contracts/schemas.js";
import { FilesView, type FilesViewProps } from "./FilesView.js";

const PROPS: FilesViewProps = {
	sessionId: "session-1",
	instanceId: "files-1",
	title: "Files 1",
	workspaceDirectory: "/workspace",
};

function filePane(
	relativePath: string,
	extra: Partial<FilesViewProps> = {},
): Partial<FilesViewProps> {
	const workspaceDirectory =
		extra.metadata?.workspaceDirectory ?? extra.workspaceDirectory ?? "/workspace";
	return {
		instanceId: extra.instanceId ?? PROPS.instanceId,
		title: relativePath.split("/").at(-1) ?? relativePath,
		...extra,
		metadata: {
			workspaceDirectory,
			relativePath,
			...extra.metadata,
		},
	};
}

function requestFile(
	view: { rerenderView: (next: Partial<FilesViewProps>) => void },
	relativePath: string,
): void {
	view.rerenderView(filePane(relativePath));
}

function openedFileCall(
	relativePath: string,
	workspaceDirectory = "/workspace",
	explorerId = "files-1",
) {
	return [
		"session-1",
		{ id: "files.files", title: "Files" },
		{
			instanceId: `file:${explorerId}:${workspaceDirectory}/${relativePath}`,
			title: relativePath.split("/").at(-1) ?? relativePath,
			iconKey: relativePath,
			metadata: {
				explorerId,
				workspaceDirectory,
				relativePath,
			},
		},
	];
}

function staticFlags(flags: Record<string, unknown>) {
	return {
		peek: () => flags,
		subscribe: (listener: (value: Record<string, unknown>) => void) => {
			listener(flags);
			return () => undefined;
		},
	};
}

function renderView(
	handlers: FilesServiceContract,
	props: Partial<FilesViewProps> = {},
	panel: Record<string, unknown> = {},
	width = 900,
	flags: Record<string, unknown> = {},
) {
	const track = vi.fn(async (_input: { event: string; data: Record<string, unknown> }) => {});
	const sdk = createFakeSdk({
		featureId: "files",
		channels: filesContract,
		handlers,
		telemetry: { track },
		featureFlags: staticFlags(flags),
	});
	const system = createFakeFeatureSystem({ sdks: { files: sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	system.getSdk("kilo-ui").plugins.expose("chatRightPanel", {
		getActiveTabId: vi.fn(() => props.instanceId ?? PROPS.instanceId),
		updateTab: vi.fn(),
		registerTabLifecycle: vi.fn(() => vi.fn()),
		openContributedTab: vi.fn(),
		...panel,
	});
	const renderTree = (nextProps: Partial<FilesViewProps>) => (
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<div className="flex" style={{ height: 600, width }}>
					<FilesView key={nextProps.instanceId ?? PROPS.instanceId} {...PROPS} {...nextProps} />
				</div>
			</QueryClientProvider>
		</SdkProvider>
	);
	const result = render(renderTree(props));
	return {
		...result,
		system,
		queryClient,
		track,
		rerenderView(nextProps: Partial<FilesViewProps>) {
			result.rerender(renderTree(nextProps));
		},
	};
}

// The app mounts explorer and file panes as separate FilesView instances under
// a single root QueryClient, so a save in one pane must invalidate the git
// status query observed by the other. This harness mirrors that topology.
function renderExplorerAndFilePane(
	handlers: FilesServiceContract,
	filePaneProps: Partial<FilesViewProps>,
	explorerProps: Partial<FilesViewProps> = {},
) {
	const sdk = createFakeSdk({ featureId: "files", channels: filesContract, handlers });
	const system = createFakeFeatureSystem({ sdks: { files: sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	system.getSdk("kilo-ui").plugins.expose("chatRightPanel", {
		getActiveTabId: vi.fn(() => filePaneProps.instanceId ?? PROPS.instanceId),
		updateTab: vi.fn(),
		registerTabLifecycle: vi.fn(() => vi.fn()),
		openContributedTab: vi.fn(),
	});
	const renderTree = (nextFilePaneProps: Partial<FilesViewProps>) => (
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<div className="flex" style={{ height: 600, width: 900 }}>
					<FilesView {...PROPS} instanceId="files-explorer" title="Files" {...explorerProps} />
					<FilesView
						key={nextFilePaneProps.instanceId ?? PROPS.instanceId}
						{...PROPS}
						{...nextFilePaneProps}
					/>
				</div>
			</QueryClientProvider>
		</SdkProvider>
	);
	const result = render(renderTree(filePaneProps));
	return {
		...result,
		system,
		queryClient,
		rerenderFilePane(nextProps: Partial<FilesViewProps>) {
			result.rerender(renderTree(nextProps));
		},
	};
}

const handlers = (): FilesServiceContract => ({
	list: async () => ({
		paths: ["docs/", "docs/readme.md", "src/", "src/index.ts"],
		truncated: false,
	}),
	existingPaths: async ({ relativePaths }) => ({ paths: relativePaths }),
	resolveFileLink: async () => ({ kind: "none", paths: [], truncated: false }),
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
	gitStatus: async () => null,
});

function treeHost(): Element | null {
	return document.querySelector('[data-qa-id="files-tree"]');
}

function treeItem(relativePath: string): HTMLElement | null {
	return (
		treeHost()?.shadowRoot?.querySelector<HTMLElement>(`[data-item-path="${relativePath}"]`) ?? null
	);
}

function ancestorDirectoryPaths(relativePath: string): string[] {
	if (relativePath.endsWith("/")) return [];
	const parts = relativePath.split("/");
	return parts.slice(0, -1).map((_, index) => `${parts.slice(0, index + 1).join("/")}/`);
}

async function expandTreePath(relativePath: string): Promise<HTMLElement> {
	await vi.waitFor(() => expect(treeItem(relativePath)).not.toBeNull());
	const item = treeItem(relativePath);
	if (!item) throw new Error(`Files tree path was not mounted: ${relativePath}`);
	if (item.getAttribute("aria-expanded") === "false") item.click();
	await vi.waitFor(() =>
		expect(treeItem(relativePath)?.getAttribute("aria-expanded")).not.toBe("false"),
	);
	return item;
}

async function openTreePath(relativePath: string): Promise<void> {
	for (const directoryPath of ancestorDirectoryPaths(relativePath)) {
		await expandTreePath(directoryPath);
	}
	await vi.waitFor(() => expect(treeItem(relativePath)).not.toBeNull());
	treeItem(relativePath)?.click();
}

function diffsContentEditable(): HTMLElement | null {
	return (
		Array.from(document.querySelectorAll("diffs-container"))
			.map((host) =>
				host.shadowRoot?.querySelector<HTMLElement>('[data-content][contenteditable="true"]'),
			)
			.find((candidate) => candidate != null) ?? null
	);
}

function diffsEditorText(): string {
	return Array.from(document.querySelectorAll("diffs-container"))
		.map((host) => host.shadowRoot?.querySelector<HTMLElement>("[data-content]")?.textContent ?? "")
		.join("\n");
}

function diffsEditorHasFocus(): boolean {
	return Array.from(document.querySelectorAll("diffs-container")).some((host) =>
		Boolean(host.shadowRoot?.activeElement?.matches('[data-content][contenteditable="true"]')),
	);
}

async function replaceEditorText(contents: string): Promise<void> {
	let editor: HTMLElement | null = null;
	await vi.waitFor(() => {
		editor = diffsContentEditable();
		expect(editor).not.toBeNull();
	});
	if (!editor) throw new Error("Diffs editor was not mounted");
	const locator = page.elementLocator(editor);
	await locator.click();
	await userEvent.keyboard("{Control>}a{/Control}");
	await userEvent.keyboard(contents);
}

const WATCHER_DEBOUNCE_PASSED_MS = 700;

/**
 * Fake only setTimeout/clearTimeout, before the view mounts, so the watcher
 * debounce (including useDebounce's guarded mount-time fire) arms on the fake
 * clock — a real timer armed before faking stays invisible to the fake clock
 * and can fire a stale refresh after the assertions. The trees and editor
 * still render on the real requestAnimationFrame.
 */
function fakeWatcherClock(): void {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

/**
 * Emits one watcher batch under the fake clock. `act` flushes the watcher's
 * counter bump so the debounce re-arm lands inside the same step — otherwise
 * the re-render waits on a real macrotask that `advanceTimersByTimeAsync`
 * never yields to, and the debounce would not fire under the fake clock.
 */
async function emitWatcherBatch(
	view: ReturnType<typeof renderView>,
	root: string,
	changes: WorkspaceFileChangeEvent["changes"],
): Promise<void> {
	await act(async () => {
		view.system.services.featureRouter.eventBus.emit(WORKSPACE_FILE_CHANGE_EVENT, {
			root,
			changes,
		} satisfies WorkspaceFileChangeEvent);
	});
}

/** Past the 300 ms watcher debounce on the fake clock, for no-refresh assertions. */
async function advancePastWatcherDebounce(): Promise<void> {
	await vi.advanceTimersByTimeAsync(WATCHER_DEBOUNCE_PASSED_MS);
}

afterEach(() => {
	// Restore real timers before cleanup: the fake clearTimeout does not
	// cancel native timer ids, so a pending debounce must be cleared while the
	// real clearTimeout is in place.
	vi.useRealTimers();
	cleanup();
	localStorage.clear();
	// Boolean focus notifications (configureDesktopFocusManager) make the
	// focusManager's _focused state persist across tests. Reset to the
	// visibilityState fallback so focus-dispatch tests always start unfocused.
	focusManager.setFocused(undefined);
});

describe("FilesView", () => {
	it("shows an explicit state when the chat has no workspace", async () => {
		renderView(handlers(), { workspaceDirectory: undefined });
		await expect.element(page.getByTestId("files-no-workspace")).toBeVisible();
	});

	it("titles the explorer pane with the workspace folder name", async () => {
		const updateTab = vi.fn();
		renderView(handlers(), {}, { updateTab });

		await vi.waitFor(() =>
			expect(updateTab).toHaveBeenCalledWith(
				"session-1",
				"files-1",
				expect.objectContaining({
					title: "workspace",
					metadata: expect.objectContaining({ workspaceDirectory: "/workspace" }),
				}),
			),
		);
	});

	it("keeps the Files title when the chat has no workspace", async () => {
		const updateTab = vi.fn();
		renderView(handlers(), { workspaceDirectory: undefined }, { updateTab });

		await vi.waitFor(() =>
			expect(updateTab).toHaveBeenCalledWith("session-1", "files-1", { title: "Files" }),
		);
	});

	it("uses the full workspace path when two folders share a name", async () => {
		const updateTab = vi.fn();
		renderView(
			handlers(),
			{
				workspaceDirectory: "/projects/alpha/src",
				workspaceFolders: [
					{ path: "/projects/alpha/src", isPrimary: true },
					{ path: "/projects/beta/src", isPrimary: false },
				],
			},
			{ updateTab },
		);

		await vi.waitFor(() =>
			expect(updateTab).toHaveBeenCalledWith(
				"session-1",
				"files-1",
				expect.objectContaining({ title: "/projects/alpha/src" }),
			),
		);
	});

	it("uses the full content width for the workspace tree before a file is opened", async () => {
		const { queryByText } = renderView(handlers(), {}, {}, 580);

		await expect.element(page.getByTestId("files-tree")).toBeVisible();
		const explorer = document.querySelector<HTMLElement>(".files-explorer-pane");
		expect(document.querySelector('[data-qa-id="files-viewer-pane"]')).toBeNull();
		expect(document.querySelector('[data-qa-id="files-explorer-resize-handle"]')).toBeNull();
		expect(explorer).not.toBeNull();
		expect(explorer!.getBoundingClientRect().width).toBeCloseTo(
			explorer!.parentElement!.getBoundingClientRect().width,
			0,
		);
		expect(queryByText("Open file")).toBeNull();
		expect(queryByText("Select a file from the file list")).toBeNull();
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
		const openContributedTab = vi.fn();
		const updateTab = vi.fn();
		renderView(
			{ ...service, list, read },
			{
				workspaceFolders: [
					{ path: "/workspace", isPrimary: true },
					{ path: "/reference", isPrimary: false },
				],
			},
			{ openContributedTab, updateTab },
		);

		const folderSelector = page.getByRole("combobox", { name: "Workspace folder" });
		await expect.element(folderSelector).toBeVisible();
		await vi.waitFor(() => expect(list).toHaveBeenCalledWith({ workspaceDirectory: "/workspace" }));

		await folderSelector.click();
		await page.getByRole("option", { name: "reference" }).click();

		await vi.waitFor(() => expect(list).toHaveBeenCalledWith({ workspaceDirectory: "/reference" }));
		await vi.waitFor(() =>
			expect(updateTab).toHaveBeenCalledWith(
				"session-1",
				"files-1",
				expect.objectContaining({
					title: "reference",
					metadata: expect.objectContaining({ workspaceDirectory: "/reference" }),
				}),
			),
		);
		await openTreePath("guides/reference.md");
		await vi.waitFor(() =>
			expect(openContributedTab).toHaveBeenCalledWith(
				...openedFileCall("guides/reference.md", "/reference"),
			),
		);
		expect(read).not.toHaveBeenCalled();
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
		// The highlighted viewer renders asynchronously and can take well over
		// the default second when every package's browser tests run at once.
		const renderTimeout = { timeout: 5_000 };
		await expect
			.element(page.getByTestId("files-breadcrumb"), renderTimeout)
			.toHaveTextContent("src/index.ts");
		await vi.waitFor(() => {
			const selectedLines = Array.from(document.querySelectorAll("diffs-container")).flatMap(
				(host) =>
					Array.from(host.shadowRoot?.querySelectorAll<HTMLElement>("[data-selected-line]") ?? []),
			);
			expect(selectedLines.some((line) => line.dataset.line === "2")).toBe(true);
		}, renderTimeout);
	});

	it("reads a requested file before loading and caching its workspace list", async () => {
		let finishRead!: (result: Awaited<ReturnType<FilesServiceContract["read"]>>) => void;
		const read = vi.fn<FilesServiceContract["read"]>(
			() =>
				new Promise((resolve) => {
					finishRead = resolve;
				}),
		);
		const service = handlers();
		const list = vi.fn(service.list);
		const listExternalEditors = vi.fn(service.listExternalEditors);
		const view = renderView(
			{ ...service, list, listExternalEditors, read },
			{
				metadata: {
					workspaceDirectory: "/workspace",
					relativePath: "docs/readme.md",
				},
			},
		);

		await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
		expect(list).not.toHaveBeenCalled();
		expect(document.querySelector('[data-qa-id="files-breadcrumb"]')?.textContent).toContain(
			"readme.md",
		);
		expect(document.querySelector('[data-qa-id="files-markdown-toggle"]')).not.toBeNull();
		expect(document.querySelector('[data-qa-id="files-tree"]')).toBeNull();
		finishRead({
			kind: "text",
			contents: "export const value = 1;",
			byteLength: 23,
			truncated: false,
			revision: "a".repeat(64),
		});
		await vi.waitFor(() => expect(listExternalEditors).toHaveBeenCalledOnce());
		expect(list).not.toHaveBeenCalled();

		view.rerenderView({
			instanceId: "files-2",
			title: "Files 2",
			metadata: {
				workspaceDirectory: "/workspace",
				relativePath: "src/index.ts",
			},
		});
		await vi.waitFor(() => {
			expect(
				document.querySelector('[data-qa-id="files-open-external-editor"]'),
			).not.toHaveAttribute("disabled");
		});
		expect(document.querySelector('[data-qa-id="files-tree"]')).toBeNull();
		expect(list).not.toHaveBeenCalled();
		expect(listExternalEditors).toHaveBeenCalledOnce();
	});

	it("scrolls to and places the caret at a requested source location", async () => {
		const lines = Array.from({ length: 200 }, () => "0123456789");
		const write = vi.fn<FilesServiceContract["write"]>(async () => ({
			status: "saved",
			revision: "b".repeat(64),
		}));
		renderView(
			{
				...handlers(),
				read: async () => ({
					kind: "text",
					contents: lines.join("\n"),
					byteLength: lines.join("\n").length,
					truncated: false,
					revision: "a".repeat(64),
				}),
				write,
			},
			{
				metadata: {
					workspaceDirectory: "/workspace",
					relativePath: "src/index.ts",
					line: "150",
					column: "6",
				},
			},
		);

		let editorScroll: HTMLElement | null = null;
		await vi.waitFor(() => {
			editorScroll = document.querySelector<HTMLElement>(".files-editor-scroll");
			expect(editorScroll).not.toBeNull();
		});
		await vi.waitFor(() => expect(editorScroll!.scrollTop).toBeGreaterThan(0));
		await vi.waitFor(() => {
			const selectedLines = Array.from(document.querySelectorAll("diffs-container")).flatMap(
				(host) =>
					Array.from(host.shadowRoot?.querySelectorAll<HTMLElement>("[data-selected-line]") ?? []),
			);
			expect(selectedLines.some((line) => line.dataset.line === "150")).toBe(true);
		});
		await vi.waitFor(() => expect(diffsEditorHasFocus()).toBe(true));
		await userEvent.keyboard("X");
		await expect.element(page.getByTestId("files-save")).toBeVisible();
		await page.getByTestId("files-save").click();

		await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
		const savedContents = write.mock.calls[0]?.[0].contents;
		expect(savedContents?.split("\n")[149]).toBe("01234X56789");
	});

	it("saves an open document back to the workspace it was read from", async () => {
		const write = vi.fn<FilesServiceContract["write"]>(async () => ({
			status: "saved",
			revision: "b".repeat(64),
		}));
		const view = renderView(
			{ ...handlers(), write },
			{
				workspaceDirectory: "/workspace",
				workspaceFolders: [{ path: "/workspace", isPrimary: true }],
				metadata: { workspaceDirectory: "/workspace", relativePath: "src/index.ts" },
			},
		);
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("src/index.ts");
		view.rerenderView({
			workspaceDirectory: "/reference",
			workspaceFolders: [{ path: "/reference", isPrimary: true }],
			metadata: { workspaceDirectory: "/workspace", relativePath: "src/index.ts" },
		});
		await replaceEditorText("changed after workspace switch");

		await page.getByTestId("files-save").click();

		await vi.waitFor(() =>
			expect(write).toHaveBeenCalledWith(
				expect.objectContaining({
					workspaceDirectory: "/workspace",
					contents: expect.stringContaining("changed after workspace switch"),
				}),
			),
		);
	});

	it("ignores persisted file metadata from outside the current workspace", async () => {
		const service = handlers();
		const list = vi.fn(service.list);
		const read = vi.fn(service.read);
		renderView(
			{ ...service, list, read },
			{
				workspaceDirectory: "/reference",
				workspaceFolders: [{ path: "/reference", isPrimary: true }],
				metadata: { workspaceDirectory: "/workspace", relativePath: "src/index.ts" },
			},
		);

		expect(read).not.toHaveBeenCalled();
		expect(list).not.toHaveBeenCalled();
		expect(document.querySelector('[data-qa-id="files-tree"]')).toBeNull();
		expect(document.querySelector('[data-qa-id="files-breadcrumb"]')).toBeNull();
	});

	it("does not show a folder selector for a single-folder workspace", async () => {
		renderView(handlers(), {
			workspaceFolders: [{ path: "/workspace", isPrimary: true }],
		});

		await expect
			.element(page.getByRole("combobox", { name: "Workspace folder" }))
			.not.toBeInTheDocument();
	});

	it("opens the explorer with folders collapsed", async () => {
		renderView(handlers());
		await expect.element(page.getByTestId("files-tree")).toBeVisible();
		await vi.waitFor(() => expect(treeItem("docs/")).not.toBeNull());

		expect(treeItem("docs/")?.getAttribute("aria-expanded")).toBe("false");
		expect(treeItem("src/")?.getAttribute("aria-expanded")).toBe("false");
		expect(treeItem("docs/readme.md")).toBeNull();
		expect(treeItem("src/index.ts")).toBeNull();
	});

	it("opens a selected explorer file as a distinct file pane", async () => {
		const openContributedTab = vi.fn();
		const { track } = renderView(handlers(), {}, { openContributedTab });
		await expect.element(page.getByTestId("files-tree")).toBeVisible();
		await openTreePath("docs/readme.md");

		expect(document.querySelector('[data-qa-id="files-breadcrumb"]')).toBeNull();
		await vi.waitFor(() =>
			expect(openContributedTab).toHaveBeenCalledWith(...openedFileCall("docs/readme.md")),
		);
		await vi.waitFor(() =>
			expect(track).toHaveBeenCalledExactlyOnceWith({
				event: "File Opened",
				data: { featureId: "files", source: "tree" },
			}),
		);
	});

	it("reopens the file pane when the already-selected explorer file is clicked again", async () => {
		const openContributedTab = vi.fn();
		renderView(handlers(), {}, { openContributedTab });
		await expect.element(page.getByTestId("files-tree")).toBeVisible();
		await openTreePath("docs/readme.md");
		await vi.waitFor(() => expect(openContributedTab).toHaveBeenCalledOnce());

		treeItem("docs/readme.md")?.click();

		await vi.waitFor(() => expect(openContributedTab).toHaveBeenCalledTimes(2));
		expect(openContributedTab).toHaveBeenLastCalledWith(...openedFileCall("docs/readme.md"));
	});

	it("opens an explorer file once when its row is double-clicked", async () => {
		const openContributedTab = vi.fn();
		renderView(handlers(), {}, { openContributedTab });
		await expect.element(page.getByTestId("files-tree")).toBeVisible();
		await expandTreePath("docs/");
		await vi.waitFor(() => expect(treeItem("docs/readme.md")).not.toBeNull());

		await page.elementLocator(treeItem("docs/readme.md")!).dblClick();

		await vi.waitFor(() => expect(openContributedTab).toHaveBeenCalled());
		expect(openContributedTab).toHaveBeenCalledOnce();
	});

	it("shows git status decorations on tree rows", async () => {
		renderView({
			...handlers(),
			gitStatus: async () => ({
				entries: [
					{ path: "docs/readme.md", status: "added" },
					{ path: "src/index.ts", status: "modified" },
				],
			}),
		});
		await expandTreePath("docs/");
		await expandTreePath("src/");
		await vi.waitFor(() => {
			expect(
				treeHost()?.shadowRoot?.querySelector(
					'[data-item-path="src/index.ts"][data-item-git-status="modified"]',
				),
			).not.toBeNull();
		});
		const host = treeHost();
		expect(
			host?.shadowRoot?.querySelector(
				'[data-item-path="docs/readme.md"][data-item-git-status="added"]',
			),
		).not.toBeNull();
		expect(
			host?.shadowRoot?.querySelector(
				'[data-item-path="src/"][data-item-contains-git-change="true"]',
			),
		).not.toBeNull();
		expect(
			host?.shadowRoot?.querySelector(
				'[data-item-path="docs/"][data-item-contains-git-change="true"]',
			),
		).not.toBeNull();
	});

	it("renders no git status attributes when the workspace has no git status", async () => {
		renderView(handlers());
		await expandTreePath("docs/");
		await vi.waitFor(() => {
			expect(
				treeHost()?.shadowRoot?.querySelector('[data-item-path="docs/readme.md"]'),
			).not.toBeNull();
		});
		const host = treeHost();
		expect(host?.shadowRoot?.querySelector("[data-item-git-status]")).toBeNull();
		expect(host?.shadowRoot?.querySelector("[data-item-contains-git-change]")).toBeNull();
	});

	it("refetches git status when the refresh button is clicked", async () => {
		let externallyChanged = false;
		const gitStatus = vi.fn<FilesServiceContract["gitStatus"]>(async () =>
			externallyChanged ? { entries: [{ path: "docs/readme.md", status: "untracked" }] } : null,
		);
		renderView({ ...handlers(), gitStatus });
		await expandTreePath("docs/");
		await vi.waitFor(() => {
			expect(
				treeHost()?.shadowRoot?.querySelector('[data-item-path="docs/readme.md"]'),
			).not.toBeNull();
		});
		expect(
			treeHost()?.shadowRoot?.querySelector(
				'[data-item-path="docs/readme.md"][data-item-git-status]',
			),
		).toBeNull();

		externallyChanged = true;
		await page.getByTestId("files-refresh").click();

		await vi.waitFor(() => {
			expect(
				treeHost()?.shadowRoot?.querySelector(
					'[data-item-path="docs/readme.md"][data-item-git-status="untracked"]',
				),
			).not.toBeNull();
		});
	});

	it("refreshes explorer git status decorations after a file pane saves", async () => {
		let saved = false;
		const write = vi.fn<FilesServiceContract["write"]>(async () => {
			saved = true;
			return { status: "saved", revision: "b".repeat(64) };
		});
		const gitStatus = vi.fn<FilesServiceContract["gitStatus"]>(async () =>
			saved ? { entries: [{ path: "src/index.ts", status: "modified" }] } : null,
		);
		renderExplorerAndFilePane({ ...handlers(), write, gitStatus }, filePane("src/index.ts"));
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("src/index.ts");
		await expandTreePath("src/");
		await vi.waitFor(() => {
			expect(
				treeHost()?.shadowRoot?.querySelector('[data-item-path="src/index.ts"]'),
			).not.toBeNull();
		});
		expect(
			treeHost()?.shadowRoot?.querySelector(
				'[data-item-path="src/index.ts"][data-item-git-status]',
			),
		).toBeNull();

		await replaceEditorText("changed to make the document dirty");
		await page.getByTestId("files-save").click();

		await vi.waitFor(() => {
			expect(
				treeHost()?.shadowRoot?.querySelector(
					'[data-item-path="src/index.ts"][data-item-git-status="modified"]',
				),
			).not.toBeNull();
		});
	});

	it("refreshes the explorer's git status after saving a document whose folder was removed", async () => {
		let saved = false;
		const write = vi.fn<FilesServiceContract["write"]>(async () => {
			saved = true;
			return { status: "saved", revision: "b".repeat(64) };
		});
		const list = vi.fn<FilesServiceContract["list"]>(async ({ workspaceDirectory }) => ({
			paths: workspaceDirectory === "/other" ? ["src/", "src/index.ts"] : ["readme.md"],
			truncated: false,
		}));
		const gitStatus = vi.fn<FilesServiceContract["gitStatus"]>(async ({ workspaceDirectory }) =>
			saved && workspaceDirectory === "/workspace"
				? { entries: [{ path: "readme.md", status: "added" }] }
				: null,
		);
		const view = renderExplorerAndFilePane(
			{ ...handlers(), list, write, gitStatus },
			{
				workspaceFolders: [
					{ path: "/workspace", isPrimary: true },
					{ path: "/other", isPrimary: false },
				],
				metadata: { workspaceDirectory: "/other", relativePath: "src/index.ts" },
			},
		);
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("src/index.ts");
		await replaceEditorText("changed to make the document dirty");

		view.rerenderFilePane({
			workspaceFolders: [{ path: "/workspace", isPrimary: true }],
			metadata: { workspaceDirectory: "/other", relativePath: "src/index.ts" },
		});
		await vi.waitFor(() => {
			expect(treeHost()?.shadowRoot?.querySelector('[data-item-path="readme.md"]')).not.toBeNull();
		});
		expect(
			treeHost()?.shadowRoot?.querySelector('[data-item-path="readme.md"][data-item-git-status]'),
		).toBeNull();

		await page.getByTestId("files-save").click();

		await vi.waitFor(() => {
			expect(
				treeHost()?.shadowRoot?.querySelector(
					'[data-item-path="readme.md"][data-item-git-status="added"]',
				),
			).not.toBeNull();
		});
	});

	it("refreshes git decorations from a watcher batch without re-listing the workspace", async () => {
		let externallyChanged = false;
		const list = vi.fn<FilesServiceContract["list"]>(async () => ({
			paths: ["docs/", "docs/readme.md", "src/", "src/index.ts"],
			truncated: false,
		}));
		const gitStatus = vi.fn<FilesServiceContract["gitStatus"]>(async () =>
			externallyChanged ? { entries: [{ path: "docs/readme.md", status: "untracked" }] } : null,
		);
		const view = renderView({ ...handlers(), list, gitStatus });
		await expandTreePath("docs/");
		await vi.waitFor(() => {
			expect(
				treeHost()?.shadowRoot?.querySelector('[data-item-path="docs/readme.md"]'),
			).not.toBeNull();
		});
		expect(
			treeHost()?.shadowRoot?.querySelector(
				'[data-item-path="docs/readme.md"][data-item-git-status]',
			),
		).toBeNull();

		externallyChanged = true;
		view.system.services.featureRouter.eventBus.emit(WORKSPACE_FILE_CHANGE_EVENT, {
			root: "/workspace",
			changes: [{ path: "/workspace/docs/readme.md", type: "update" }],
		} satisfies WorkspaceFileChangeEvent);

		await vi.waitFor(() => {
			expect(
				treeHost()?.shadowRoot?.querySelector(
					'[data-item-path="docs/readme.md"][data-item-git-status="untracked"]',
				),
			).not.toBeNull();
		});
		expect(list).toHaveBeenCalledTimes(1);
	});

	it("adds a watcher-created file to the tree without any refresh action", async () => {
		let created = false;
		const list = vi.fn<FilesServiceContract["list"]>(async () => ({
			paths: created
				? ["created-file.txt", "docs/", "docs/readme.md", "src/", "src/index.ts"]
				: ["docs/", "docs/readme.md", "src/", "src/index.ts"],
			truncated: false,
		}));
		const view = renderView({ ...handlers(), list });
		await vi.waitFor(() => expect(treeItem("docs/")).not.toBeNull());

		created = true;
		view.system.services.featureRouter.eventBus.emit(WORKSPACE_FILE_CHANGE_EVENT, {
			root: "/workspace",
			changes: [{ path: "/workspace/created-file.txt", type: "create" }],
		} satisfies WorkspaceFileChangeEvent);

		await vi.waitFor(() => expect(treeItem("created-file.txt")).not.toBeNull());
	});

	// Same flow with platform-native Windows paths: the workspace folder and
	// event paths are backslash-joined, and the tree must still refresh.
	it("adds a watcher-created file to the tree (Windows paths)", async () => {
		let created = false;
		const list = vi.fn<FilesServiceContract["list"]>(async () => ({
			paths: created
				? ["created-file.txt", "docs/", "docs/readme.md", "src/", "src/index.ts"]
				: ["docs/", "docs/readme.md", "src/", "src/index.ts"],
			truncated: false,
		}));
		const view = renderView({ ...handlers(), list }, { workspaceDirectory: "C:\\workspace" });
		await vi.waitFor(() => expect(treeItem("docs/")).not.toBeNull());

		created = true;
		view.system.services.featureRouter.eventBus.emit(WORKSPACE_FILE_CHANGE_EVENT, {
			root: "C:\\workspace",
			changes: [{ path: "C:\\workspace\\created-file.txt", type: "create" }],
		} satisfies WorkspaceFileChangeEvent);

		await vi.waitFor(() => expect(treeItem("created-file.txt")).not.toBeNull());
	});

	it("removes a watcher-deleted file and refetches the list for a never-listed delete", async () => {
		let deleted = false;
		const list = vi.fn<FilesServiceContract["list"]>(async () => ({
			paths: deleted
				? ["docs/", "docs/readme.md", "src/", "src/index.ts"]
				: ["docs/", "docs/readme.md", "src/", "src/index.ts", "temp-file.txt"],
			truncated: false,
		}));
		const view = renderView({ ...handlers(), list });
		await vi.waitFor(() => expect(treeItem("temp-file.txt")).not.toBeNull());

		deleted = true;
		view.system.services.featureRouter.eventBus.emit(WORKSPACE_FILE_CHANGE_EVENT, {
			root: "/workspace",
			changes: [{ path: "/workspace/temp-file.txt", type: "delete" }],
		} satisfies WorkspaceFileChangeEvent);
		await vi.waitFor(() => expect(treeItem("temp-file.txt")).toBeNull());

		const listCalls = list.mock.calls.length;
		view.system.services.featureRouter.eventBus.emit(WORKSPACE_FILE_CHANGE_EVENT, {
			root: "/workspace",
			changes: [{ path: "/workspace/generated/never-listed.ts", type: "delete" }],
		} satisfies WorkspaceFileChangeEvent);
		await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(listCalls + 1));
	});

	it("ignores watcher batches for other workspace roots", async () => {
		const list = vi.fn<FilesServiceContract["list"]>(async () => ({
			paths: ["docs/", "docs/readme.md", "src/", "src/index.ts"],
			truncated: false,
		}));
		const gitStatus = vi.fn<FilesServiceContract["gitStatus"]>(async () => null);
		fakeWatcherClock();
		const view = renderView({ ...handlers(), list, gitStatus });
		await vi.waitFor(() => expect(treeItem("docs/")).not.toBeNull());
		const listCalls = list.mock.calls.length;
		const gitStatusCalls = gitStatus.mock.calls.length;

		await emitWatcherBatch(view, "/other-workspace", [
			{ path: "/other-workspace/new-file.txt", type: "create" },
		]);
		await advancePastWatcherDebounce();
		expect(list).toHaveBeenCalledTimes(listCalls);
		expect(gitStatus).toHaveBeenCalledTimes(gitStatusCalls);
	});

	it("preserves expansion across a watcher refresh, including flattened chains", async () => {
		let created = false;
		const list = vi.fn<FilesServiceContract["list"]>(async () => ({
			paths: created
				? [
						"created-file.txt",
						"docs/",
						"docs/readme.md",
						"packages/core/",
						"packages/core/index.ts",
						"src/",
						"src/index.ts",
					]
				: [
						"docs/",
						"docs/readme.md",
						"packages/core/",
						"packages/core/index.ts",
						"src/",
						"src/index.ts",
					],
			truncated: false,
		}));
		const view = renderView({ ...handlers(), list });
		await expandTreePath("docs/");
		await expandTreePath("packages/core/");
		await vi.waitFor(() => expect(treeItem("packages/core/index.ts")).not.toBeNull());
		expect(treeItem("docs/readme.md")).not.toBeNull();

		created = true;
		view.system.services.featureRouter.eventBus.emit(WORKSPACE_FILE_CHANGE_EVENT, {
			root: "/workspace",
			changes: [{ path: "/workspace/created-file.txt", type: "create" }],
		} satisfies WorkspaceFileChangeEvent);

		await vi.waitFor(() => expect(treeItem("created-file.txt")).not.toBeNull());
		expect(treeItem("docs/")?.getAttribute("aria-expanded")).not.toBe("false");
		expect(treeItem("docs/readme.md")).not.toBeNull();
		expect(treeItem("packages/core/")?.getAttribute("aria-expanded")).not.toBe("false");
		expect(treeItem("packages/core/index.ts")).not.toBeNull();
	});

	it("updates the editor content when the open file changes on disk", async () => {
		let externalChange = false;
		const read = vi.fn<FilesServiceContract["read"]>(async () => ({
			kind: "text",
			contents: externalChange ? "const version = 2;" : "const version = 1;",
			byteLength: 18,
			truncated: false,
			revision: externalChange ? "b".repeat(64) : "a".repeat(64),
		}));
		const view = renderView({ ...handlers(), read }, filePane("src/index.ts"));
		await vi.waitFor(() => expect(diffsContentEditable()?.textContent).toContain("version = 1"));

		externalChange = true;
		view.system.services.featureRouter.eventBus.emit(WORKSPACE_FILE_CHANGE_EVENT, {
			root: "/workspace",
			changes: [{ path: "/workspace/src/index.ts", type: "update" }],
		} satisfies WorkspaceFileChangeEvent);

		await vi.waitFor(() => expect(diffsContentEditable()?.textContent).toContain("version = 2"));
	});

	// The watcher emits platform-native paths; on Windows the workspace folder
	// and event paths are backslash-joined. The open document must still reload.
	it("updates the editor content when the open file changes on disk (Windows paths)", async () => {
		let externalChange = false;
		const read = vi.fn<FilesServiceContract["read"]>(async () => ({
			kind: "text",
			contents: externalChange ? "const version = 2;" : "const version = 1;",
			byteLength: 18,
			truncated: false,
			revision: externalChange ? "b".repeat(64) : "a".repeat(64),
		}));
		const view = renderView(
			{ ...handlers(), read },
			filePane("src/index.ts", { workspaceDirectory: "C:\\workspace" }),
		);
		await vi.waitFor(() => expect(diffsContentEditable()?.textContent).toContain("version = 1"));

		externalChange = true;
		view.system.services.featureRouter.eventBus.emit(WORKSPACE_FILE_CHANGE_EVENT, {
			root: "C:\\workspace",
			changes: [{ path: "C:\\workspace\\src\\index.ts", type: "update" }],
		} satisfies WorkspaceFileChangeEvent);

		await vi.waitFor(() => expect(diffsContentEditable()?.textContent).toContain("version = 2"));
	});

	it("does not reload a dirty open file when it changes on disk", async () => {
		const read = vi.fn<FilesServiceContract["read"]>(async () => ({
			kind: "text",
			contents: "const version = 1;",
			byteLength: 18,
			truncated: false,
			revision: "a".repeat(64),
		}));
		fakeWatcherClock();
		const view = renderView({ ...handlers(), read }, filePane("src/index.ts"));
		await replaceEditorText("const version = 2; // local edit");
		expect(read).toHaveBeenCalledOnce();

		await emitWatcherBatch(view, "/workspace", [
			{ path: "/workspace/src/index.ts", type: "update" },
		]);
		await advancePastWatcherDebounce();

		expect(read).toHaveBeenCalledOnce();
	});

	it("does not issue a watcher-triggered read while a new file open is in flight", async () => {
		type ReadResult = Awaited<ReturnType<FilesServiceContract["read"]>>;
		let resolveSecondRead!: (result: ReadResult) => void;
		const secondReadDeferred = new Promise<ReadResult>((resolve) => {
			resolveSecondRead = resolve;
		});
		let readCallCount = 0;
		const read = vi.fn<FilesServiceContract["read"]>(({ relativePath }) => {
			readCallCount++;
			if (readCallCount === 1) {
				// First read (file A) resolves immediately.
				return Promise.resolve({
					kind: "text",
					contents: "const a = 1;",
					byteLength: 12,
					truncated: false,
					revision: "a".repeat(64),
				});
			}
			// Second read (file B open) is deferred to simulate an in-flight open.
			void relativePath; // referenced for clarity
			return secondReadDeferred;
		});
		fakeWatcherClock();
		const view = renderView({ ...handlers(), read }, filePane("src/index.ts"));
		// Wait for file A to fully load.
		await vi.waitFor(() => expect(diffsEditorText()).toContain("const a = 1;"));
		expect(read).toHaveBeenCalledOnce();

		// Emit a watcher update for file A — arms the 300 ms debounce.
		await emitWatcherBatch(view, "/workspace", [
			{ path: "/workspace/src/index.ts", type: "update" },
		]);

		// Immediately click file B — its read is now in-flight (loading: true).
		view.rerenderView(filePane("docs/readme.md"));

		// Wait past the 300 ms debounce window; the watcher must not issue a third read.
		await advancePastWatcherDebounce();
		expect(read).toHaveBeenCalledTimes(2);

		// Resolve file B's deferred read and verify its content renders.
		resolveSecondRead({
			kind: "text",
			contents: "# Read me",
			byteLength: 9,
			truncated: false,
			revision: "b".repeat(64),
		});
		await vi.waitFor(() => expect(diffsEditorText()).toContain("# Read me"));
		expect(read).toHaveBeenCalledTimes(2);
	});

	it("does not clobber editor state when the file content is unchanged", async () => {
		const read = vi.fn<FilesServiceContract["read"]>(async () => ({
			kind: "text",
			contents: "const version = 1;",
			byteLength: 18,
			truncated: false,
			revision: "a".repeat(64),
		}));
		const view = renderView({ ...handlers(), read }, filePane("src/index.ts"));
		await vi.waitFor(() => expect(diffsContentEditable()?.textContent).toContain("version = 1"));

		view.system.services.featureRouter.eventBus.emit(WORKSPACE_FILE_CHANGE_EVENT, {
			root: "/workspace",
			changes: [{ path: "/workspace/src/index.ts", type: "update" }],
		} satisfies WorkspaceFileChangeEvent);

		await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
		await expect.poll(() => diffsContentEditable()?.textContent ?? "").toContain("version = 1");
		expect(diffsContentEditable()?.textContent).not.toContain("version = 2");
	});

	it("ignores watcher batches for other files and other roots", async () => {
		const read = vi.fn<FilesServiceContract["read"]>(async () => ({
			kind: "text",
			contents: "const version = 1;",
			byteLength: 18,
			truncated: false,
			revision: "a".repeat(64),
		}));
		fakeWatcherClock();
		const view = renderView({ ...handlers(), read }, filePane("src/index.ts"));
		await vi.waitFor(() => expect(diffsContentEditable()?.textContent).toContain("version = 1"));
		expect(read).toHaveBeenCalledOnce();

		await emitWatcherBatch(view, "/workspace", [
			{ path: "/workspace/src/other.ts", type: "update" },
		]);
		await emitWatcherBatch(view, "/other-workspace", [
			{ path: "/other-workspace/src/index.ts", type: "update" },
		]);
		await advancePastWatcherDebounce();

		expect(read).toHaveBeenCalledOnce();
	});

	it("refetches both workspace queries when the window regains focus", async () => {
		let externallyChanged = false;
		const list = vi.fn<FilesServiceContract["list"]>(async () => ({
			paths: externallyChanged
				? ["created-file.txt", "docs/", "docs/readme.md", "src/", "src/index.ts"]
				: ["docs/", "docs/readme.md", "src/", "src/index.ts"],
			truncated: false,
		}));
		const gitStatus = vi.fn<FilesServiceContract["gitStatus"]>(async () =>
			externallyChanged ? { entries: [{ path: "docs/readme.md", status: "untracked" }] } : null,
		);
		renderView({ ...handlers(), list, gitStatus });
		await expandTreePath("docs/");
		expect(
			treeHost()?.shadowRoot?.querySelector(
				'[data-item-path="docs/readme.md"][data-item-git-status]',
			),
		).toBeNull();

		externallyChanged = true;
		window.dispatchEvent(new Event("focus"));

		await vi.waitFor(() => expect(treeItem("created-file.txt")).not.toBeNull());
		await vi.waitFor(() => {
			expect(
				treeHost()?.shadowRoot?.querySelector(
					'[data-item-path="docs/readme.md"][data-item-git-status="untracked"]',
				),
			).not.toBeNull();
		});
	});

	it("offers to open ipynb files in the notebook panel without reading their raw contents", async () => {
		const service = handlers();
		const read = vi.fn(service.read);
		const openNotebookFile = vi.fn(async () => ({
			sessionId: "session-1",
			notebook_id: "notebook-1",
			title: "analysis.ipynb",
			path: "/workspace/notebooks/analysis.ipynb",
		}));
		const view = renderView({
			...service,
			list: async () => ({
				paths: ["notebooks/", "notebooks/analysis.ipynb"],
				truncated: false,
			}),
			read,
		});
		view.system.getSdk("notebook").plugins.expose("notebookViewer", {
			openFile: openNotebookFile,
		});

		await openTreePath("notebooks/analysis.ipynb");

		expect(document.querySelector('[data-qa-id="files-notebook-empty"]')).toBeNull();
		expect(read).not.toHaveBeenCalled();
		await vi.waitFor(() =>
			expect(openNotebookFile).toHaveBeenCalledWith({
				sessionId: "session-1",
				path: "/workspace/notebooks/analysis.ipynb",
			}),
		);
		await vi.waitFor(() =>
			expect(view.track).toHaveBeenCalledExactlyOnceWith({
				event: "Notebook Opened",
				data: { featureId: "files", source: "tree" },
			}),
		);
	});

	it("does not track a notebook opened from the tree when opening fails", async () => {
		const openNotebookFile = vi.fn(async () => ({ error: "kernel unavailable" }));
		const view = renderView({
			...handlers(),
			list: async () => ({
				paths: ["notebooks/", "notebooks/analysis.ipynb"],
				truncated: false,
			}),
		});
		view.system.getSdk("notebook").plugins.expose("notebookViewer", {
			openFile: openNotebookFile,
		});

		await openTreePath("notebooks/analysis.ipynb");
		await vi.waitFor(() => expect(openNotebookFile).toHaveBeenCalledOnce());
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(view.track).not.toHaveBeenCalled();
	});

	it("offers to open an ipynb file pane in the notebook panel without reading raw contents", async () => {
		const service = handlers();
		const read = vi.fn(service.read);
		const openNotebookFile = vi.fn(async () => ({
			sessionId: "session-1",
			notebook_id: "notebook-1",
			title: "analysis.ipynb",
			path: "/workspace/notebooks/analysis.ipynb",
		}));
		const view = renderView({ ...service, read }, filePane("notebooks/analysis.ipynb"));
		view.system.getSdk("notebook").plugins.expose("notebookViewer", {
			openFile: openNotebookFile,
		});

		await expect.element(page.getByTestId("files-notebook-empty")).toBeVisible();
		await expect.element(page.getByRole("heading", { name: "Open as a notebook" })).toBeVisible();
		expect(read).not.toHaveBeenCalled();
		expect(document.querySelector("diffs-container")).toBeNull();

		await page.getByTestId("files-open-notebook").click();
		await vi.waitFor(() =>
			expect(openNotebookFile).toHaveBeenCalledWith({
				sessionId: "session-1",
				path: "/workspace/notebooks/analysis.ipynb",
			}),
		);
		await vi.waitFor(() =>
			expect(view.track).toHaveBeenCalledWith({
				event: "Notebook Opened",
				data: { featureId: "files", source: "files-button" },
			}),
		);
	});

	it("opens the latest file request when a reused tab receives new metadata", async () => {
		const view = renderView(handlers(), filePane("src/index.ts", { instanceId: "files-1" }));
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("src/index.ts");
		await vi.waitFor(() => expect(diffsEditorText()).toContain("export const value = 1;"));

		view.rerenderView(filePane("docs/readme.md", { instanceId: "files-1" }));
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("docs/readme.md");
		await vi.waitFor(() => expect(diffsEditorText()).toContain("# Read me"));
		view.rerenderView(
			filePane("src/index.ts", {
				instanceId: "files-1",
				metadata: {
					workspaceDirectory: "/workspace",
					relativePath: "src/index.ts",
					line: "42",
				},
			}),
		);

		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("src/index.ts");
	});

	it("keeps simultaneous editor panes independent when they show the same file", async () => {
		renderExplorerAndFilePane(
			handlers(),
			filePane("src/index.ts", { instanceId: "files-1" }),
			filePane("src/index.ts", { instanceId: "files-2" }),
		);

		await vi.waitFor(() => expect(document.querySelectorAll("diffs-container")).toHaveLength(2));
	});

	it("opens the selected file in an available external editor and remembers the choice", async () => {
		const openExternalEditor = vi.fn<FilesServiceContract["openExternalEditor"]>(async () => ({
			opened: true,
		}));
		renderView({ ...handlers(), openExternalEditor }, filePane("src/index.ts"));

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
		renderView({ ...handlers(), openExternalEditor }, filePane("src/index.ts"));

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

	it("shows a labeled primary Save action before the external editor controls for dirty files", async () => {
		renderView(handlers(), filePane("src/index.ts"));
		await replaceEditorText("export const value = 2;");
		await expect.element(page.getByTestId("files-save")).toBeVisible();

		const editorControls = document.querySelector('[aria-label="Open in external editor"]');
		const saveButton = document.querySelector('[data-qa-id="files-save"]');

		expect(editorControls?.previousElementSibling).toBe(saveButton);
		expect(saveButton).toHaveTextContent("Save");
		expect(saveButton).toHaveClass("bg-primary", "text-primary-foreground");
		expect(editorControls?.getBoundingClientRect().height).toBe(
			saveButton?.getBoundingClientRect().height,
		);
	});

	it("hides the Save action for a clean file", async () => {
		renderView(handlers(), filePane("src/index.ts"));
		await expect.element(page.getByRole("textbox", { name: "src/index.ts" })).toBeVisible();

		expect(document.querySelector('[data-qa-id="files-save"]')).toBeNull();
	});

	it("shows tooltips for the file toolbar controls", async () => {
		renderView(handlers(), filePane("docs/readme.md"));
		await expect.element(page.getByTestId("files-markdown-toggle")).toBeVisible();

		for (const [testId, label] of [
			["files-open-external-editor", "Open file in Cursor"],
			["files-markdown-toggle", "Show rendered Markdown"],
		] as const) {
			await page.getByTestId(testId).hover();
			await expect
				.poll(() => document.querySelector('[data-slot="tooltip-content"]')?.textContent)
				.toBe(label);
		}
	});

	it("shows an inline error when an external editor cannot be opened", async () => {
		renderView(
			{
				...handlers(),
				openExternalEditor: async () => {
					throw new Error("VS Code could not be launched");
				},
			},
			filePane("src/index.ts"),
		);

		await page.getByTestId("files-external-editor-menu").click();
		await page.getByRole("menuitem", { name: "VS Code" }).click();

		await expect
			.element(page.getByTestId("files-external-editor-error"))
			.toHaveTextContent("VS Code could not be launched");
	});

	it("uses the file-operation fallback for a non-Error launch rejection", async () => {
		renderView(
			{
				...handlers(),
				openExternalEditor: async () => Promise.reject("launch failed"),
			},
			filePane("src/index.ts"),
		);

		await page.getByTestId("files-open-external-editor").click();

		await expect
			.element(page.getByTestId("files-external-editor-error"))
			.toHaveTextContent("The file operation failed.");
	});

	it("uses the stored available editor without adding a menu label", async () => {
		localStorage.setItem("files.preferredExternalEditor", "vscode");
		renderView(handlers(), filePane("src/index.ts"));
		await expect
			.element(page.getByTestId("files-open-external-editor"))
			.toHaveAttribute("aria-label", "Open file in VS Code");
	});

	it("explains when no external editors are installed", async () => {
		renderView(
			{
				...handlers(),
				listExternalEditors: async () => ({ editors: [] }),
			},
			filePane("src/index.ts"),
		);
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

	it("edits with Diffs, publishes dirty state, and saves manually", async () => {
		const updateTab = vi.fn();
		const write = vi.fn(async () => ({ status: "saved" as const, revision: "b".repeat(64) }));
		renderView({ ...handlers(), write }, filePane("src/index.ts"), { updateTab });
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

	it("keeps edits made while a save is in flight dirty", async () => {
		type SaveResult = {
			status: "saved";
			revision: string;
		};
		let resolveFirstSave: (result: SaveResult) => void = () => undefined;
		const firstSave = new Promise<SaveResult>((resolve) => {
			resolveFirstSave = resolve;
		});
		const write = vi
			.fn<FilesServiceContract["write"]>()
			.mockImplementationOnce(async () => firstSave)
			.mockResolvedValue({ status: "saved", revision: "c".repeat(64) });
		renderView({ ...handlers(), write }, filePane("src/index.ts"));
		await replaceEditorText("first saved change");

		await page.getByTestId("files-save").click();
		await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
		await replaceEditorText("edit made during save");
		resolveFirstSave({ status: "saved", revision: "b".repeat(64) });

		await expect.element(page.getByTestId("files-save")).toBeEnabled();
		await page.getByTestId("files-save").click();
		await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
		expect(write).toHaveBeenLastCalledWith(
			expect.objectContaining({ contents: expect.stringContaining("edit made during save") }),
		);
	});

	it("ignores a save completion after navigating to another file", async () => {
		type SaveResult = {
			status: "saved";
			revision: string;
		};
		let resolveSave: (result: SaveResult) => void = () => undefined;
		const pendingSave = new Promise<SaveResult>((resolve) => {
			resolveSave = resolve;
		});
		const write = vi.fn<FilesServiceContract["write"]>(async () => pendingSave);
		const view = renderView({ ...handlers(), write }, filePane("src/index.ts"));
		await replaceEditorText("saved source change");

		await page.getByTestId("files-save").click();
		await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
		requestFile(view, "docs/readme.md");
		await page.getByTestId("files-unsaved-discard").click();
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("docs/readme.md");

		resolveSave({ status: "saved", revision: "b".repeat(64) });
		await vi.waitFor(() => expect(document.querySelector('[data-qa-id="files-save"]')).toBeNull());
	});

	it("renders relative Markdown links as file chips that open a new pane", async () => {
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
		const openContributedTab = vi.fn();
		renderView(
			markdownHandlers,
			filePane("docs/readme.md", { metadata: { explorerId: "files-1" } }),
			{ openContributedTab },
		);
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
		await vi.waitFor(() =>
			expect(openContributedTab).toHaveBeenCalledWith(...openedFileCall("src/index.ts")),
		);
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("docs/readme.md");
	});

	it("renders Mermaid fences as diagrams in Markdown preview", async () => {
		const read: FilesServiceContract["read"] = async () => ({
			kind: "text",
			contents: "# Diagram\n\n```mermaid\nflowchart LR\n  Start --> Done\n```",
			byteLength: 58,
			truncated: false,
			revision: "a".repeat(64),
		});
		renderView({ ...handlers(), read }, filePane("docs/readme.md"));
		await page.getByTestId("files-markdown-toggle").click();

		await expect.element(page.getByTestId("files-markdown-preview")).toBeVisible();
		await expect
			.element(page.getByTestId("mermaid-diagram"), { timeout: 5_000 })
			.toHaveAttribute("aria-busy", "false");
		expect(document.querySelector('[data-qa-id="mermaid-diagram"] svg')).not.toBeNull();
		expect(
			document.querySelector('[data-qa-id="files-markdown-preview"]')?.textContent,
		).not.toContain("flowchart LR");
	});
	it.each(["diagram.mmd", "diagram.mermaid"])(
		"renders standalone %s files by default and toggles to source",
		async (relativePath) => {
			const read: FilesServiceContract["read"] = async () => ({
				kind: "text",
				contents: "flowchart TD\n  Input --> Output",
				byteLength: 30,
				truncated: false,
				revision: "a".repeat(64),
			});
			renderView({ ...handlers(), read }, filePane(relativePath));

			await vi.waitFor(
				() => expect(document.querySelector('[data-qa-id="mermaid-diagram"] svg')).not.toBeNull(),
				{ timeout: 5_000 },
			);
			await page.getByTestId("files-markdown-toggle").click();
			await expect.element(page.getByRole("textbox", { name: relativePath })).toBeVisible();
			expect(document.querySelector('[data-qa-id="mermaid-diagram"]')).toBeNull();
		},
	);

	it("opens a diagram file as source when targeting a line", async () => {
		const read: FilesServiceContract["read"] = async () => ({
			kind: "text",
			contents: "flowchart TD\n  Input --> Output",
			byteLength: 30,
			truncated: false,
			revision: "a".repeat(64),
		});
		renderView(
			{ ...handlers(), read },
			filePane("diagram.mmd", {
				metadata: { workspaceDirectory: "/workspace", relativePath: "diagram.mmd", line: "2" },
			}),
		);

		await expect.element(page.getByRole("textbox", { name: "diagram.mmd" })).toBeVisible();
		expect(document.querySelector('[data-qa-id="mermaid-diagram"]')).toBeNull();
	});

	it("shows an alert and the source when a diagram file cannot be rendered", async () => {
		const read: FilesServiceContract["read"] = async () => ({
			kind: "text",
			contents: "notADiagram\n  this is not Mermaid",
			byteLength: 32,
			truncated: false,
			revision: "a".repeat(64),
		});
		renderView({ ...handlers(), read }, filePane("broken.mmd"));

		const preview = page.getByTestId("files-mermaid-preview");
		const alert = preview.getByRole("alert");
		await expect.element(alert.getByText("Could not render this Mermaid diagram")).toBeVisible();
		await expect.element(preview.getByText(/this is not Mermaid/u)).toBeVisible();
	});

	describe("Markdown preview find", () => {
		const readme: FilesServiceContract["read"] = async () => ({
			kind: "text",
			contents: "# Read me\n\nInstall the deps, then install the app.",
			byteLength: 52,
			truncated: false,
			revision: "a".repeat(64),
		});

		async function openPreview(flags: Record<string, unknown>) {
			renderView({ ...handlers(), read: readme }, filePane("docs/readme.md"), {}, 900, flags);
			await page.getByTestId("files-markdown-toggle").click();
			await expect.element(page.getByTestId("files-markdown-preview")).toBeVisible();
		}

		function pressFindChord(): KeyboardEvent {
			const modifier = navigator.platform.startsWith("Mac") ? "metaKey" : "ctrlKey";
			const event = new KeyboardEvent("keydown", {
				key: "f",
				[modifier]: true,
				bubbles: true,
				cancelable: true,
			});
			window.dispatchEvent(event);
			return event;
		}

		it("finds text in the preview with the find chord", async () => {
			await openPreview({ [FIND_BAR_FEATURE_FLAG]: true });

			pressFindChord();
			await page.getByTestId("files-find-input").fill("install");

			await vi.waitFor(() =>
				expect(document.querySelector('[data-qa-id="files-find-count"]')?.textContent).toBe("1/2"),
			);
		});

		it("leaves the chord alone while the searchbar flag is off", async () => {
			await openPreview({});

			const event = pressFindChord();

			expect(event.defaultPrevented).toBe(false);
			expect(document.querySelector("[data-find-scope]")).toBeNull();
		});
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
		renderView({ ...handlers(), read }, filePane("docs/readme.md"));
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
		renderView({ ...handlers(), read }, filePane("docs/readme.md"));
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
		const view = renderView(previewHandlers, filePane("image.png"));
		await expect.element(page.getByTestId("files-image-preview")).toBeVisible();
		requestFile(view, "manual.pdf");
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
		await expect
			.element(page.getByTestId("files-list-error").getByText("scan failed"))
			.toBeVisible();

		cleanup();
		const truncatedHandlers: FilesServiceContract = {
			...handlers(),
			list: async () => ({ paths: ["large.txt", "archive.zip"], truncated: true }),
			read: async ({ relativePath }) =>
				relativePath === "large.txt"
					? { kind: "text", contents: "preview", byteLength: 2_000_000, truncated: true }
					: { kind: "unsupported", reason: "binary", byteLength: 42 },
		};
		renderView(truncatedHandlers);
		await expect.element(page.getByText("Showing the first 25,000 entries.")).toBeVisible();

		cleanup();
		renderView(truncatedHandlers, filePane("large.txt"));
		await expect.element(page.getByTestId("files-truncated")).toBeVisible();
		expect(document.querySelector('[data-qa-id="files-save"]')).toBeNull();

		cleanup();
		renderView(truncatedHandlers, filePane("archive.zip"));
		await expect
			.element(page.getByTestId("files-unsupported"))
			.toHaveTextContent("This binary file cannot be previewed.");
	});

	it("guards file switches while dirty with cancel and discard", async () => {
		const view = renderView(handlers(), filePane("src/index.ts"));
		await replaceEditorText("changed");
		requestFile(view, "docs/readme.md");
		await expect.element(page.getByTestId("files-unsaved-dialog")).toBeVisible();
		await page.getByTestId("files-unsaved-cancel").click();
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("src/index.ts");

		requestFile(view, "docs/readme.md");
		await expect.element(page.getByTestId("files-unsaved-dialog")).toBeVisible();
		await page.getByTestId("files-unsaved-discard").click();
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("docs/readme.md");
	});

	it("keeps the current file when the unsaved-changes dialog is dismissed with Escape", async () => {
		const view = renderView(handlers(), filePane("src/index.ts"));
		await replaceEditorText("changed");
		requestFile(view, "docs/readme.md");
		await expect.element(page.getByTestId("files-unsaved-dialog")).toBeVisible();
		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("src/index.ts");
	});

	it("saves from the keyboard and through the dirty-switch guard", async () => {
		const write = vi.fn(async () => ({ status: "saved" as const, revision: "b".repeat(64) }));
		const view = renderView({ ...handlers(), write }, filePane("src/index.ts"));
		await replaceEditorText("keyboard change");
		await expect.element(page.getByTestId("files-save")).toBeEnabled();
		await userEvent.keyboard("{Control>}s{/Control}");
		await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));

		await replaceEditorText("guarded change");
		requestFile(view, "docs/readme.md");
		await page.getByTestId("files-unsaved-save").click();
		await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("docs/readme.md");
	});

	it("ignores the save shortcut while another chat pane is active", async () => {
		const write = vi.fn(async () => ({ status: "saved" as const, revision: "b".repeat(64) }));
		renderView({ ...handlers(), write }, filePane("src/index.ts"), {
			getActiveTabId: () => "another-tab",
		});
		await replaceEditorText("background change");

		await userEvent.keyboard("{Control>}s{/Control}");

		expect(write).not.toHaveBeenCalled();
	});

	it("continues a guarded file switch after overwriting a conflict", async () => {
		const write = vi
			.fn<FilesServiceContract["write"]>()
			.mockResolvedValueOnce({ status: "conflict", diskRevision: "c".repeat(64) })
			.mockResolvedValueOnce({ status: "saved", revision: "d".repeat(64) });
		const view = renderView({ ...handlers(), write }, filePane("src/index.ts"));
		await replaceEditorText("changed");
		requestFile(view, "docs/readme.md");
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
		renderView({ ...handlers(), write }, filePane("src/index.ts"));
		await replaceEditorText("changed");
		fireEvent.click(document.querySelector('[data-qa-id="files-save"]')!);
		await expect.element(page.getByTestId("files-conflict-dialog")).toBeVisible();
		fireEvent.click(document.querySelector('[data-qa-id="files-conflict-overwrite"]')!);
		await vi.waitFor(() =>
			expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ force: true })),
		);
	});

	it("typing while a watcher-triggered refresh read is in flight keeps the edit", async () => {
		type ReadResult = Awaited<ReturnType<FilesServiceContract["read"]>>;
		let resolveSecondRead!: (result: ReadResult) => void;
		const secondReadDeferred = new Promise<ReadResult>((resolve) => {
			resolveSecondRead = resolve;
		});
		let readCallCount = 0;
		const read = vi.fn<FilesServiceContract["read"]>(() => {
			readCallCount++;
			if (readCallCount === 1) {
				return Promise.resolve({
					kind: "text",
					contents: "const a = 1;",
					byteLength: 12,
					truncated: false,
					revision: "a".repeat(64),
				});
			}
			// Second read (watcher refresh) is deferred so we can type mid-flight.
			return secondReadDeferred;
		});
		const view = renderView({ ...handlers(), read }, filePane("src/index.ts"));
		await vi.waitFor(() => expect(diffsContentEditable()?.textContent).toContain("a = 1"));
		expect(read).toHaveBeenCalledOnce();

		// Emit a watcher event — arms the 300 ms debounce.
		view.system.services.featureRouter.eventBus.emit(WORKSPACE_FILE_CHANGE_EVENT, {
			root: "/workspace",
			changes: [{ path: "/workspace/src/index.ts", type: "update" }],
		} satisfies WorkspaceFileChangeEvent);

		// Wait for the refresh read to start (debounce fires).
		await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));

		// Type while the refresh read is in-flight — creates dirty state.
		await replaceEditorText("const a = 2; // typed during refresh");

		// Resolve the refresh read with different content and a new revision.
		resolveSecondRead({
			kind: "text",
			contents: "const a = 99;",
			byteLength: 13,
			truncated: false,
			revision: "b".repeat(64),
		});

		// Flush the dispatch that the resolved refresh read queues.
		await act(async () => {});

		// The editor must still show the typed text and be dirty.
		expect(diffsEditorText()).toContain("const a = 2; // typed during refresh");
		await expect.element(page.getByTestId("files-save")).toBeEnabled();
	});

	it("a save started while a watcher refresh read is in flight completes without conflict", async () => {
		type ReadResult = Awaited<ReturnType<FilesServiceContract["read"]>>;
		type WriteResult = Awaited<ReturnType<FilesServiceContract["write"]>>;
		let resolveRefreshRead!: (result: ReadResult) => void;
		const refreshReadDeferred = new Promise<ReadResult>((resolve) => {
			resolveRefreshRead = resolve;
		});
		let readCallCount = 0;
		const read = vi.fn<FilesServiceContract["read"]>(() => {
			readCallCount++;
			if (readCallCount === 1) {
				return Promise.resolve({
					kind: "text",
					contents: "const a = 1;",
					byteLength: 12,
					truncated: false,
					revision: "a".repeat(64),
				});
			}
			// Second read is the refresh — defer it so we can race a save.
			return refreshReadDeferred;
		});
		let resolveWrite!: (result: WriteResult) => void;
		const writeDeferred = new Promise<WriteResult>((resolve) => {
			resolveWrite = resolve;
		});
		const write = vi.fn<FilesServiceContract["write"]>(async () => writeDeferred);

		const view = renderView({ ...handlers(), read, write }, filePane("src/index.ts"));
		await vi.waitFor(() => expect(diffsContentEditable()?.textContent).toContain("a = 1"));

		// Emit a watcher event while the file is clean — refresh read starts.
		view.system.services.featureRouter.eventBus.emit(WORKSPACE_FILE_CHANGE_EVENT, {
			root: "/workspace",
			changes: [{ path: "/workspace/src/index.ts", type: "update" }],
		} satisfies WorkspaceFileChangeEvent);

		// Wait for the refresh debounce+read to start.
		await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));

		// Make an edit (dirties the file) then save, while refresh read is still in-flight.
		await replaceEditorText("const a = 2;");
		await expect.element(page.getByTestId("files-save")).toBeEnabled();
		fireEvent.click(document.querySelector('[data-qa-id="files-save"]')!);
		await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());

		// Resolve the refresh read — must not dispatch refresh-succeeded (saving is in flight).
		resolveRefreshRead({
			kind: "text",
			contents: "const a = 99; // from disk",
			byteLength: 25,
			truncated: false,
			revision: "b".repeat(64),
		});

		// Resolve the write successfully.
		resolveWrite({ status: "saved", revision: "c".repeat(64) });

		// Save must complete: dirty clears, no conflict dialog, not stuck saving.
		await vi.waitFor(() => expect(document.querySelector('[data-qa-id="files-save"]')).toBeNull());
		expect(document.querySelector('[data-qa-id="files-conflict-dialog"]')).toBeNull();
	});

	it("gitStatus refetches on explorer remount within staleTime without a window focus event", async () => {
		// Use a shared QueryClient with pre-populated cache (simulates fresh data
		// still within staleTime). On remount, refetchOnMount: "always" must bypass
		// the staleTime and refetch.
		const gitStatus = vi.fn<FilesServiceContract["gitStatus"]>(async () => null);
		const sdk = createFakeSdk({
			featureId: "files",
			channels: filesContract,
			handlers: { ...handlers(), gitStatus },
		});
		const system = createFakeFeatureSystem({ sdks: { files: sdk } });
		const sharedQueryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		system.getSdk("kilo-ui").plugins.expose("chatRightPanel", {
			getActiveTabId: vi.fn(() => PROPS.instanceId),
			updateTab: vi.fn(),
			registerTabLifecycle: vi.fn(() => vi.fn()),
			openContributedTab: vi.fn(),
		});

		// Pre-populate the cache with fresh data (so staleTime has not elapsed).
		const { filesGitStatusQueryKey } = await import("./explorer/file-tree-watcher.js");
		sharedQueryClient.setQueryData(filesGitStatusQueryKey("files", "/workspace"), null);

		function renderExplorer() {
			return render(
				<SdkProvider system={system}>
					<QueryClientProvider client={sharedQueryClient}>
						<div className="flex" style={{ height: 600, width: 900 }}>
							<FilesView {...PROPS} />
						</div>
					</QueryClientProvider>
				</SdkProvider>,
			);
		}

		// Mount the explorer — refetchOnMount: "always" must fetch even though the
		// cache already has fresh data within staleTime.
		renderExplorer();
		await vi.waitFor(() => expect(gitStatus).toHaveBeenCalledOnce());
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
		renderView({ ...handlers(), read, write }, filePane("src/index.ts"));
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

	it("keeps a diagram file in source mode when reloading after a conflict", async () => {
		const read = vi.fn<FilesServiceContract["read"]>(async () => ({
			kind: "text",
			contents: "flowchart TD\n  Input --> Output",
			byteLength: 30,
			truncated: false,
			revision: "a".repeat(64),
		}));
		const write = vi.fn<FilesServiceContract["write"]>(async () => ({
			status: "conflict",
			diskRevision: "c".repeat(64),
		}));
		renderView({ ...handlers(), read, write }, filePane("diagram.mmd"));
		await expect.element(page.getByTestId("files-mermaid-preview")).toBeVisible();
		await page.getByTestId("files-markdown-toggle").click();
		await replaceEditorText("flowchart TD\n  Input --> Changed");
		fireEvent.click(document.querySelector('[data-qa-id="files-save"]')!);
		await expect.element(page.getByTestId("files-conflict-dialog")).toBeVisible();

		await page.getByTestId("files-conflict-reload").click();
		await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));

		await expect.element(page.getByRole("textbox", { name: "diagram.mmd" })).toBeVisible();
		expect(document.querySelector('[data-qa-id="files-mermaid-preview"]')).toBeNull();
	});
});
