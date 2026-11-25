// Checks the test hosts every kilo.chat area builds on.
import { describe, expect, it, vi } from "vitest";

import { definePlugin } from "@kilo-desktop/kernel";
import { useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Chats, Models } from "@kilo-desktop/plugin-core/contracts";
import {
	PaneKind,
	WorkSessions,
	WorkSessionsWindow,
	type PaneProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import { testWebEntry } from "@kilo-desktop/plugin-work-sessions/testing";

import { paneChatId } from "../contracts";
import { chatSummary, renderAgentPane, workSession } from "./chat-host";
import { renderInKernel } from "./kernel-harness";
import { FakeKilo2Server } from "./kilo2/fake-kilo2-server";
import { questionForm } from "./kilo2/fixtures";

function AgentPaneProbe({ pane }: PaneProps) {
	const chatId = paneChatId(pane);
	return <p data-qa-id="probe">{chatId ?? "draft"}</p>;
}

const probeWeb = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(PaneKind, "agent", { component: AgentPaneProbe });
	},
});

describe("renderAgentPane", () => {
	it("renders the open work session's agent pane through kilo.chat's pane kind", async () => {
		const host = await renderAgentPane({
			chatWeb: probeWeb,
			workSession: workSession({ chatIds: ["ses_a"] }),
			chats: [chatSummary("ses_a")],
		});

		await vi.waitFor(() =>
			expect(document.querySelector('[data-qa-id="probe"]')?.textContent).toBe("ses_a"),
		);
		expect(
			host.host.renderer.kernelSdk.domainObjects.get(WorkSessionsWindow)?.getState(),
		).toMatchObject({
			activeWorkSessionId: "wses_1",
		});
	});

	it("can leave the canvas to kilo.work-sessions' real window entry", async () => {
		await renderAgentPane({
			chatWeb: probeWeb,
			workSessionsWeb: testWebEntry,
			workSession: workSession({ chatIds: ["ses_a"] }),
			chats: [chatSummary("ses_a")],
		});

		await vi.waitFor(
			() => expect(document.querySelector('[data-qa-id="probe"]')?.textContent).toBe("ses_a"),
			{ timeout: 10_000 },
		);
	});

	it("creates chats in the work session and sends prompts to the server", async () => {
		const host = await renderAgentPane({ chatWeb: probeWeb });
		const sdk = host.host.renderer.sdkFor("kilo.chat");

		const workSessions = sdk.domainObjects.get(WorkSessions)!;
		const chat = await workSessions.methods.createChat({ id: "wses_1" });
		await vi.waitFor(() =>
			expect(workSessions.getState().workSessions[0]?.chatIds).toContain(chat.id),
		);
		await sdk.domainObjects.get(Chats)!.methods.prompt({
			chatId: chat.id,
			parts: [{ type: "text", text: "Hello" }],
			model: { aiProviderId: "acme", modelId: "deep-2", variant: "high" },
		});

		expect(
			host.server.requestsTo("POST", `/session/${chat.id}/prompt_async`)[0]?.body,
		).toMatchObject({
			parts: [{ type: "text", text: "Hello" }],
			model: { providerID: "acme", modelID: "deep-2" },
			variant: "high",
		});
		expect(host.core.calls.create).toHaveBeenCalledWith(
			expect.objectContaining({ workSessionId: "wses_1", workspaceId: "w-app" }),
		);
	});

	it("follows the server's pending permissions on the chat", async () => {
		const host = await renderAgentPane({ chatWeb: probeWeb, chats: [chatSummary("ses_a")] });
		const chats = host.host.renderer.kernelSdk.domainObjects.get(Chats)!;

		host.server.askPermission("ses_a", { id: "per_1", permission: "bash" });
		await vi.waitFor(() =>
			expect(chats.getState().chats.ses_a?.activity.pendingPermissionIds).toEqual(["per_1"]),
		);
		await host.host.renderer
			.sdkFor("kilo.chat")
			.domainObjects.get(Chats)!
			.methods.replyPermission({ chatId: "ses_a", permissionId: "per_1", decision: "once" });
		await vi.waitFor(() =>
			expect(chats.getState().chats.ses_a?.activity.pendingPermissionIds).toEqual([]),
		);
	});
});

describe("renderAgentPane on the Kilo v2 fake", () => {
	it("creates chats, sends prompts and follows a turn through v2 calls and events", async () => {
		const kilo2 = new FakeKilo2Server();
		kilo2.replies.push([[{ type: "text", text: "Hi there" }]]);
		const host = await renderAgentPane({ chatWeb: probeWeb, kilo2 });
		const sdk = host.host.renderer.sdkFor("kilo.chat");
		const workSessions = sdk.domainObjects.get(WorkSessions)!;
		const chats = sdk.domainObjects.get(Chats)!;
		const ended: string[] = [];
		chats.on("turn-ended", ({ chatId }) => ended.push(chatId));

		const chat = await workSessions.methods.createChat({ id: "wses_1" });
		await chats.methods.prompt({
			chatId: chat.id,
			parts: [{ type: "text", text: "Hello" }],
			model: { aiProviderId: "acme", modelId: "deep-2", variant: "high" },
		});

		await vi.waitFor(() => expect(ended).toEqual([chat.id]));
		expect(kilo2.chat(chat.id)).toMatchObject({
			model: { providerID: "acme", id: "deep-2", variant: "high" },
			metadata: { "kilo-desktop": { workSessionId: "wses_1", workspaceId: "w-app" } },
		});
		expect(kilo2.requestsTo("POST", `/api/session/${chat.id}/prompt`)[0]?.body).toMatchObject({
			text: "Hello",
		});
		expect(kilo2.messages(chat.id).map((message) => message.type)).toEqual([
			"user",
			"assistant",
			"idle",
		]);
	});

	it("follows v2 permissions and question forms on the chat", async () => {
		const kilo2 = new FakeKilo2Server();
		const host = await renderAgentPane({ chatWeb: probeWeb, kilo2, chats: [chatSummary("ses_a")] });
		const chats = host.host.renderer.sdkFor("kilo.chat").domainObjects.get(Chats)!;
		const activity = () => chats.getState().chats.ses_a?.activity;

		const asked = kilo2.askPermission("ses_a", { action: "shell", resources: ["ls"] });
		const form = kilo2.createForm(
			questionForm("ses_a", [{ question: "Which?", header: "Pick", options: ["A", "B"] }]),
		);
		await vi.waitFor(() =>
			expect(activity()).toMatchObject({
				pendingPermissionIds: [asked.id],
				pendingQuestionIds: [form.id],
			}),
		);
		await chats.methods.replyPermission({
			chatId: "ses_a",
			permissionId: asked.id,
			decision: "once",
		});
		await chats.methods.replyQuestion({ chatId: "ses_a", questionId: form.id, answers: [["B"]] });

		await vi.waitFor(() =>
			expect(activity()).toMatchObject({ pendingPermissionIds: [], pendingQuestionIds: [] }),
		);
		expect(kilo2.published.find((frame) => frame.type === "form.replied")?.data.answer).toEqual({
			q0: "B",
		});
	});
});

describe("renderInKernel", () => {
	it("renders as kilo.chat with kilo.core's models", async () => {
		function Models_() {
			const names = useDomainObjectState(Models, (state) =>
				Object.values(state.models)
					.map((model) => model.name)
					.join(", "),
			);
			return <p data-qa-id="models">{names}</p>;
		}
		const host = await renderInKernel(<Models_ />);

		await vi.waitFor(() =>
			expect(document.querySelector('[data-qa-id="models"]')?.textContent).toBe(
				"Fast One, Deep Two",
			),
		);
		await host.renderer.sdkFor("kilo.chat").domainObjects.get(Models)!.methods.setFavorite({
			aiProviderId: "acme",
			modelId: "fast-1",
			favorite: true,
		});
		expect(host.core.models().state.preferences.favorites).toEqual([
			{ aiProviderId: "acme", modelId: "fast-1" },
		]);
	});
});
