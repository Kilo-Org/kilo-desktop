// Test host for kilo.git's window areas: main and a window linked in memory,
// with stand-ins (their real manifests and contracts) for kilo.work-sessions
// (workspaces, file changes, the `hasVcs` key, work sessions, panes and each
// window's `window` object), kilo.shell's theme and kilo.git's own main
// (repository and pull requests), plus the host's `kernel/os` and
// `kernel/clipboard` and, on request, kilo.files' file opener. Pieces of
// kilo.git's UI render as the canvas renders pane kinds; patches come from a
// stubbed fetch.
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import {
	definePlugin,
	KernelClipboard,
	KernelError,
	KernelOs,
	type DomainObjectProvider,
	type DomainObjectState,
	type ObjectRef,
	type PluginEntry,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createTestKernelPair, testPlugin } from "@kilo-desktop/kernel/testing";
import { KernelProvider, RenderContribution } from "@kilo-desktop/kernel/web";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { CHAT_DEFINITIONS } from "@kilo-desktop/plugin-chat/contracts";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS } from "@kilo-desktop/plugin-core/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS, Theme } from "@kilo-desktop/plugin-shell/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import {
	EMPTY_WORK_SESSION_PANES,
	FileObjectType,
	FileWatcher,
	NewWorkSessionOption,
	PaneKind,
	Panes,
	WORK_SESSIONS_DEFINITIONS,
	WorkSessions,
	WorkSessionsWindow,
	Workspaces,
	type NewWorkSessionOptionProps,
	type OpenPaneInput,
	type Pane,
	type PaneImplementation,
	type PaneProps,
	type WorkSession,
	type Workspace,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { Toaster } from "@kilo-desktop/ui/components/sonner";
import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";

import manifest from "../../plugin.json";
import {
	CHANGES_PANE_KIND,
	GIT_DEFINITIONS,
	PullRequests,
	Repository,
	type PullRequestsState,
} from "../contracts";

export type ThemeState = DomainObjectState<typeof Theme>;
/** Fakes for some of kilo.git's repository methods, by name. */
export type RepositoryFake = Partial<
	Record<keyof (typeof Repository)["methods"], (input: never) => unknown>
>;

export const ROOT = "/workspace/project";
export const WORK_SESSION_ID = "wses_1";

/** What `Panes.openObject` is asked to open. */
export interface OpenObjectInput {
	readonly workSessionId: string;
	readonly ref: ObjectRef;
}

/** kilo.files as far as the Changes pane sees it: an opener for workspace files. */
const fileOpenerPlugin = testPlugin("kilo.files", {
	manifest: {
		requires: { "kilo.work-sessions/opener": "optional" },
		contributes: {
			extensions: {
				"kilo.work-sessions/opener": [
					{ id: "file", match: { type: FileObjectType.id }, pane: "kilo.files/files" },
				],
			},
		},
	},
});

export const LIGHT_THEME: ThemeState = {
	mode: "light",
	themeId: "kilo",
	accentId: "blue",
	terminal: null,
	shiki: "pierre-light",
};

/** An entry that does nothing, for plugins present only for their manifest's points. */
export const EMPTY_ENTRY: PluginEntry = definePlugin({ activate: () => {} });

export function changesPane(metadata: Record<string, string> = {}): Pane {
	return { id: "changes_1", kind: CHANGES_PANE_KIND, title: "Changes", metadata, ordinal: 1 };
}

/** The pane kilo.files' opener would open for `input`. */
function filesPane({ ref }: OpenObjectInput): Pane {
	return {
		id: "files_1",
		kind: "kilo.files/files",
		title: ref.id.split(/[\\/]/).at(-1) ?? ref.id,
		object: ref,
		metadata: {},
		ordinal: 2,
	};
}

export function workspace(folders: { path: string; isPrimary: boolean }[]): Workspace {
	return {
		id: "w1",
		name: "Project",
		folders: folders.map((folder, position) => ({ ...folder, id: `f${position}`, position })),
		createdAt: 0,
		updatedAt: 0,
	};
}

export function workSession(id: string, patch: Partial<WorkSession> = {}): WorkSession {
	return {
		id,
		title: "Session",
		titleSource: "default",
		pinned: false,
		archived: false,
		archiveChangedAt: 0,
		workspaceId: "w1",
		branch: null,
		directory: null,
		chatIds: [],
		createdAt: 0,
		updatedAt: 0,
		...patch,
	};
}

export interface GitHostOptions {
	readonly folders?: { path: string; isPrimary: boolean }[];
	readonly workSessions?: WorkSession[];
	/** kilo.git's repository in main; methods left out reject NOT_FOUND. */
	readonly repository?: RepositoryFake;
	/** Leaves kilo.git's main stand-in out (no repository), as in the browser. */
	readonly withoutRepository?: boolean;
	/** The `kilo.work-sessions/hasVcs` key (a version control contribution is present). */
	readonly vcs?: boolean;
	readonly activeWorkSessionId?: string | null;
	/** What `WorkSessionsWindow.openPane` does; by default it opens the pane in the open work session. */
	readonly openPane?: (input: { kind: string }) => void;
	readonly theme?: ThemeState;
	/** kilo.git's pull requests in main; its methods are recorded. */
	readonly pullRequests?: Partial<PullRequestsState>;
	/** A kilo.files stand-in contributing an opener for workspace files. */
	readonly fileOpener?: boolean;
	/**
	 * kilo.work-sessions' `openObject`; returns a Files pane unless overridden
	 * (`() => null` stands for no matching opener). Calls are recorded either way.
	 */
	readonly openObject?: (input: OpenObjectInput) => Pane | null | Promise<Pane | null>;
	/** More main-side plugins, or entries for kilo.core and kilo.chat (stand-ins). */
	readonly main?: readonly PluginRegistration[];
	readonly renderer?: readonly PluginRegistration[];
	/** kilo.core's main stand-in (e.g. generation and models); absent by default. */
	readonly coreMain?: PluginEntry;
	/** kilo.chat's window stand-in (e.g. the composer); absent by default. */
	readonly chatWeb?: PluginEntry;
	/** kilo.git's window entry; the real one by default. */
	readonly gitWeb?: PluginEntry;
}

/**
 * Boots the host; render something with `host.render`. kilo.git's real web
 * entry is loaded lazily, so this module can be imported before it exists.
 */
export async function bootGitHost(options: GitHostOptions = {}) {
	cleanup();
	const opened: OpenPaneInput[] = [];
	const openedObjects: OpenObjectInput[] = [];
	let files!: DomainObjectProvider<typeof FileWatcher>;
	let workspaces!: DomainObjectProvider<typeof Workspaces>;
	let workSessions!: DomainObjectProvider<typeof WorkSessions>;
	let theme: DomainObjectProvider<typeof Theme> | undefined;
	const unused = (name: string) => () => {
		throw new KernelError("NOT_FOUND", `${name} is not faked here.`);
	};
	const branchesSet: { id: string; branch: string }[] = [];

	const workSessionsMain: PluginEntry = definePlugin({
		activate(sdk) {
			workspaces = sdk.domainObjects.provide(Workspaces, {
				initialState: {
					workspaces: [workspace(options.folders ?? [{ path: ROOT, isPrimary: true }])],
					activeId: "w1",
					unavailableFolderIds: [],
				},
				methods: {
					create: unused("create"),
					update: unused("update"),
					remove: unused("remove"),
					setActive: unused("setActive"),
					authorize: () => ({ allowed: true }),
					checkFolders: () => undefined,
				},
			});
			files = sdk.domainObjects.provide(FileWatcher, {
				initialState: { watched: [] },
				methods: {},
			});
			sdk.context.set("hasVcs", options.vcs ?? true);
			workSessions = sdk.domainObjects.provide(WorkSessions, {
				initialState: { workSessions: options.workSessions ?? [workSession(WORK_SESSION_ID)] },
				methods: {
					create: unused("create"),
					createChat: unused("createChat"),
					rename: unused("rename"),
					setPinned: unused("setPinned"),
					setArchived: unused("setArchived"),
					setBranch: ({ id, branch }) => {
						branchesSet.push({ id, branch });
						const list = workSessions.state.workSessions.map((candidate) =>
							candidate.id === id ? { ...candidate, branch } : candidate,
						);
						workSessions.setState({ workSessions: list });
						return list.find((candidate) => candidate.id === id)!;
					},
					remove: unused("remove"),
					isolationOptions: () => null,
				},
			});
			const panes: DomainObjectProvider<typeof Panes> = sdk.domainObjects.provide(Panes, {
				initialState: { byWorkSession: {} },
				methods: {
					open: (input) => {
						opened.push(input);
						const pane = { ...changesPane(input.metadata), kind: input.kind };
						panes.setState({
							byWorkSession: {
								[input.workSessionId]: { ...EMPTY_WORK_SESSION_PANES, panes: [pane] },
							},
						});
						return pane;
					},
					openObject: (input) => {
						openedObjects.push(input);
						return options.openObject ? options.openObject(input) : filesPane(input);
					},
					activate: () => undefined,
					update: unused("update"),
					close: () => ({ closed: false }),
					setLayout: () => undefined,
					setArrangement: () => undefined,
				},
			});
		},
	});

	const repositoryCalls = new Map<string, unknown[]>();
	const record = (key: string, input: unknown) =>
		repositoryCalls.set(key, [...(repositoryCalls.get(key) ?? []), input]);
	const opens: string[] = [];
	let pullRequests!: DomainObjectProvider<typeof PullRequests>;
	let repository: DomainObjectProvider<typeof Repository> | undefined;
	const gitMain: PluginEntry = definePlugin({
		activate(sdk) {
			pullRequests = sdk.domainObjects.provide(PullRequests, {
				initialState: { byDirectory: {}, githubStatus: null, ...options.pullRequests },
				methods: {
					setActive: (input) => void record("pullRequests.setActive", input),
					refresh: (input) => void record("pullRequests.refresh", input),
					recordCreated: (input) => void record("pullRequests.recordCreated", input),
				},
			});
			const fake = options.repository ?? {};
			repository = sdk.domainObjects.provide(Repository, {
				initialState: {},
				methods: new Proxy({} as Record<string, (input: unknown) => unknown>, {
					get: (_target, key: string) => (input: unknown) => {
						record(key, input);
						const method = fake[key as keyof RepositoryFake];
						if (!method) throw new KernelError("NOT_FOUND", `${key} is not faked here.`);
						return method(input as never);
					},
				}) as never,
			});
		},
	});

	const shellWeb: PluginEntry = definePlugin({
		activate(sdk) {
			if (options.theme) {
				theme = sdk.domainObjects.provide(Theme, { initialState: options.theme, methods: {} });
			}
		},
	});
	const activeWorkSessionId =
		options.activeWorkSessionId === undefined ? WORK_SESSION_ID : options.activeWorkSessionId;
	const workSessionsWeb: PluginEntry = definePlugin({
		activate(sdk) {
			sdk.domainObjects.provide(WorkSessionsWindow, {
				initialState: { focus: null, activeWorkSessionId, view: null, detachedViews: [] },
				methods: {
					setFocus: () => undefined,
					openWorkSession: () => undefined,
					closeWorkSession: () => undefined,
					showView: () => undefined,
					openPane: async (input) => {
						if (options.openPane) return options.openPane(input);
						if (!activeWorkSessionId) return;
						await sdk.domainObjects
							.get(Panes)
							?.methods.open({ workSessionId: activeWorkSessionId, kind: input.kind });
					},
				},
			});
			sdk.context.set("workSessionActive", activeWorkSessionId !== null);
		},
	});

	const gitWeb = options.gitWeb ?? (await import("../web/index")).gitWebEntry;
	const { main, renderer } = await createTestKernelPair({
		main: [
			{
				manifest: coreManifest,
				definitions: CORE_DEFINITIONS,
				entry: options.coreMain ?? EMPTY_ENTRY,
			},
			{ manifest: shellManifest, definitions: SHELL_DEFINITIONS },
			{
				manifest: workSessionsManifest,
				definitions: WORK_SESSIONS_DEFINITIONS,
				entry: workSessionsMain,
			},
			{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
			{
				manifest,
				definitions: GIT_DEFINITIONS,
				...(options.withoutRepository ? {} : { entry: gitMain }),
			},
			...(options.fileOpener ? [fileOpenerPlugin] : []),
			...(options.main ?? []),
		],
		renderer: [
			{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
			{ manifest: shellManifest, definitions: SHELL_DEFINITIONS, entry: shellWeb },
			{
				manifest: workSessionsManifest,
				definitions: WORK_SESSIONS_DEFINITIONS,
				entry: workSessionsWeb,
			},
			{
				manifest: chatManifest,
				definitions: CHAT_DEFINITIONS,
				entry: options.chatWeb ?? EMPTY_ENTRY,
			},
			{ manifest, definitions: GIT_DEFINITIONS, entry: gitWeb },
			...(options.fileOpener ? [fileOpenerPlugin] : []),
			...(options.renderer ?? []),
		],
	});
	main.kernelSdk.domainObjects.provide(KernelOs, {
		initialState: {},
		methods: {
			openExternal: ({ url }) => {
				opens.push(url);
				return true;
			},
			showItemInFolder: unused("showItemInFolder"),
			showLogs: unused("showLogs"),
			logFilePath: unused("logFilePath"),
		},
	});
	const copied: string[] = [];
	main.kernelSdk.domainObjects.provide(KernelClipboard, {
		initialState: {},
		methods: {
			writeText: ({ text }) => {
				copied.push(text);
			},
		},
	});
	await main.flush();

	return {
		main,
		renderer,
		opened,
		/** Objects (files) the pane asked kilo.work-sessions to open. */
		openedObjects,
		/** Text written to the host clipboard through kernel/clipboard. */
		copied,
		repositoryCalls,
		calls: (method: string) => repositoryCalls.get(method) ?? [],
		/** `WorkSessions.setBranch` calls. */
		branchesSet,
		/** URLs opened in the browser through kernel/os. */
		opens,
		setPullRequests: (patch: Partial<PullRequestsState>) =>
			act(async () => {
				pullRequests.setState({ ...pullRequests.state, ...patch });
				await main.flush();
			}),
		setWorkSessions: (list: WorkSession[]) =>
			act(async () => {
				workSessions.setState({ workSessions: list });
				await main.flush();
			}),
		/** kilo.git's main announces a renamed worktree branch. */
		emitBranchRenamed: (directory: string, branch: string) =>
			act(async () => {
				repository?.emit("worktree-branch-renamed", { directory, branch });
				await main.flush();
			}),
		/** One `kilo.work-sessions/file-watcher` change batch, delivered to the window. */
		emitFileChanges: (root: string, paths: readonly string[]) =>
			act(async () => {
				files.emit("changed", {
					root,
					changes: paths.map((path) => ({ path, type: "update" as const })),
				});
				await main.flush();
			}),
		setFolders: (folders: { path: string; isPrimary: boolean }[]) =>
			act(async () => {
				workspaces.setState({ ...workspaces.state, workspaces: [workspace(folders)] });
				await main.flush();
			}),
		setTheme: (next: ThemeState) => act(() => theme?.setState(next)),
		render: (element: ReactNode) =>
			render(
				<KernelProvider kernel={renderer}>
					<TooltipProvider>{element}</TooltipProvider>
					<Toaster />
				</KernelProvider>,
			),
	};
}

export type GitHost = Awaited<ReturnType<typeof bootGitHost>>;

/** The Changes pane as kilo.work-sessions' canvas renders a pane kind. */
export function ChangesPaneHost({
	host,
	...props
}: Partial<PaneProps> & { readonly host: GitHost }) {
	const contribution = host.renderer.extensions
		.list(PaneKind)
		.find((candidate) => candidate.key === CHANGES_PANE_KIND)!;
	return (
		<div className="flex" style={{ height: 600, width: 900 }}>
			<RenderContribution
				contribution={contribution}
				props={{
					workSessionId: WORK_SESSION_ID,
					pane: changesPane(),
					workspaceId: "w1",
					directory: ROOT,
					visible: true,
					...props,
				}}
				select={(implementation: PaneImplementation) => implementation.component}
			/>
		</div>
	);
}

/** A kilo.git New Session page option as kilo.work-sessions renders it. */
export function NewWorkSessionOptionHost({
	host,
	optionId = "branch",
	...props
}: Partial<NewWorkSessionOptionProps> & {
	readonly host: GitHost;
	readonly optionId?: "branch" | "init";
}) {
	const contribution = host.renderer.extensions
		.list(NewWorkSessionOption)
		.find((candidate) => candidate.key === `kilo.git/${optionId}`)!;
	return (
		<RenderContribution<NewWorkSessionOptionProps>
			contribution={contribution}
			props={{
				workspaceId: "w1",
				repositoryDirectory: ROOT,
				directory: ROOT,
				onIsolationChange: () => undefined,
				onChanged: () => undefined,
				disabled: false,
				...props,
			}}
		/>
	);
}

export interface ViewProps extends Partial<PaneProps> {
	readonly metadata?: Record<string, string>;
}

/** Boots the host and renders the Changes pane; `rerender` passes new pane props. */
export async function renderView(props: ViewProps = {}, options: GitHostOptions = {}) {
	const host = await bootGitHost(options);
	const primary = options.folders?.find((folder) => folder.isPrimary)?.path ?? ROOT;
	const element = ({ metadata, ...rest }: ViewProps) => (
		<ChangesPaneHost
			host={host}
			directory={primary}
			{...(metadata ? { pane: changesPane(metadata) } : {})}
			{...rest}
		/>
	);
	const view = host.render(element(props));
	return {
		...host,
		rerender: (next: ViewProps) =>
			view.rerender(
				<KernelProvider kernel={host.renderer}>
					<TooltipProvider>{element(next)}</TooltipProvider>
					<Toaster />
				</KernelProvider>,
			),
	};
}

export const PATCH = `diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-hello
+hello world
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+export const value = 1;
`;

/**
 * Same file set as `PATCH`: README.md byte-identical (same raw patch key),
 * src/new.ts with changed content (different raw patch key).
 */
export const SECOND_PATCH = `diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-hello
+hello world
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..4444444
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+export const value = 2;
`;

/** A deleted file (old.txt) and a renamed one (src/before.ts → src/after.ts). */
export const DELETED_AND_RENAMED_PATCH = `diff --git a/old.txt b/old.txt
deleted file mode 100644
index 1111111..0000000
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-gone
diff --git a/src/before.ts b/src/after.ts
similarity index 90%
rename from src/before.ts
rename to src/after.ts
index 1111111..2222222 100644
--- a/src/before.ts
+++ b/src/after.ts
@@ -1 +1 @@
-export const a = 1;
+export const a = 2;
`;

export const FIRST_FILE = `diff --git a/first.txt b/first.txt
index 1111111..2222222 100644
--- a/first.txt
+++ b/first.txt
@@ -1 +1 @@
-old
+new
`;

export const SECOND_FILE = `diff --git a/second.txt b/second.txt
new file mode 100644
index 0000000..4444444
--- /dev/null
+++ b/second.txt
@@ -0,0 +1 @@
+added
`;

export function patchResponseStream(
	chunkSize = 24,
	text: string = PATCH,
): ReadableStream<Uint8Array> {
	const bytes = new TextEncoder().encode(text);
	return new ReadableStream<Uint8Array>({
		start(controller) {
			// Chunked so the incremental `diff --git ` boundary parser is exercised.
			for (let offset = 0; offset < bytes.length; offset += chunkSize) {
				controller.enqueue(bytes.slice(offset, offset + chunkSize));
			}
			controller.close();
		},
	});
}

/** One whole file per chunk, with a gap so each publish lands in its own React commit. */
export function delayedFileResponseStream(
	fileTexts: readonly string[],
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		async start(controller) {
			for (const fileText of fileTexts) {
				controller.enqueue(encoder.encode(fileText));
				await new Promise((resolve) => setTimeout(resolve, 150));
			}
			controller.close();
		},
	});
}

/** A patch body stream the test feeds and closes by hand (stalls until then). */
export function controlledPatchStream(): {
	stream: ReadableStream<Uint8Array>;
	enqueue(text: string): void;
	close(): void;
} {
	const encoder = new TextEncoder();
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
		},
	});
	return {
		stream,
		enqueue: (text) => controller?.enqueue(encoder.encode(text)),
		close: () => controller?.close(),
	};
}

/** Answers the pane's `kilo-git://diff/patch` requests. */
export function stubFetch(
	respond: (url: string) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn((input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input.toString();
		return Promise.resolve(respond(url));
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

export function treeHost(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[data-qa-id="git-diff-tree"]');
}

/** The sidebar's resizable panel wrapper; its inline width is the panel size. */
export function filesPanel(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[data-qa-id="git-diff-files-panel"]');
}

/**
 * Long enough for the diff view's first render: under load its highlighting
 * workers can take the pool's full 10s start-up allowance before it falls
 * back to the main thread.
 */
export const WAIT = { timeout: 15_000 };

export async function waitForTreePath(relativePath: string): Promise<void> {
	await vi.waitFor(() => {
		// Not .not.toBeNull(): the chain is undefined until the shadow root mounts.
		expect(
			treeHost()?.shadowRoot?.querySelector(`[data-item-path="${relativePath}"]`),
		).toBeTruthy();
	}, WAIT);
}

export function diffContainerFor(relativePath: string): Element | null {
	return (
		Array.from(document.querySelectorAll("diffs-container")).find((host) =>
			(host.shadowRoot?.querySelector("[data-diffs-header]")?.textContent ?? "").includes(
				relativePath,
			),
		) ?? null
	);
}

/** The collapse button is slotted header-prefix content in the container host's light DOM. */
export function collapseButtonFor(relativePath: string): HTMLButtonElement | null {
	return (
		diffContainerFor(relativePath)?.querySelector<HTMLButtonElement>(
			'[data-qa-id="git-diff-file-collapse"]',
		) ?? null
	);
}

/** A file's header action (slotted after its file name), by `data-qa-id`. */
export function headerActionFor(relativePath: string, qaId: string): HTMLButtonElement | null {
	return (
		diffContainerFor(relativePath)?.querySelector<HTMLButtonElement>(
			`[slot="header-filename-suffix"] [data-qa-id="${qaId}"]`,
		) ?? null
	);
}

/** Shared afterEach: unmount, drop the fetch stub, and reset storage. */
export function resetViewTestDom(): void {
	cleanup();
	vi.unstubAllGlobals();
	localStorage.clear();
}
