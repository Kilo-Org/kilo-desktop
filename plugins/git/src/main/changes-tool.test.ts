import { describe, expect, it } from "vitest";

import { definePlugin, type DomainProvider, type PluginEntry } from "@kilo-desktop/kernel";
import { createTestKernelPair, testPlugin } from "@kilo-desktop/kernel/testing";
import { AgentTool, type ToolCallContext } from "@kilo-desktop/plugin-agent/contracts";
import sessionsManifest from "@kilo-desktop/plugin-sessions/plugin.json";
import {
	EMPTY_WORK_SESSION_PANES,
	Panes,
	WorkSessions,
	SESSIONS_DEFINITIONS,
	type OpenPaneInput,
	type Pane,
	type WorkSession,
} from "@kilo-desktop/plugin-sessions/contracts";
import workspacesManifest from "@kilo-desktop/plugin-workspaces/plugin.json";
import {
	Workspaces,
	WORKSPACES_DEFINITIONS,
	type Workspace,
} from "@kilo-desktop/plugin-workspaces/contracts";

import manifest from "../../plugin.json";
import { CHANGES_PANE_KIND, GIT_DEFINITIONS } from "../contracts/index.js";
import { createGitMainEntry } from "./entry.js";

const WORKSPACE: Workspace = {
	id: "w1",
	name: "App",
	folders: [
		{ id: "f1", path: "/projects/app", isPrimary: true, position: 0 },
		{ id: "f2", path: "/projects/docs", isPrimary: false, position: 1 },
	],
	createdAt: 0,
	updatedAt: 0,
};

function session(id: string, patch: Partial<WorkSession> = {}): WorkSession {
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

const SESSIONS = [
	session("local"),
	session("worktree", {
		worktreeBranch: "kilo/fix",
		directory: "/projects/app/.kilo/worktrees/fix",
	}),
	session("unscoped", { workspaceId: null, directory: "/chats/x" }),
];

/** kilo.sessions in main: sessions and panes in memory, with singleton kinds shown again. */
function fakeSessionsMain() {
	const opened: OpenPaneInput[] = [];
	let panes!: DomainProvider<typeof Panes>;
	const entry: PluginEntry = definePlugin({
		activate(sdk) {
			const unused = () => {
				throw new Error("unused");
			};
			sdk.domains.provide(WorkSessions, {
				initialState: { sessions: SESSIONS },
				methods: {
					create: unused,
					rename: unused,
					setPinned: unused,
					setArchived: unused,
					setWorktreeBranch: unused,
					remove: unused,
					importLegacyPins: unused,
					isolationOptions: () => null,
				},
			});
			panes = sdk.domains.provide(Panes, {
				initialState: { bySession: {} },
				methods: {
					open: (input) => {
						opened.push(input);
						const current = panes.state.bySession[input.sessionId] ?? EMPTY_WORK_SESSION_PANES;
						const existing = current.panes.find((pane) => pane.kind === input.kind);
						const pane: Pane = {
							id: existing?.id ?? `pane_${current.panes.length + 1}`,
							kind: input.kind,
							title: "Changes",
							metadata: input.metadata ?? existing?.metadata ?? {},
							ordinal: 1,
						};
						panes.setState({
							bySession: {
								...panes.state.bySession,
								[input.sessionId]: {
									...current,
									panes: [...current.panes.filter((p) => p.id !== pane.id), pane],
									activePaneId: pane.id,
								},
							},
						});
						return pane;
					},
					openObject: unused,
					activate: unused,
					update: unused,
					close: unused,
					setLayout: unused,
					setArrangement: unused,
					importLegacy: unused,
				},
			});
		},
	});
	return { entry, opened, panes: () => panes };
}

const workspacesMain: PluginEntry = definePlugin({
	activate(sdk) {
		const unused = () => {
			throw new Error("unused");
		};
		sdk.domains.provide(Workspaces, {
			initialState: { workspaces: [WORKSPACE], activeId: null, unavailableFolderIds: [] },
			methods: {
				create: unused,
				update: unused,
				remove: unused,
				setActive: unused,
				authorize: () => ({ allowed: false }),
				checkFolders: unused,
			},
		});
	},
});

const agentToolPoint = testPlugin("kilo.agent", {
	manifest: { extensionPoints: [{ id: "tool", kind: "additive" }] },
	definitions: { extensionPoints: [AgentTool] },
});

function context(sessionId: string | null): ToolCallContext {
	return {
		sessionId,
		chatId: sessionId ? "ses_chat" : null,
		callId: "call_1",
		external: sessionId === null,
		signal: new AbortController().signal,
	};
}

async function boot(options: { withoutPanes?: boolean } = {}) {
	const sessions = fakeSessionsMain();
	const { main } = await createTestKernelPair({
		main: [
			agentToolPoint,
			{
				manifest: sessionsManifest,
				definitions: SESSIONS_DEFINITIONS,
				...(options.withoutPanes ? {} : { entry: sessions.entry }),
			},
			{ manifest: workspacesManifest, definitions: WORKSPACES_DEFINITIONS, entry: workspacesMain },
			{
				manifest,
				definitions: GIT_DEFINITIONS,
				entry: createGitMainEntry({ createClient: () => ({}) as never }),
			},
		],
		renderer: [],
	});
	const tool = main.kernelSdk.extensions
		.list(AgentTool)
		.find((contribution) => contribution.key === "kilo.git/changes_open")!;
	const call = (input: unknown, sessionId: string | null) =>
		Promise.resolve(
			tool.implementation!.run(tool.implementation!.input.parse(input), context(sessionId)),
		);
	return { tool, call, sessions };
}

describe("the changes_open agent tool", () => {
	it("is offered to Kilo chats only, as Open changes", async () => {
		const { tool } = await boot();

		expect(tool.metadata).toMatchObject({
			title: "Open changes",
			external: false,
			readOnly: false,
		});
	});

	it("shows the calling session's Changes pane, keeping its folder when no path is given", async () => {
		const { call, sessions } = await boot();

		const result = await call({}, "local");

		expect(result).toEqual({ sessionId: "local", paneId: "pane_1" });
		expect(sessions.opened).toEqual([{ sessionId: "local", kind: CHANGES_PANE_KIND }]);
	});

	it("reveals a changed file in the folder holding it, reusing the session's pane", async () => {
		const { call, sessions } = await boot();
		await call({}, "local");

		const result = await call({ path: "/projects/docs/guide/intro.md" }, "local");

		expect(result).toEqual({
			sessionId: "local",
			paneId: "pane_1",
			workspaceDirectory: "/projects/docs",
			relativePath: "guide/intro.md",
		});
		const metadata = sessions.opened.at(-1)?.metadata;
		expect(metadata).toMatchObject({
			workspaceDirectory: "/projects/docs",
			revealPath: "guide/intro.md",
		});
		expect(metadata?.revealRequest).toMatch(/^[\w-]{36}$/);
		expect(sessions.panes().state.bySession.local?.panes).toHaveLength(1);

		await call({ path: "/projects/docs" }, "local");
		const again = sessions.opened.at(-1)?.metadata;
		expect(again).not.toHaveProperty("revealPath");
		expect(again?.revealRequest).not.toBe(metadata?.revealRequest);
	});

	it("reads relative paths against the session's worktree", async () => {
		const { call } = await boot();

		await expect(call({ path: "src/a.ts" }, "worktree")).resolves.toMatchObject({
			workspaceDirectory: "/projects/app/.kilo/worktrees/fix",
			relativePath: "src/a.ts",
		});
		await expect(call({ path: "/projects/app/src/a.ts" }, "worktree")).rejects.toThrow(
			'"/projects/app/src/a.ts" is outside this chat\'s workspace folders: /projects/app/.kilo/worktrees/fix, /projects/docs.',
		);
	});

	it("refuses callers without a session, a workspace or panes", async () => {
		const { call, sessions } = await boot();

		await expect(call({}, null)).rejects.toThrow("requires an originating Kilo chat session");
		await expect(call({}, "unscoped")).rejects.toThrow("This chat has no workspace folders");
		await expect(call({}, "gone")).rejects.toThrow("This chat has no workspace folders");
		expect(sessions.opened).toEqual([]);

		const withoutPanes = await boot({ withoutPanes: true });
		await expect(withoutPanes.call({}, "local")).rejects.toThrow(
			"The session's panes are unavailable.",
		);
	});
});
