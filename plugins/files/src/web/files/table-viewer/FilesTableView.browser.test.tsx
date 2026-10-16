import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
	WORKSPACE_FILE_CHANGE_EVENT,
	type WorkspaceFileChangeEvent,
} from "@kilo-desktop/feature-sdk";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import {
	filesContract,
	type FileReadResult,
	type FilesServiceContract,
} from "../../../contracts/schemas.js";
import { FilesView } from "../FilesView.js";
import {
	configureSiftRuntime,
	type SiftLoadState,
	type SiftTableSource,
	type SiftTableViewProps,
} from "./sift-runtime.js";

/*
 * These tests cover the Files side of the Sift seam: which source reaches the
 * table, when, and how it interacts with editing, reloads and stale results.
 * The runtime below is a seam-level probe, not a table implementation; real
 * Sift rendering is covered by SiftAdapter.browser.test.tsx.
 */
const mounted: SiftTableSource[] = [];
let reportOnMount: SiftLoadState = "complete";

function sourceText(source: SiftTableSource): string {
	return source.kind === "csv" ? source.text : Array.from(source.bytes).join(",");
}

// Mirrors Sift's contract: a source that fails to parse reports an error.
function ProbeTableView({ source, onLoadStateChange, onError }: SiftTableViewProps) {
	useEffect(() => {
		mounted.push(source);
		if (source.kind === "csv" && source.text.includes("BROKEN")) onError("Malformed CSV at row 2.");
		else onLoadStateChange(reportOnMount);
	}, [onError, onLoadStateChange, source]);
	return (
		<div
			data-delimiter={source.kind === "csv" ? source.delimiter : source.format}
			data-qa-id="sift-probe"
		>
			{sourceText(source)}
		</div>
	);
}

const REVISION_A = "a".repeat(64);
const REVISION_B = "b".repeat(64);

function csv(contents: string, extra: Partial<Extract<FileReadResult, { kind: "text" }>> = {}) {
	return {
		kind: "text" as const,
		contents,
		byteLength: contents.length,
		truncated: false,
		revision: REVISION_A,
		...extra,
	};
}

function baseHandlers(read: FilesServiceContract["read"]): FilesServiceContract {
	return {
		list: async () => ({ paths: [], truncated: false }),
		existingPaths: async ({ relativePaths }) => ({ paths: relativePaths }),
		read,
		listExternalEditors: async () => ({ editors: [] }),
		openExternalEditor: async () => ({ opened: true }),
		write: async () => ({ status: "saved", revision: REVISION_B }),
		gitStatus: async () => null,
	};
}

interface FileRequest {
	readonly line?: number;
	readonly workspaceDirectory?: string;
}

const WORKSPACE_FOLDERS = [
	{ path: "/workspace", isPrimary: true },
	{ path: "/other", isPrimary: false },
];

function renderFile(handlers: FilesServiceContract, relativePath: string, line?: number) {
	const sdk = createFakeSdk({ featureId: "files", channels: filesContract, handlers });
	const system = createFakeFeatureSystem({ sdks: { files: sdk } });
	system.getSdk("kilo-ui").plugins.expose("chatRightPanel", {
		getActiveTabId: vi.fn(() => "files-1"),
		updateTab: vi.fn(),
		registerTabLifecycle: vi.fn(() => vi.fn()),
		openContributedTab: vi.fn(),
	});
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const tree = (path: string, request: FileRequest) => (
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<div className="flex" style={{ height: 600, width: 900 }}>
					<FilesView
						instanceId="files-1"
						metadata={{
							workspaceDirectory: request.workspaceDirectory ?? "/workspace",
							relativePath: path,
							...(request.line !== undefined ? { line: String(request.line) } : {}),
						}}
						sessionId="session-1"
						title={path}
						workspaceDirectory="/workspace"
						workspaceFolders={WORKSPACE_FOLDERS}
					/>
				</div>
			</QueryClientProvider>
		</SdkProvider>
	);
	const result = render(tree(relativePath, line !== undefined ? { line } : {}));
	return {
		system,
		open: (path: string, request: FileRequest = {}) => result.rerender(tree(path, request)),
	};
}

function editorText(): string {
	return Array.from(document.querySelectorAll("diffs-container"))
		.map((host) => host.shadowRoot?.querySelector("[data-content]")?.textContent ?? "")
		.join("\n");
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
	await page.elementLocator(editor!).click();
	await userEvent.keyboard("{Control>}a{/Control}");
	await userEvent.keyboard(contents);
}

beforeEach(() => {
	mounted.length = 0;
	reportOnMount = "complete";
	configureSiftRuntime(async () => ({ TableView: ProbeTableView }));
});

afterEach(() => {
	cleanup();
	configureSiftRuntime(null);
	localStorage.clear();
});

describe("FilesView table viewer", () => {
	it("opens CSV in the table view by default with the file's delimiter", async () => {
		renderFile(
			baseHandlers(async () => csv("name,score\nÅsa,1\n")),
			"data/scores.csv",
		);

		const probe = page.getByTestId("sift-probe");
		await expect.element(probe).toHaveTextContent("name,score Åsa,1");
		await expect.element(probe).toHaveAttribute("data-delimiter", ",");
		await expect
			.element(page.getByRole("region", { name: "Table view of scores.csv" }))
			.toHaveAttribute("aria-busy", "false");
		expect(document.querySelector(".files-editor-scroll")).toBeNull();
	});

	it("presses the toggle while the table is shown, like the Markdown preview toggle", async () => {
		renderFile(
			baseHandlers(async () => csv("a,b\n1,2\n")),
			"data.csv",
		);
		const toggle = page.getByTestId("files-table-toggle");

		await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
		await expect.element(toggle).toHaveAccessibleName("Edit source");

		await toggle.click();
		await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
		await expect.element(toggle).toHaveAccessibleName("Show as table");
	});

	it("passes the tab delimiter for TSV", async () => {
		renderFile(
			baseHandlers(async () => csv("a\tb\n1\t2\n")),
			"export.tsv",
		);
		await expect.element(page.getByTestId("sift-probe")).toHaveAttribute("data-delimiter", "\t");
	});

	it("keeps unsaved source edits across Table/Edit toggles and saves the live draft", async () => {
		const write = vi.fn<FilesServiceContract["write"]>(async () => ({
			status: "saved",
			revision: REVISION_B,
		}));
		renderFile({ ...baseHandlers(async () => csv("a,b\n1,2\n")), write }, "data.csv");
		await expect.element(page.getByTestId("sift-probe")).toBeVisible();

		await page.getByRole("button", { name: "Edit source" }).click();
		await replaceEditorText("a,b\n9,9\n");
		await expect.element(page.getByTestId("files-save")).toBeVisible();

		await page.getByRole("button", { name: "Show as table" }).click();
		await expect.element(page.getByTestId("sift-probe")).toMatchTextContent(/9,9/u);
		await expect.element(page.getByTestId("files-save")).toBeVisible();
		const draftShownInTable = mounted.at(-1);
		if (draftShownInTable?.kind !== "csv") throw new Error("Expected a CSV source");

		await page.getByRole("button", { name: "Edit source" }).click();
		await vi.waitFor(() =>
			expect(document.querySelector(".files-editor-scroll")?.textContent ?? "").not.toBe(""),
		);
		await page.getByRole("button", { name: "Show as table" }).click();
		await page.getByTestId("files-save").click();

		await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
		expect(write.mock.calls[0]?.[0]).toMatchObject({
			contents: draftShownInTable.text,
			expectedRevision: REVISION_A,
		});
	});

	it("does not reload a dirty CSV from disk while it is shown as a table", async () => {
		const read = vi.fn<FilesServiceContract["read"]>(async () => csv("a\n1\n"));
		const view = renderFile(baseHandlers(read), "data.csv");
		await page.getByRole("button", { name: "Edit source" }).click();
		await replaceEditorText("a\nlocal\n");
		await page.getByRole("button", { name: "Show as table" }).click();

		read.mockResolvedValue(csv("a\nremote\n", { revision: REVISION_B }));
		await act(async () => {
			view.system.services.featureRouter.eventBus.emit(WORKSPACE_FILE_CHANGE_EVENT, {
				root: "/workspace",
				changes: [{ path: "/workspace/data.csv", type: "update" }],
			} satisfies WorkspaceFileChangeEvent);
		});
		await new Promise((resolve) => setTimeout(resolve, 700));

		await expect.element(page.getByTestId("sift-probe")).toMatchTextContent(/local/u);
		expect(document.querySelector('[data-qa-id="sift-probe"]')?.textContent).not.toMatch(/remote/u);
		expect(read).toHaveBeenCalledOnce();
	});

	it("opens CSV in the editor when the tab targets a source line", async () => {
		renderFile(
			baseHandlers(async () => csv("a\n1\n2\n")),
			"data.csv",
			2,
		);
		await vi.waitFor(() => expect(document.querySelector(".files-editor-scroll")).not.toBeNull());
		await expect.element(page.getByRole("button", { name: "Show as table" })).toBeVisible();
		expect(mounted).toHaveLength(0);
	});

	it("switches a CSV shown as a table to the editor when the same file is opened at a line", async () => {
		const view = renderFile(
			baseHandlers(async () => csv("a\n1\n2\n3\n")),
			"data.csv",
		);
		await page.getByRole("button", { name: "Edit source" }).click();
		await page.getByRole("button", { name: "Show as table" }).click();
		await expect.element(page.getByTestId("sift-probe")).toBeVisible();

		view.open("data.csv", { line: 3 });

		await vi.waitFor(() => expect(document.querySelector(".files-editor-scroll")).not.toBeNull());
		expect(document.querySelector('[data-qa-id="sift-probe"]')).toBeNull();
		await expect.element(page.getByRole("button", { name: "Show as table" })).toBeVisible();
		await vi.waitFor(() => {
			const selected = Array.from(document.querySelectorAll("diffs-container")).flatMap((host) =>
				Array.from(host.shadowRoot?.querySelectorAll<HTMLElement>("[data-selected-line]") ?? []),
			);
			expect(selected.some((element) => element.dataset.line === "3")).toBe(true);
		});
	});

	it("does not carry a Table/Edit choice to the same relative path in another workspace folder", async () => {
		const view = renderFile(
			baseHandlers(async () => csv("a\n1\n")),
			"data.csv",
		);
		await page.getByRole("button", { name: "Edit source" }).click();
		await vi.waitFor(() => expect(document.querySelector(".files-editor-scroll")).not.toBeNull());

		view.open("data.csv", { workspaceDirectory: "/other" });

		await expect.element(page.getByTestId("sift-probe")).toBeVisible();
		expect(document.querySelector(".files-editor-scroll")).toBeNull();
	});

	it("refuses a truncated CSV whose cut falls inside a quoted multi-line record", async () => {
		// The 1 MiB text read ends inside a quoted field; trimming to the last
		// newline would still hand Sift a corrupt record, so nothing is parsed.
		renderFile(
			baseHandlers(async () =>
				csv('id,note\n1,"first line\nsecond line"\n2,"crosses the\ncap', {
					truncated: true,
					byteLength: 5_000_000,
					revision: undefined,
				}),
			),
			"big.csv",
		);

		const alert = page.getByRole("alert");
		await expect.element(alert).toMatchTextContent(/File too large for table view/u);
		await expect.element(alert).toMatchTextContent(/1 MiB limit/u);
		expect(mounted).toHaveLength(0);

		await page.getByRole("button", { name: "Show text preview" }).click();
		await vi.waitFor(() => expect(document.querySelector(".files-editor-scroll")).not.toBeNull());
		await expect.element(page.getByTestId("files-truncated")).toBeVisible();
		expect(document.querySelector('[data-qa-id="files-save"]')).toBeNull();
		expect(mounted).toHaveLength(0);
	});

	it("keeps the draft when it fails to parse as a table, and saves it from the editor", async () => {
		const write = vi.fn<FilesServiceContract["write"]>(async () => ({
			status: "saved",
			revision: REVISION_B,
		}));
		renderFile({ ...baseHandlers(async () => csv("a,b\n1,2\n")), write }, "data.csv");
		await page.getByRole("button", { name: "Edit source" }).click();
		await replaceEditorText("BROKEN");
		await page.getByRole("button", { name: "Show as table" }).click();

		await expect.element(page.getByRole("alert")).toMatchTextContent(/Malformed CSV at row 2\./u);
		await expect.element(page.getByTestId("files-save")).toBeVisible();
		await page.getByRole("button", { name: "Show source" }).click();
		await vi.waitFor(() => expect(editorText()).toMatch(/BROKEN/u));
		await page.getByTestId("files-save").click();
		await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
		expect(write.mock.calls[0]?.[0].contents).toMatch(/BROKEN/u);
	});

	it("saves the dirty draft with the keyboard shortcut while in Table mode", async () => {
		const write = vi.fn<FilesServiceContract["write"]>(async () => ({
			status: "saved",
			revision: REVISION_B,
		}));
		renderFile({ ...baseHandlers(async () => csv("a\n1\n")), write }, "data.csv");
		await page.getByRole("button", { name: "Edit source" }).click();
		await replaceEditorText("edited");
		await page.getByRole("button", { name: "Show as table" }).click();
		await expect.element(page.getByTestId("sift-probe")).toMatchTextContent(/edited/u);
		const shown = mounted.at(-1);
		if (shown?.kind !== "csv") throw new Error("Expected a CSV source");

		await userEvent.keyboard("{Control>}s{/Control}");

		await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
		expect(write.mock.calls[0]?.[0]).toMatchObject({
			contents: shown.text,
			expectedRevision: REVISION_A,
		});
	});

	it("shows Parquet bytes read-only, without an edit toggle", async () => {
		const read = vi.fn<FilesServiceContract["read"]>(async () => ({
			kind: "table",
			format: "parquet",
			base64: btoa("PAR1xPAR1"),
			byteLength: 9,
			revision: REVISION_A,
		}));
		renderFile(baseHandlers(read), "warehouse/part-0.parquet");

		const probe = page.getByTestId("sift-probe");
		await expect.element(probe).toHaveAttribute("data-delimiter", "parquet");
		await expect
			.element(probe)
			.toHaveTextContent(Array.from(new TextEncoder().encode("PAR1xPAR1")).join(","));
		expect(document.querySelector('[data-qa-id="files-table-toggle"]')).toBeNull();
		expect(document.querySelector('[data-qa-id="files-save"]')).toBeNull();
	});

	it("marks the table busy until the whole Parquet file has loaded, with no preview notice", async () => {
		reportOnMount = "loading";
		renderFile(
			baseHandlers(async () => ({
				kind: "table",
				format: "parquet",
				base64: btoa("PAR1PAR1"),
				byteLength: 8,
				revision: REVISION_A,
			})),
			"part.parquet",
		);
		await expect.element(page.getByTestId("sift-probe")).toBeVisible();
		await expect
			.element(page.getByRole("region", { name: "Table view of part.parquet" }))
			.toHaveAttribute("aria-busy", "true");
		await expect.element(page.getByRole("status")).toMatchTextContent(/Loading table/u);
	});

	it("reloads a Parquet table when the file changes on disk", async () => {
		let version = 1;
		const read = vi.fn<FilesServiceContract["read"]>(async () => ({
			kind: "table",
			format: "parquet",
			base64: btoa(`PAR1${String(version)}PAR1`),
			byteLength: 9,
			revision: version === 1 ? REVISION_A : REVISION_B,
		}));
		const view = renderFile(baseHandlers(read), "data.parquet");
		await expect.element(page.getByTestId("sift-probe")).toBeVisible();

		version = 2;
		await act(async () => {
			view.system.services.featureRouter.eventBus.emit(WORKSPACE_FILE_CHANGE_EVENT, {
				root: "/workspace",
				changes: [{ path: "/workspace/data.parquet", type: "update" }],
			} satisfies WorkspaceFileChangeEvent);
		});

		const expected = Array.from(new TextEncoder().encode("PAR12PAR1")).join(",");
		await expect.element(page.getByTestId("sift-probe")).toHaveTextContent(expected);
	});

	it("keeps the mounted table when a watcher event leaves the Parquet revision unchanged", async () => {
		const read = vi.fn<FilesServiceContract["read"]>(async () => ({
			kind: "table",
			format: "parquet",
			base64: btoa("PAR1PAR1"),
			byteLength: 8,
			revision: REVISION_A,
		}));
		const view = renderFile(baseHandlers(read), "data.parquet");
		await expect.element(page.getByTestId("sift-probe")).toBeVisible();

		await act(async () => {
			view.system.services.featureRouter.eventBus.emit(WORKSPACE_FILE_CHANGE_EVENT, {
				root: "/workspace",
				changes: [{ path: "/workspace/data.parquet", type: "update" }],
			} satisfies WorkspaceFileChangeEvent);
		});
		await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(mounted).toHaveLength(1);
	});

	it("reports invalid and oversized table files instead of rendering them", async () => {
		renderFile(
			baseHandlers(async () => ({ kind: "unsupported", reason: "invalid-table", byteLength: 3 })),
			"fake.parquet",
		);
		await expect
			.element(page.getByTestId("files-unsupported"))
			.toHaveTextContent("This file is not a valid Parquet table.");
		expect(mounted).toHaveLength(0);
	});

	it("announces a table viewer that fails to load and keeps the CSV source reachable", async () => {
		configureSiftRuntime(() => Promise.reject(new Error("chunk failed")));
		renderFile(
			baseHandlers(async () => csv("a\n1\n")),
			"data.csv",
		);

		await expect
			.element(page.getByRole("alert"))
			.toMatchTextContent(/The table viewer failed to load\./u);
		await page.getByRole("button", { name: "Show source" }).click();
		await vi.waitFor(() => expect(document.querySelector(".files-editor-scroll")).not.toBeNull());
	});

	it("never shows a table for a file the user has already navigated away from", async () => {
		let releaseRuntime!: () => void;
		configureSiftRuntime(
			() =>
				new Promise((resolve) => {
					releaseRuntime = () => resolve({ TableView: ProbeTableView });
				}),
		);
		const read: FilesServiceContract["read"] = async ({ relativePath }) =>
			relativePath.endsWith(".csv") ? csv("old\n1\n") : csv("notes", { revision: REVISION_B });
		const view = renderFile(baseHandlers(read), "old.csv");
		await expect.element(page.getByTestId("files-table-loading")).toBeVisible();

		view.open("notes.txt");
		await vi.waitFor(() => expect(document.querySelector(".files-editor-scroll")).not.toBeNull());
		await act(async () => releaseRuntime());

		expect(document.querySelector('[data-qa-id="sift-probe"]')).toBeNull();
		expect(mounted).toHaveLength(0);
	});
});
