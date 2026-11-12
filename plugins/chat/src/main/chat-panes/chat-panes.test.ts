import { describe, expect, it } from "vitest";

import { ref } from "@kilo-desktop/kernel";
import { Chat } from "@kilo-desktop/plugin-core/contracts";
import {
	EMPTY_WORK_SESSION_PANES,
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

const record = (...panes: Pane[]): WorkSessionPanes => ({
	...EMPTY_WORK_SESSION_PANES,
	panes,
	activePaneId: panes[0]?.id ?? null,
});

describe("agent panes for chat-adopted work sessions", () => {
	it("opens the first chat of a work session that has chats but no panes, and leaves the rest alone", async () => {
		const { workSessions } = await bootChatMain({
			chats: [chat("ses_a"), chat("ses_b"), chat("ses_c")],
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

	it("is busy while the pane's chat works, and clears when it is idle", async () => {
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
		expect(statuses()).toMatchObject({ pane_a: null, "subagent:ses_child": null });
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
