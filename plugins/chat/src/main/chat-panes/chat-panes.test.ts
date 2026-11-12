import { describe, expect, it } from "vitest";

import { ref } from "@kilo-desktop/kernel";
import { Chat } from "@kilo-desktop/plugin-core/contracts";
import {
	EMPTY_WORK_SESSION_PANES,
	Panes,
	WorkSessions,
	type Pane,
	type WorkSessionPanes,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	AGENT_PANE_KIND,
	chatPaneObject,
	SUBAGENT_PANE_KIND,
	subagentPaneId,
	subagentPaneMetadata,
} from "../../contracts";
import { agentPane, workSession } from "../../test/fake-work-sessions";
import { bootChatMain, chat, settle } from "../test-boot";
import { chatPaneStatus } from "./index";

/** A saved pane layout (kilo.work-sessions' canvas format): one group per entry, its first tab shown. */
const savedLayout = (...groups: string[][]) =>
	JSON.stringify({
		groups: groups.map((tabs) => ({
			id: `group:${tabs[0]}`,
			tabs: tabs.map((id) => ({ id, kind: "agent", title: id })),
			activePaneId: tabs[0],
			preferredWidth: 480,
			minWidth: 240,
			pinned: false,
		})),
		activePaneId: groups[0]![0],
		sizes: {},
	});

const record = (...panes: Pane[]): WorkSessionPanes => ({
	...EMPTY_WORK_SESSION_PANES,
	panes,
	activePaneId: panes[0]?.id ?? null,
});

describe("agent panes for chat-adopted work sessions", () => {
	it("opens the first chat of a work session that has chats but no panes, and leaves the rest alone", async () => {
		const { workSessions } = await bootChatMain({
			chats: [chat("ses_a", { title: "From the CLI" }), chat("ses_b"), chat("ses_c")],
			workSessions: {
				workSessions: [
					workSession({ id: "wses_adopted", title: "From the CLI", chatIds: ["ses_a", "ses_c"] }),
					workSession({ id: "wses_emptied", chatIds: ["ses_b"] }),
					workSession({ id: "wses_chatless" }),
				],
				panes: { wses_emptied: { ...EMPTY_WORK_SESSION_PANES } },
			},
		});
		await settle();

		expect(workSessions!.panesOf("wses_adopted")).toEqual({
			panes: [
				{
					id: "agent:wses_adopted",
					kind: AGENT_PANE_KIND,
					title: "From the CLI",
					object: ref(Chat, "ses_a"),
					metadata: {},
					ordinal: 1,
				},
			],
			activePaneId: "agent:wses_adopted",
			layout: null,
			arrangement: "tiles",
		});
		expect(workSessions!.panesOf("wses_emptied").panes).toEqual([]);
		expect(workSessions!.panes().state.byWorkSession.wses_chatless).toBeUndefined();
		expect(workSessions!.calls.open).toHaveBeenCalledTimes(1);
	});

	it("opens one for a work session made from a chat, not for a person's new one", async () => {
		const { workSessions, kernel } = await bootChatMain({
			chats: [chat("ses_new")],
			workSessions: { workSessions: [] },
		});
		const provider = workSessions!.workSessions();

		const adopted = workSession({ id: "wses_adopted", chatIds: ["ses_new"] });
		provider.setState({ workSessions: [adopted] });
		provider.emit("created", { workSession: adopted });
		await kernel.kernelSdk.domainObjects.get(WorkSessions)!.methods.create({});
		await settle();

		expect(workSessions!.panesOf("wses_adopted").panes.map((pane) => pane.id)).toEqual([
			"agent:wses_adopted",
		]);
		expect(workSessions!.calls.open).toHaveBeenCalledTimes(1);
	});
});

describe("agent pane titles", () => {
	it("names each agent pane after its chat, follows renames, and calls a draft New chat", async () => {
		const { core, workSessions } = await bootChatMain({
			chats: [
				chat("ses_a", { title: "Fix login", workSessionId: "wses_1" }),
				chat("ses_b", { title: "", workSessionId: "wses_1" }),
			],
			workSessions: {
				workSessions: [workSession({ chatIds: ["ses_a", "ses_b"] })],
				panes: {
					wses_1: record(
						agentPane({ id: "pane_a", object: chatPaneObject("ses_a") }),
						agentPane({ id: "pane_b", object: chatPaneObject("ses_b"), ordinal: 2 }),
						agentPane({ id: "pane_draft", ordinal: 3 }),
						{
							id: "pane_files",
							kind: "kilo.files/file",
							title: "notes.md",
							metadata: {},
							ordinal: 1,
						},
					),
				},
			},
		});
		const titles = () =>
			Object.fromEntries(
				workSessions!.panesOf("wses_1").panes.map((pane) => [pane.id, pane.title]),
			);
		await settle();
		expect(titles()).toEqual({
			pane_a: "Fix login",
			pane_b: "New chat",
			pane_draft: "New chat",
			pane_files: "notes.md",
		});

		core.upsert(chat("ses_b", { title: "Add tests", workSessionId: "wses_1" }));
		await settle();
		expect(titles()).toMatchObject({ pane_b: "Add tests" });
	});

	it("leaves titles alone while kilo.core is away", async () => {
		const { workSessions } = await bootChatMain({
			withoutCore: true,
			workSessions: {
				panes: { wses_1: record(agentPane({ object: chatPaneObject("ses_a"), title: "Agent" })) },
			},
		});
		await settle();
		expect(workSessions!.panesOf("wses_1").panes[0]?.title).toBe("Agent");
	});
});

describe("pane status", () => {
	async function boot() {
		const booted = await bootChatMain({
			chats: [
				chat("ses_a", { workSessionId: "wses_1" }),
				chat("ses_child", { parentId: "ses_a", workSessionId: "wses_1" }),
				chat("ses_b", { workSessionId: "wses_1" }),
			],
			removableCore: true,
			workSessions: {
				workSessions: [workSession({ chatIds: ["ses_a", "ses_b"] })],
				panes: {
					wses_1: record(
						agentPane({ id: "pane_a", object: chatPaneObject("ses_a") }),
						agentPane({ id: "pane_b", object: chatPaneObject("ses_b"), ordinal: 2 }),
						{
							id: subagentPaneId("ses_child"),
							kind: SUBAGENT_PANE_KIND,
							title: "Subagent",
							object: chatPaneObject("ses_child"),
							metadata: subagentPaneMetadata("ses_a"),
							ordinal: 1,
						},
						{ id: "pane_files", kind: "kilo.files/file", title: "File", metadata: {}, ordinal: 1 },
					),
				},
			},
		});
		const statuses = () =>
			Object.fromEntries(
				booted.workSessions!.panesOf("wses_1").panes.map((pane) => [pane.id, pane.status ?? null]),
			);
		return { ...booted, statuses };
	}

	it("is busy while the pane's chat works, and clears when it is idle on screen", async () => {
		const { core, statuses } = await boot();
		await settle();
		expect(statuses()).toEqual({
			pane_a: null,
			pane_b: null,
			"subagent:ses_child": null,
			pane_files: null,
		});

		core.setStatus("ses_a", "busy");
		core.setStatus("ses_child", "retry");
		await settle();
		expect(statuses()).toMatchObject({
			pane_a: "busy",
			pane_b: null,
			"subagent:ses_child": "busy",
		});

		core.setStatus("ses_a", "idle");
		core.setStatus("ses_child", "idle");
		await settle();
		// pane_a is the shown tab; the subagent's tab isn't, so it is left unread.
		expect(statuses()).toMatchObject({ pane_a: null, "subagent:ses_child": "unread" });
	});

	it("asks for attention while the chat or one of its subagents waits on a permission or question", async () => {
		const { core, statuses } = await boot();
		core.setStatus("ses_a", "busy");
		core.setActivity("ses_child", { status: "busy", pendingQuestionIds: ["que_1"] });
		await settle();
		expect(statuses()).toMatchObject({ pane_a: "attention", "subagent:ses_child": "attention" });

		core.setActivity("ses_child", { pendingQuestionIds: [] });
		core.setActivity("ses_b", { pendingPermissionIds: ["per_1"] });
		await settle();
		expect(statuses()).toMatchObject({
			pane_a: "busy",
			pane_b: "attention",
			"subagent:ses_child": "busy",
		});
	});

	it("leaves a draft agent pane unbadged by the work session's closed chat", async () => {
		const { core, workSessions } = await bootChatMain({
			chats: [chat("ses_a")],
			workSessions: {
				workSessions: [workSession({ chatIds: ["ses_a"] })],
				panes: { wses_1: record(agentPane()) },
			},
		});
		core.setStatus("ses_a", "busy");
		await settle();

		expect(workSessions!.panesOf("wses_1").panes[0]?.status).toBeUndefined();
	});

	it("clears every badge while kilo.core is away, and a badge saved from an earlier run", async () => {
		const { core, statuses, setCorePresent } = await boot();
		core.setStatus("ses_a", "busy");
		await settle();
		expect(statuses()).toMatchObject({ pane_a: "busy" });

		await setCorePresent(false);
		await settle();
		expect(statuses()).toMatchObject({ pane_a: null });

		const saved = await bootChatMain({
			withoutCore: true,
			workSessions: {
				panes: { wses_1: record(agentPane({ object: chatPaneObject("ses_a"), status: "busy" })) },
			},
		});
		await settle();
		expect(saved.workSessions!.panesOf("wses_1").panes[0]?.status).toBeUndefined();
	});

	it("says nothing for a chat that isn't listed or before the list is read", () => {
		const idle = chat("ses_a");
		expect(chatPaneStatus(null, "ses_a")).toBeNull();
		expect(chatPaneStatus({ ready: true, chats: {}, declinedSignInTools: [] }, "ses_a")).toBeNull();
		expect(
			chatPaneStatus(
				{
					ready: false,
					chats: { ses_a: { ...idle, activity: { ...idle.activity, status: "busy" } } },
					declinedSignInTools: [],
				},
				"ses_a",
			),
		).toBeNull();
		expect(
			chatPaneStatus({ ready: true, chats: { ses_a: idle }, declinedSignInTools: [] }, null),
		).toBeNull();
	});
});

describe("unread panes", () => {
	async function boot() {
		const booted = await bootChatMain({
			chats: [
				chat("ses_a", { workSessionId: "wses_1" }),
				chat("ses_b", { workSessionId: "wses_1" }),
			],
			workSessions: {
				workSessions: [workSession({ chatIds: ["ses_a", "ses_b"] })],
				panes: {
					wses_1: record(
						agentPane({ id: "pane_a", object: chatPaneObject("ses_a") }),
						agentPane({ id: "pane_b", object: chatPaneObject("ses_b"), ordinal: 2 }),
					),
				},
			},
		});
		const panes = booted.as("kilo.work-sessions").get(Panes)!;
		const status = (paneId: string) =>
			booted.workSessions!.panesOf("wses_1").panes.find((pane) => pane.id === paneId)?.status ??
			null;
		return { ...booted, panes, status };
	}

	it("marks a chat that finishes off screen unread until its tab is shown", async () => {
		const { core, panes, status } = await boot();
		core.setStatus("ses_a", "busy");
		core.setStatus("ses_b", "busy");
		await settle();
		core.setStatus("ses_a", "idle");
		core.setStatus("ses_b", "idle");
		await settle();
		expect([status("pane_a"), status("pane_b")]).toEqual([null, "unread"]);

		core.setStatus("ses_b", "busy");
		await settle();
		expect(status("pane_b")).toBe("busy");
		core.setStatus("ses_b", "idle");
		await settle();
		expect(status("pane_b")).toBe("unread");

		await panes.methods.activate({ workSessionId: "wses_1", paneId: "pane_b" });
		await settle();
		expect(status("pane_b")).toBeNull();
	});

	it("counts every group's shown tab as on screen", async () => {
		const { core, panes, status } = await boot();
		await panes.methods.setLayout({
			workSessionId: "wses_1",
			layout: savedLayout(["pane_a"], ["pane_b"]),
			activePaneId: "pane_a",
		});
		core.setStatus("ses_b", "busy");
		await settle();
		core.setStatus("ses_b", "idle");
		await settle();

		expect(status("pane_b")).toBeNull();
	});

	it("follows a tab shown without the layout being saved again (the Agents menu, a reopen)", async () => {
		const { core, panes, status } = await boot();
		await panes.methods.setLayout({
			workSessionId: "wses_1",
			layout: savedLayout(["pane_a", "pane_b"]),
			activePaneId: "pane_a",
		});
		await panes.methods.activate({ workSessionId: "wses_1", paneId: "pane_b" });
		core.setStatus("ses_a", "busy");
		core.setStatus("ses_b", "busy");
		await settle();
		core.setStatus("ses_a", "idle");
		core.setStatus("ses_b", "idle");
		await settle();

		expect([status("pane_a"), status("pane_b")]).toEqual(["unread", null]);
	});

	it("keeps unread while kilo.core's chats are not read yet", async () => {
		const saved = await bootChatMain({
			withoutCore: true,
			workSessions: {
				panes: {
					wses_1: record(
						agentPane({ id: "pane_a" }),
						agentPane({ id: "pane_b", object: chatPaneObject("ses_b"), status: "unread" }),
					),
				},
			},
		});
		await settle();
		expect(saved.workSessions!.panesOf("wses_1").panes[1]?.status).toBe("unread");
	});
});
