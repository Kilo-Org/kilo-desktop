import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
	ComposerMention,
	type ComposerMentionImplementation,
	type MentionSearchContext,
} from "@kilo-desktop/plugin-chat/contracts";
import { PaneKind } from "@kilo-desktop/plugin-work-sessions/contracts";

import { FILES_PANE_KIND } from "../contracts/panes.js";
import {
	bootFilesHost,
	filesPane,
	filesPaneKind,
	openedFilePane,
	PaneHost,
	WORK_SESSION_ID,
	type FilesHost,
} from "../test/files-host.js";
import type { DocumentMethods } from "./documents.js";
import { FILE_MENTION_RESULT_LIMIT } from "./mentions/file-mention-source.js";

const documents = (overrides: Partial<DocumentMethods> = {}): Partial<DocumentMethods> => ({
	list: async ({ workspaceDirectory }) => ({
		paths:
			workspaceDirectory === "/docs"
				? ["guide.md"]
				: ["src/", "src/App.tsx", "src/app.css", "README.md"],
		truncated: false,
	}),
	listFiles: async ({ workspaceDirectory }) => ({
		paths:
			workspaceDirectory === "/docs" ? ["guide.md"] : ["src/App.tsx", "src/app.css", "README.md"],
		truncated: false,
	}),
	read: async () => ({
		kind: "text",
		contents: "export const value = 1;",
		byteLength: 23,
		truncated: false,
		revision: "a".repeat(64),
	}),
	write: async () => ({ status: "saved", revision: "b".repeat(64) }),
	listExternalEditors: async () => ({ editors: [] }),
	gitStatus: async () => null,
	...overrides,
});

function mentionSource(host: FilesHost) {
	const contribution = host.renderer.extensions
		.list(ComposerMention)
		.find((candidate) => candidate.key === "kilo.files/files")!;
	return {
		metadata: contribution.metadata,
		source: contribution.implementation as ComposerMentionImplementation,
	};
}

function searchContext(
	workspaceFolders: MentionSearchContext["workspaceFolders"],
	directory: string | null = workspaceFolders[0]?.path ?? null,
): MentionSearchContext {
	return {
		workSessionId: WORK_SESSION_ID,
		directory,
		workspaceId: workspaceFolders.length > 0 ? "w1" : null,
		workspaceFolders,
		signal: new AbortController().signal,
	};
}

describe("the Files pane kind", () => {
	it("is offered in new and open sessions as a document pane with its icon and close guard", async () => {
		const host = await bootFilesHost({ documents: documents() });
		const kind = host.renderer.extensions
			.list(PaneKind)
			.find((candidate) => candidate.key === FILES_PANE_KIND)!;

		expect(kind.metadata).toMatchObject({
			title: "Files",
			launch: { newSession: true, inSession: true },
			singleton: false,
			keepAlive: false,
			layoutKind: "document",
		});
		expect(filesPaneKind(host)).toMatchObject({
			component: expect.any(Function),
			icon: expect.any(Function),
			canClose: expect.any(Function),
		});
	});

	it("shows a file kilo.work-sessions opened as an object, from its absolute path", async () => {
		const read = vi.fn(documents().read!);
		const host = await bootFilesHost({
			documents: documents({ read }),
			folders: [
				{ path: "/workspace", isPrimary: true },
				{ path: "/docs", isPrimary: false },
			],
			panes: [openedFilePane("p1", "/docs/guide.md")],
		});
		host.render(<PaneHost host={host} paneId="p1" />);

		await expect.element(page.getByTestId("files-breadcrumb")).toHaveTextContent("guide.md");
		expect(read).toHaveBeenCalledWith({ workspaceDirectory: "/docs", relativePath: "guide.md" });
	});

	it("reads a worktree session's files from its worktree", async () => {
		const read = vi.fn(documents().read!);
		const host = await bootFilesHost({
			documents: documents({ read }),
			directory: "/worktrees/fix",
			panes: [openedFilePane("p1", "/worktrees/fix/src/App.tsx")],
		});
		host.render(<PaneHost host={host} paneId="p1" />);

		await vi.waitFor(() =>
			expect(read).toHaveBeenCalledWith({
				workspaceDirectory: "/worktrees/fix",
				relativePath: "src/App.tsx",
			}),
		);
	});

	it("does not read an opened file outside the session's folders", async () => {
		const read = vi.fn(documents().read!);
		const host = await bootFilesHost({
			documents: documents({ read }),
			panes: [openedFilePane("p1", "/etc/hosts")],
		});
		host.render(<PaneHost host={host} paneId="p1" />);

		await expect.element(page.getByTestId("files-view")).toBeInTheDocument();
		expect(read).not.toHaveBeenCalled();
		expect(document.querySelector('[data-qa-id="files-tree"]')).toBeNull();
		expect(document.querySelector('[data-qa-id="files-breadcrumb"]')).toBeNull();
	});

	it("reveals the requested line again when the same file is revealed again", async () => {
		const lines = Array.from({ length: 120 }, (_, index) => `line ${index + 1}`).join("\n");
		const read = vi.fn(async () => ({
			kind: "text" as const,
			contents: lines,
			byteLength: lines.length,
			truncated: false,
			revision: "a".repeat(64),
		}));
		const metadata = { workspaceDirectory: "/workspace", relativePath: "src/App.tsx" };
		const host = await bootFilesHost({
			documents: documents({ read }),
			panes: [filesPane("p1", { ...metadata, line: "100", revealRequest: "one" })],
		});
		host.render(<PaneHost host={host} paneId="p1" />);
		await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());

		await host.setPane(filesPane("p1", { ...metadata, line: "100", revealRequest: "two" }));

		await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2), { timeout: 5_000 });
	});
});

describe("Open Files", () => {
	it("shows the session's Files pane, or opens one, with ⌘⇧E", async () => {
		const openPane = vi.fn((_input: { kind: string }) => undefined);
		const host = await bootFilesHost({ documents: documents(), openPane });

		await expect(host.renderer.keyboard.dispatch("Shift+Meta+KeyE")).resolves.toBe(true);

		await vi.waitFor(() => expect(openPane).toHaveBeenCalledWith({ kind: FILES_PANE_KIND }));
	});
});

describe("closing a Files pane", () => {
	async function dirtyFilePane(write = vi.fn(documents().write!)) {
		const host = await bootFilesHost({
			documents: documents({ write }),
			panes: [filesPane("p1", { workspaceDirectory: "/workspace", relativePath: "src/App.tsx" })],
		});
		host.render(<PaneHost host={host} paneId="p1" />);
		const editor = page.getByRole("textbox", { name: "src/App.tsx" });
		await expect.element(editor, { timeout: 5_000 }).toBeVisible();
		await vi.waitFor(() => expect(host.pane("p1")?.iconKey).toBe("src/App.tsx"));
		await editor.click();
		await userEvent.keyboard("{Control>}a{/Control}changed");
		await expect.element(page.getByTestId("files-save")).toBeVisible();
		const canClose = () =>
			filesPaneKind(host).canClose!({ workSessionId: WORK_SESSION_ID, pane: host.pane("p1")! });
		return { host, write, canClose };
	}

	it("closes a pane without unsaved changes at once", async () => {
		const host = await bootFilesHost({ documents: documents(), panes: [filesPane("p1")] });
		host.render(<PaneHost host={host} paneId="p1" />);
		await expect.element(page.getByTestId("files-tree")).toBeVisible();

		await expect(
			filesPaneKind(host).canClose!({ workSessionId: WORK_SESSION_ID, pane: host.pane("p1")! }),
		).resolves.toBe(true);
		await expect(
			filesPaneKind(host).canClose!({
				workSessionId: WORK_SESSION_ID,
				pane: filesPane("unmounted"),
			}),
		).resolves.toBe(true);
	});

	it("asks before closing unsaved changes: cancel keeps the pane", async () => {
		const { canClose } = await dirtyFilePane();

		const decision = canClose();
		await expect.element(page.getByTestId("chat-pane-close-dialog")).toBeVisible();
		await expect.element(page.getByText("Save changes to App.tsx?")).toBeVisible();
		await page.getByTestId("chat-pane-close-cancel").click();

		await expect(decision).resolves.toBe(false);
		await expect.element(page.getByTestId("files-save")).toBeVisible();
	});

	it("discards the changes and closes", async () => {
		const { canClose, write } = await dirtyFilePane();

		const decision = canClose();
		await expect.element(page.getByTestId("chat-pane-close-dialog")).toBeVisible();
		await page.getByTestId("chat-pane-close-discard").click();

		await expect(decision).resolves.toBe(true);
		expect(write).not.toHaveBeenCalled();
	});

	it("saves and closes, or stays open when the save conflicts", async () => {
		const write = vi
			.fn<DocumentMethods["write"]>()
			.mockResolvedValueOnce({ status: "conflict", diskRevision: "c".repeat(64) })
			.mockResolvedValue({ status: "saved", revision: "d".repeat(64) });
		const { canClose } = await dirtyFilePane(write);

		const decision = canClose();
		await expect.element(page.getByTestId("chat-pane-close-dialog")).toBeVisible();
		await page.getByTestId("chat-pane-close-save").click();
		await expect
			.element(page.getByTestId("chat-pane-close-error"))
			.toHaveTextContent("Resolve the file conflict before closing.");
		await page.getByTestId("files-conflict-overwrite").click();
		await page.getByTestId("chat-pane-close-save").click();

		await expect(decision).resolves.toBe(true);
		expect(write).toHaveBeenCalledTimes(2);
		expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ force: true }));
	});
});

describe("@ file mentions", () => {
	it("contributes the @ trigger titled Files", async () => {
		const host = await bootFilesHost({ documents: documents() });

		expect(mentionSource(host).metadata).toEqual({ trigger: "@", title: "Files" });
	});

	it("searches a single folder's files by path and resolves them to origin's @/relative paths", async () => {
		const listFiles = vi.fn(documents().listFiles!);
		const host = await bootFilesHost({ documents: documents({ listFiles }) });
		const { source } = mentionSource(host);
		const context = searchContext([{ path: "/workspace", isPrimary: true }]);

		const items = await source.search("app", context);

		expect(items.map(({ id, label, detail }) => ({ id, label, detail }))).toEqual([
			{ id: "src/App.tsx", label: "App.tsx", detail: "src/App.tsx" },
			{ id: "src/app.css", label: "app.css", detail: "src/app.css" },
		]);
		expect(items[0]!.icon).toBeTypeOf("function");
		expect(source.resolve(items[0]!, context)).toEqual({ text: "@/src/App.tsx" });

		await source.search("readme", context);
		expect(listFiles).toHaveBeenCalledOnce();
	});

	it("uses absolute paths across folders, and the directory without a workspace", async () => {
		const host = await bootFilesHost({ documents: documents() });
		const { source } = mentionSource(host);
		const multi = searchContext([
			{ path: "/workspace", isPrimary: true },
			{ path: "/docs", isPrimary: false },
		]);

		const items = await source.search("guide", multi);
		expect(items.map(({ id }) => id)).toEqual(["/docs/guide.md"]);
		expect(source.resolve(items[0]!, multi)).toEqual({ text: "@/docs/guide.md" });

		await expect(source.search("", searchContext([], null))).resolves.toEqual([]);
		await expect(
			source.search("guide", searchContext([], "/docs")).then((found) => found.map(({ id }) => id)),
		).resolves.toEqual(["guide.md"]);
	});

	it("offers nothing from a folder it cannot list", async () => {
		const host = await bootFilesHost({
			documents: documents({
				listFiles: async () => {
					throw new Error("denied");
				},
			}),
		});

		await expect(
			mentionSource(host).source.search(
				"",
				searchContext([{ path: "/workspace", isPrimary: true }]),
			),
		).resolves.toEqual([]);
	});

	it("ranks name matches above path matches and caps the results", async () => {
		const paths = [
			...Array.from({ length: 200 }, (_, index) => `deep/nested/app/file-${String(index)}.ts`),
			"src/components/AppShell.tsx",
			"app.ts",
		];
		const host = await bootFilesHost({
			documents: documents({ listFiles: async () => ({ paths, truncated: false }) }),
		});
		const { source } = mentionSource(host);
		const context = searchContext([{ path: "/workspace", isPrimary: true }]);

		const found = await source.search("app", context);
		expect(found).toHaveLength(FILE_MENTION_RESULT_LIMIT);
		expect(found.slice(0, 2).map(({ id }) => id)).toEqual([
			"app.ts",
			"src/components/AppShell.tsx",
		]);
		await expect(source.search("", context)).resolves.toHaveLength(FILE_MENTION_RESULT_LIMIT);
	});

	it("renders file-type icons for its items", async () => {
		const host = await bootFilesHost({ documents: documents() });
		const [item] = await mentionSource(host).source.search(
			"App.tsx",
			searchContext([{ path: "/workspace", isPrimary: true }]),
		);
		const Icon = item!.icon!;

		host.render(<Icon className="size-4" />);

		await vi.waitFor(() =>
			expect(document.querySelector("[data-pierre-file-icon]")).not.toBeNull(),
		);
	});
});
