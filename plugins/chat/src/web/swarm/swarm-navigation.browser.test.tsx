import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import type { TestKernelPair } from "@kilo-desktop/kernel/testing";

import {
	chatPaneObject,
	SUBAGENT_PANE_KIND,
	subagentPaneId,
	subagentPaneMetadata,
	subagentPaneParentChatId,
} from "../../contracts";
import { chatSummary } from "../../test/chat-host";
import { assistantMessage, FakeKiloServer, userMessage } from "../../test/fake-kilo-server";
import { renderInKernel } from "../../test/kernel-harness";
import { renderChat } from "../../test/render-chat";
import { toolPart } from "../../test/transcript";
import { ChatPaneOpeners } from "../panes/chat-pane-openers";
import { useOpenSubagentPane } from "../subagents/use-open-subagent-pane";
import { rosterTeam, swarmTeam } from "./swarm-team";

const hosts: TestKernelPair[] = [];
afterEach(async () => {
	cleanup();
	for (const host of hosts.splice(0)) {
		await host.renderer.deactivate();
		await host.main.stop();
	}
});

function OpenWorker() {
	const open = useOpenSubagentPane();
	return <button onClick={() => open?.("nested", "Nested worker", "worker")}>Open worker</button>;
}

describe("Swarm worker navigation", () => {
	it("retains actual parents and attention reasons in both live and restored teams", () => {
		const chats = {
			root: chatSummary("root", {
				activity: {
					status: "idle",
					pendingPermissionIds: ["root-permission"],
					pendingQuestionIds: [],
				},
			}),
			worker: chatSummary("worker", { parentId: "root" }),
			nested: chatSummary("nested", {
				parentId: "worker",
				activity: { status: "busy", pendingPermissionIds: [], pendingQuestionIds: ["question"] },
			}),
		};
		const live = swarmTeam("root", chats, []);
		expect(live[0]).toMatchObject({ needsYou: true, attention: ["permission"] });
		expect(live[2]).toMatchObject({
			parentChatId: "worker",
			needsYou: true,
			attention: ["question"],
		});

		const restored = rosterTeam(
			"root",
			chats,
			{
				truncated: false,
				members: [
					{
						chatId: "nested",
						parentChatId: "stale-parent",
						title: "Nested worker",
						directory: "/projects/app",
						state: "busy",
						live: true,
						startedAt: 1,
						attention: ["permission", "question"],
					},
					{
						chatId: "roster-only",
						parentChatId: "nested",
						title: "Restored worker",
						directory: "/projects/app",
						state: "offline",
						live: false,
						startedAt: 2,
						attention: [],
					},
				],
			},
			[],
		);
		expect(restored[1]).toMatchObject({
			parentChatId: "worker",
			attention: ["permission", "question"],
		});
		expect(restored[2]).toMatchObject({ parentChatId: "nested", attention: [] });
	});

	it("records the actual delegating parent when opening a nested worker from the root board", async () => {
		const host = await renderInKernel(
			<ChatPaneOpeners workSessionId="wses_1" chatId="root">
				<OpenWorker />
			</ChatPaneOpeners>,
		);
		hosts.push(host);

		await page.getByRole("button", { name: "Open worker" }).click();

		const opened = host.workSessions.calls.open.mock.calls[0]?.[0];
		expect(opened).toBeDefined();
		expect(subagentPaneParentChatId({ metadata: opened!.metadata ?? {} })).toBe("worker");
	});

	it("restores a nested transcript using Chats' actual parent rather than stale pane metadata", async () => {
		const server = new FakeKiloServer();
		server.addChat({ id: "root", title: "Root", directory: "/projects/app", messages: [] });
		server.addChat({
			id: "worker",
			title: "Worker",
			directory: "/projects/app",
			messages: [
				userMessage("worker", "msg_1", "Delegate the check"),
				assistantMessage("worker", "msg_2", "msg_1", [
					toolPart(
						"task",
						{
							status: "completed",
							input: { description: "Nested worker", subagent_type: "explore" },
							output: "Done",
							metadata: { sessionId: "nested" },
						},
						"call_nested",
					),
				]),
			],
		});
		server.addChat({
			id: "nested",
			title: "Nested worker",
			directory: "/projects/app",
			messages: [userMessage("nested", "nested_1", "The nested transcript is restored")],
		});
		const chat = await renderChat({
			server,
			chats: [
				chatSummary("root"),
				chatSummary("worker", { parentId: "root" }),
				chatSummary("nested", { parentId: "worker" }),
			],
			pane: {
				id: subagentPaneId("nested"),
				kind: SUBAGENT_PANE_KIND,
				title: "Nested worker",
				metadata: subagentPaneMetadata("root"),
				object: chatPaneObject("nested"),
				ordinal: 1,
			},
		});
		hosts.push(chat.host);

		await expect
			.element(
				page.getByTestId("subagent-pane-transcript").getByText("The nested transcript is restored"),
				{ timeout: 5_000 },
			)
			.toBeVisible();
	});
});
