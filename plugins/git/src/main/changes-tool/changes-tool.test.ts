import { afterEach, describe, expect, it } from "vitest";

import { definePlugin } from "@kilo-desktop/kernel";
import { Tool, type ToolCallContext } from "@kilo-desktop/plugin-core/contracts";
import type { Workspace } from "@kilo-desktop/plugin-work-sessions/contracts";

import { CHANGES_PANE_KIND } from "../../contracts";
import { bootGitMain, stopGitMains, workSession } from "../test-boot";
import { activateChangesTool } from ".";

afterEach(stopGitMains);

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

const WORK_SESSIONS = [
	workSession("local"),
	workSession("worktree", {
		branch: "kilo/fix",
		directory: "/projects/app/.kilo/worktrees/fix",
	}),
	workSession("unscoped", { workspaceId: null, directory: "/chats/x" }),
];

function context(workSessionId: string | null): ToolCallContext {
	return {
		workSessionId,
		workspaceId: workSessionId ? "w1" : null,
		chatId: workSessionId ? "ses_chat" : null,
		callId: "call_1",
		external: workSessionId === null,
		signal: new AbortController().signal,
	};
}

async function boot(options: { withoutPanes?: boolean } = {}) {
	const host = await bootGitMain({
		entry: definePlugin({ activate: (sdk) => activateChangesTool(sdk) }),
		workSessions: {
			workSessions: WORK_SESSIONS,
			workspaces: [WORKSPACE],
			...(options.withoutPanes ? { withoutPanes: true } : {}),
		},
	});
	const tool = host.kernel.kernelSdk.extensions
		.list(Tool)
		.find((contribution) => contribution.key === "kilo.git/changes_open")!;
	const call = (input: unknown, workSessionId: string | null) =>
		Promise.resolve(
			tool.implementation!.run(tool.implementation!.input.parse(input), context(workSessionId)),
		);
	return { tool, call, workSessions: host.workSessions! };
}

describe("the changes_open agent tool", () => {
	it("is offered to Kilo chats only, as Open changes", async () => {
		const { tool } = await boot();

		expect(tool.metadata).toMatchObject({ title: "Open changes", external: false });
	});

	it("shows the calling work session's Changes pane, keeping its folder when no path is given", async () => {
		const { call, workSessions } = await boot();

		const result = await call({}, "local");

		expect(result).toEqual({ workSessionId: "local", paneId: "pane_1" });
		expect(workSessions.opened).toEqual([{ workSessionId: "local", kind: CHANGES_PANE_KIND }]);
	});

	it("reveals a changed file in the folder holding it, reusing the work session's pane", async () => {
		const { call, workSessions } = await boot();
		await call({}, "local");

		const result = await call({ path: "/projects/docs/guide/intro.md" }, "local");

		expect(result).toEqual({
			workSessionId: "local",
			paneId: "pane_1",
			workspaceDirectory: "/projects/docs",
			relativePath: "guide/intro.md",
		});
		const metadata = workSessions.opened.at(-1)?.metadata;
		expect(metadata).toMatchObject({
			workspaceDirectory: "/projects/docs",
			revealPath: "guide/intro.md",
		});
		expect(metadata?.revealRequest).toMatch(/^[\w-]{36}$/);
		expect(workSessions.panes().state.byWorkSession.local?.panes).toHaveLength(1);

		await call({ path: "/projects/docs" }, "local");
		const again = workSessions.opened.at(-1)?.metadata;
		expect(again).not.toHaveProperty("revealPath");
		expect(again?.revealRequest).not.toBe(metadata?.revealRequest);
	});

	it("reads relative paths against the work session's worktree", async () => {
		const { call } = await boot();

		await expect(call({ path: "src/a.ts" }, "worktree")).resolves.toMatchObject({
			workspaceDirectory: "/projects/app/.kilo/worktrees/fix",
			relativePath: "src/a.ts",
		});
		await expect(call({ path: "/projects/app/src/a.ts" }, "worktree")).rejects.toThrow(
			'"/projects/app/src/a.ts" is outside this chat\'s workspace folders: /projects/app/.kilo/worktrees/fix, /projects/docs.',
		);
	});

	it("refuses callers without a work session, a workspace or panes", async () => {
		const { call, workSessions } = await boot();

		await expect(call({}, null)).rejects.toThrow("requires an originating Kilo chat session");
		await expect(call({}, "unscoped")).rejects.toThrow("This chat has no workspace folders");
		await expect(call({}, "gone")).rejects.toThrow("This chat has no workspace folders");
		expect(workSessions.opened).toEqual([]);

		const withoutPanes = await boot({ withoutPanes: true });
		await expect(withoutPanes.call({}, "local")).rejects.toThrow(
			"The session's panes are unavailable.",
		);
	});

	it("is not offered without kilo.core's tool point, and activates quietly", async () => {
		const host = await bootGitMain({
			entry: definePlugin({ activate: (sdk) => activateChangesTool(sdk) }),
			core: null,
			workSessions: null,
		});

		expect(host.kernel.kernelSdk.extensions.list(Tool)).toEqual([]);
	});
});
