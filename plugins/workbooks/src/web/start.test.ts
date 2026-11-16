import { afterEach, describe, expect, it } from "vitest";

import type { PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";

import { Composer } from "@kilo-desktop/plugin-chat/contracts";

import { SessionWorkbooks, Workbooks } from "../contracts";
import {
	bootWorkbooks,
	pageStart,
	type PageStarts,
	type StartedChat,
	type WorkSessionsControl,
} from "../test/hosts";
import { startFromWorkbook, startNewWorkbook, type StartDeps } from "./start";

const hosts: PluginHost[] = [];

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

async function boot() {
	const started: StartedChat[] = [];
	const workSessions: { current?: WorkSessionsControl } = {};
	const booted = await bootWorkbooks({ started, workSessions });
	hosts.push(booted.host);
	const objects = booted.host.renderer.kernelSdk.domainObjects;
	await expect.poll(() => objects.get(SessionWorkbooks)).not.toBeNull();
	const log: PageStarts = { opened: [], discarded: [] };
	const deps: StartDeps = {
		start: pageStart(log),
		workbooks: objects.get(Workbooks),
		sessions: objects.get(SessionWorkbooks),
		composer: objects.get(Composer),
	};
	return { ...booted, started, workSessions, deps, log, sessions: objects.get(SessionWorkbooks)! };
}

describe("starting a work session from a workbook", () => {
	it("creates the workbook, starts a chat with the kick-off left in the composer, and makes it active", async () => {
		const { deps, started, sessions, log } = await boot();

		const workSessionId = await startNewWorkbook(deps, {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "Fix the server bug",
			values: { goal: "Fix the bug" },
		});

		expect(started).toEqual([
			{ text: expect.stringContaining('"Fix the server bug"'), workSessionId },
		]);
		expect(log.opened).toEqual([workSessionId]);
		const text = started[0]!.text;
		expect(text).toContain("## First\n\nRefine the Brief");
		expect(text).toContain("## Brief\n\n**Workbook template:** Coding");
		expect(text).toContain("Fix the bug");
		expect(text).toContain("## How to work here\n\nThis is the agent guide");
		const workbookId = deps.workbooks!.getState().workbooks[0]!.id;
		await expect.poll(() => sessions.getState().bySession).toEqual({ [workSessionId]: workbookId });
		expect(sessions.lookup(workSessionId)).toBe(workbookId);
	});

	it("continues an existing workbook on a chosen item", async () => {
		const { deps, started } = await boot();
		const workbook = await deps.workbooks!.methods.create({
			workspaceId: "ws-1",
			templateId: "coding",
			name: "W",
			values: { goal: "g" },
		});

		await startFromWorkbook(deps, {
			workbookId: workbook.id,
			focus: "Plan step 2",
		});

		expect(started[0]!.text).toContain("## Work on this\n\nPlan step 2");
		expect(started[0]!.text).not.toContain("## First\n\n");
	});

	it("forgets a session's workbook when the session is deleted or the workbook forgotten", async () => {
		const { deps, sessions, workSessions } = await boot();
		const first = await startNewWorkbook(deps, {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "A",
			values: { goal: "g" },
		});
		const second = await startNewWorkbook(deps, {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "B",
			values: { goal: "g" },
		});
		await expect.poll(() => Object.keys(sessions.getState().bySession)).toEqual([first, second]);

		workSessions.current!.delete(first);
		await expect.poll(() => Object.keys(sessions.getState().bySession)).toEqual([second]);

		await deps.workbooks!.methods.forget({ id: sessions.lookup(second) as string });
		await expect.poll(() => sessions.getState().bySession).toEqual({});
	});

	it("clears a session's workbook and refuses an unknown one", async () => {
		const { deps, sessions } = await boot();
		const id = await startNewWorkbook(deps, {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "A",
			values: { goal: "g" },
		});

		await sessions.methods.setActive({ workSessionId: id, workbookId: null });
		await expect.poll(() => sessions.getState().bySession).toEqual({});
		await expect(
			sessions.methods.setActive({ workSessionId: id, workbookId: "nope" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("points at the Brief and guide when Pages can't be read", async () => {
		const { deps, started, pages } = await boot();
		const workbook = await deps.workbooks!.methods.create({
			workspaceId: "ws-1",
			templateId: "coding",
			name: "W",
			values: { goal: "g" },
		});
		pages.failOn = "read_page";

		await startFromWorkbook(deps, { workbookId: workbook.id });

		expect(started[0]!.text).toContain("Read the Brief (the project document) first.");
		expect(started[0]!.text).toContain('Read the "How to work here" page');
	});

	it("creates no session for a workbook it can't find, and discards one it couldn't record", async () => {
		const { deps, log, host } = await boot();

		await expect(startFromWorkbook(deps, { workbookId: "nope" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(log.opened).toEqual([]);

		const workbook = await host.invoke(Workbooks, "create", {
			workspaceId: "ws-1",
			templateId: "coding",
			name: "W",
			values: { goal: "g" },
		});
		const failing = {
			...deps,
			sessions: {
				...deps.sessions!,
				methods: {
					setActive: async () => {
						throw new Error("can't record");
					},
				},
			} as unknown as StartDeps["sessions"],
		};
		await expect(startFromWorkbook(failing, { workbookId: workbook.id })).rejects.toThrow(
			"can't record",
		);
		expect(log.discarded).toEqual(["wses_1"]);
		expect(log.opened).toEqual([]);
	});

	it("says what's missing when workbooks or chats aren't available", async () => {
		await expect(
			startFromWorkbook(
				{ workbooks: null, sessions: null, composer: null, start: pageStart() },
				{ workbookId: "w" },
			),
		).rejects.toThrow("Workbooks aren't available.");
		const { deps } = await boot();
		await expect(
			startFromWorkbook({ ...deps, composer: null }, { workbookId: "w" }),
		).rejects.toThrow("Chats aren't available in this window.");
	});
});
