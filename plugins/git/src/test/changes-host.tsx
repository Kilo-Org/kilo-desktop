// Test host for kilo.git's web entry: main and a window linked in memory,
// with stand-ins for kilo.workspaces (folders, file changes, the vcs key),
// kilo.sessions (sessions, panes), kilo.workbench's navigator, kilo.shell's
// theme and kilo.git's repository in main. The Changes pane renders as the
// canvas renders pane kinds; patches come from a stubbed fetch.
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import {
	definePlugin,
	KernelError,
	KernelShell,
	type DomainProvider,
	type DomainState,
	type PluginEntry,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createTestKernelPair } from "@kilo-desktop/kernel/testing";
import { KernelProvider, RenderContribution } from "@kilo-desktop/kernel/web";
import sessionsManifest from "@kilo-desktop/plugin-sessions/plugin.json";
import {
	EMPTY_WORK_SESSION_PANES,
	PaneKind,
	Panes,
	WorkSessions,
	SESSIONS_DEFINITIONS,
	type OpenPaneInput,
	type Pane,
	type PaneImplementation,
	type PaneProps,
	type WorkSession,
} from "@kilo-desktop/plugin-sessions/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DOMAINS, SHELL_EXTENSION_POINTS, Theme } from "@kilo-desktop/plugin-shell/contracts";
import workbenchManifest from "@kilo-desktop/plugin-workbench/plugin.json";
import {
	LauncherOption,
	Workbench,
	WORKBENCH_DEFINITIONS,
	type LauncherOptionProps,
} from "@kilo-desktop/plugin-workbench/contracts";
import workspacesManifest from "@kilo-desktop/plugin-workspaces/plugin.json";
import {
	Files,
	Workspaces,
	WORKSPACES_DEFINITIONS,
	type Workspace,
} from "@kilo-desktop/plugin-workspaces/contracts";
import { Toaster } from "@kilo-desktop/ui/components/sonner";
import { TooltipProvider } from "@kilo-desktop/ui/components/tooltip";

import manifest from "../../plugin.json";
import {
	CHANGES_PANE_KIND,
	GIT_DEFINITIONS,
	PullRequests,
	Repository,
	type PullRequestsState,
} from "../contracts/index.js";
import { gitWebEntry } from "../web/entry/index.js";

export type ThemeState = DomainState<typeof Theme>;
/** Fakes for some of kilo.git's repository methods, by name. */
export type RepositoryFake = Partial<
	Record<keyof (typeof Repository)["methods"], (input: never) => unknown>
>;

export const ROOT = "/workspace/project";

export const LIGHT_THEME: ThemeState = {
	mode: "light",
	themeId: "kilo",
	accentId: "blue",
	terminal: null,
	shiki: "pierre-light",
};

export function changesPane(metadata: Record<string, string> = {}): Pane {
	return { id: "changes_1", kind: CHANGES_PANE_KIND, title: "Changes", metadata, ordinal: 1 };
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

export function session(id: string, patch: Partial<WorkSession> = {}): WorkSession {
	return {
		id,
		title: "Session",
		titleSource: "default",
		pinned: false,
		archived: false,
		archiveChangedAt: 0,
		workspaceId: "w1",
		worktreeBranch: null,
		directory: null,
		chatIds: [],
		createdAt: 0,
		updatedAt: 0,
		...patch,
	};
}

export interface ChangesHostOptions {
	readonly folders?: { path: string; isPrimary: boolean }[];
	readonly sessions?: WorkSession[];
	/** kilo.git's repository in main; methods left out reject. */
	readonly repository?: RepositoryFake;
	/** Leaves kilo.git's main entry out (no repository), as in the browser. */
	readonly withoutRepository?: boolean;
	/** The `kilo.workspaces/vcs` key (a version control provider is present). */
	readonly vcs?: boolean;
	readonly activeSessionId?: string | null;
	/** What kilo.workbench's `openPane` does; by default it opens the pane in the open session. */
	readonly openPane?: (input: { kind: string }) => void;
	readonly theme?: ThemeState;
	/** kilo.git's pull requests in main; its methods are recorded. */
	readonly pullRequests?: Partial<PullRequestsState>;
	/** More plugins (stand-ins for kilo.chat, kilo.agent, kilo.telemetry…). */
	readonly main?: readonly PluginRegistration[];
	readonly renderer?: readonly PluginRegistration[];
}

/** Boots the host; render something with `host.render`. */
export async function bootGitHost(options: ChangesHostOptions = {}) {
	cleanup();
	const opened: OpenPaneInput[] = [];
	let files!: DomainProvider<typeof Files>;
	let workspaces!: DomainProvider<typeof Workspaces>;
	let theme: DomainProvider<typeof Theme> | undefined;
	const unused = (name: string) => () => {
		throw new KernelError("NOT_FOUND", `${name} is not faked here.`);
	};

	const workspacesMain: PluginEntry = definePlugin({
		activate(sdk) {
			workspaces = sdk.domains.provide(Workspaces, {
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
			files = sdk.domains.provide(Files, { initialState: { watched: [] }, methods: {} });
			sdk.context.set("vcs", options.vcs ?? true);
		},
	});
	const sessionsMain: PluginEntry = definePlugin({
		activate(sdk) {
			sdk.domains.provide(WorkSessions, {
				initialState: { sessions: options.sessions ?? [session("wses_1")] },
				methods: {
					create: unused("create"),
					rename: unused("rename"),
					setPinned: unused("setPinned"),
					setArchived: unused("setArchived"),
					setWorktreeBranch: unused("setWorktreeBranch"),
					remove: unused("remove"),
					importLegacyPins: unused("importLegacyPins"),
					isolationOptions: () => null,
				},
			});
			const panes: DomainProvider<typeof Panes> = sdk.domains.provide(Panes, {
				initialState: { bySession: {} },
				methods: {
					open: (input) => {
						opened.push(input);
						const pane = { ...changesPane(input.metadata), kind: input.kind };
						panes.setState({
							bySession: { [input.sessionId]: { ...EMPTY_WORK_SESSION_PANES, panes: [pane] } },
						});
						return pane;
					},
					openObject: () => null,
					activate: () => undefined,
					update: unused("update"),
					close: () => ({ closed: false }),
					setLayout: () => undefined,
					setArrangement: () => undefined,
					importLegacy: () => undefined,
				},
			});
		},
	});
	const repositoryCalls = new Map<string, unknown[]>();
	const record = (key: string, input: unknown) =>
		repositoryCalls.set(key, [...(repositoryCalls.get(key) ?? []), input]);
	const opens: string[] = [];
	let pullRequests!: DomainProvider<typeof PullRequests>;
	let repository: DomainProvider<typeof Repository> | undefined;
	const gitMain: PluginEntry = definePlugin({
		activate(sdk) {
			pullRequests = sdk.domains.provide(PullRequests, {
				initialState: { byDirectory: {}, githubStatus: null, ...options.pullRequests },
				methods: {
					setActive: (input) => void record("pullRequests.setActive", input),
					refresh: (input) => void record("pullRequests.refresh", input),
					recordCreated: (input) => void record("pullRequests.recordCreated", input),
				},
			});
			const fake = options.repository ?? {};
			repository = sdk.domains.provide(Repository, {
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
			if (options.theme)
				theme = sdk.domains.provide(Theme, { initialState: options.theme, methods: {} });
		},
	});
	const workbenchWeb: PluginEntry = definePlugin({
		activate(sdk) {
			const activeSessionId =
				options.activeSessionId === undefined ? "wses_1" : options.activeSessionId;
			sdk.domains.provide(Workbench, {
				initialState: { focus: null, activeSessionId, view: null, detachedViews: [] },
				methods: {
					setFocus: () => undefined,
					openSession: () => undefined,
					closeSession: () => undefined,
					showView: () => undefined,
					openPane: async (input) => {
						if (options.openPane) return options.openPane(input);
						if (!activeSessionId) return;
						await sdk.domains
							.get(Panes)
							?.methods.open({ sessionId: activeSessionId, kind: input.kind });
					},
				},
			});
			sdk.context.set("sessionActive", activeSessionId !== null);
		},
	});

	const shell = {
		manifest: shellManifest,
		definitions: { extensionPoints: SHELL_EXTENSION_POINTS, domains: SHELL_DOMAINS },
	};
	const { main, renderer } = await createTestKernelPair({
		main: [
			shell,
			{ manifest: workspacesManifest, definitions: WORKSPACES_DEFINITIONS, entry: workspacesMain },
			{ manifest: sessionsManifest, definitions: SESSIONS_DEFINITIONS, entry: sessionsMain },
			{ manifest: workbenchManifest, definitions: WORKBENCH_DEFINITIONS },
			{
				manifest,
				definitions: GIT_DEFINITIONS,
				...(options.withoutRepository ? {} : { entry: gitMain }),
			},
			...(options.main ?? []),
		],
		renderer: [
			{ ...shell, entry: shellWeb },
			{ manifest: workspacesManifest, definitions: WORKSPACES_DEFINITIONS },
			{ manifest: sessionsManifest, definitions: SESSIONS_DEFINITIONS },
			{ manifest: workbenchManifest, definitions: WORKBENCH_DEFINITIONS, entry: workbenchWeb },
			{ manifest, definitions: GIT_DEFINITIONS, entry: gitWebEntry },
			...(options.renderer ?? []),
		],
	});
	main.kernelSdk.domains.provide(KernelShell, {
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
	await main.flush();

	return {
		main,
		renderer,
		opened,
		repositoryCalls,
		calls: (method: string) => repositoryCalls.get(method) ?? [],
		/** URLs opened in the browser through kernel/shell. */
		opens,
		setPullRequests: (patch: Partial<PullRequestsState>) =>
			act(async () => {
				pullRequests.setState({ ...pullRequests.state, ...patch });
				await main.flush();
			}),
		/** kilo.git's main announces a renamed worktree branch. */
		emitBranchRenamed: (directory: string, branch: string) =>
			act(async () => {
				repository?.emit("worktree-branch-renamed", { directory, branch });
				await main.flush();
			}),
		/** One kilo.workspaces file-change batch, delivered to the window. */
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

/** The Changes pane as kilo.workbench's canvas renders a pane kind. */
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
					sessionId: "wses_1",
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

/** The launcher's branch slot as kilo.workbench's launcher renders it. */
export function LauncherBranchHost({
	host,
	...props
}: Partial<LauncherOptionProps> & { readonly host: GitHost }) {
	const contribution = host.renderer.extensions
		.list(LauncherOption)
		.find((candidate) => candidate.key === "kilo.git/branch")!;
	return (
		<RenderContribution<LauncherOptionProps>
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
export async function renderView(props: ViewProps = {}, options: ChangesHostOptions = {}) {
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
		expect(
			treeHost()?.shadowRoot?.querySelector(`[data-item-path="${relativePath}"]`),
		).not.toBeNull();
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

/** Shared afterEach: unmount, drop the fetch stub, and reset storage. */
export function resetViewTestDom(): void {
	cleanup();
	vi.unstubAllGlobals();
	localStorage.clear();
}
