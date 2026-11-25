import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { chatPaneObject, SUBAGENT_PANE_KIND, subagentPaneId } from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import { FakeKilo2Server } from "../../test/kilo2/fake-kilo2-server";
import {
	assistantMessage,
	idleMessage,
	session,
	tool,
	userMessage,
} from "../../test/kilo2/fixtures";
import { longSession } from "../../test/long-session";
import { renderChat } from "../../test/render-chat";
import {
	ManualDisclosureMemoryProvider,
	ManualDisclosureProvider,
	useManualDisclosure,
} from "../tools/activity-group";

afterEach(() => {
	vi.unstubAllGlobals();
});

const TURNS = 60;

async function openLongChat() {
	const server = new FakeKilo2Server();
	server.addChat(session("ses_a", { title: "Long chat" }), longSession(TURNS));
	const host = await renderChat({
		server,
		pane: agentPane({ object: chatPaneObject("ses_a") }),
		chats: [chatSummary("ses_a")],
	});
	await expect
		.element(page.getByText(`Final answer for turn ${TURNS}.`), { timeout: 15_000 })
		.toBeInTheDocument();
	return host;
}

const viewport = () => document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]')!;
const placeholders = () => document.querySelectorAll('[data-slot="aui_message-placeholder"]');
const hasText = (text: string) => document.body.textContent?.includes(text) ?? false;

describe("windowed transcript", () => {
	it("renders the messages near the end and keeps a placeholder, with its id, for every other", async () => {
		await openLongChat();

		await vi.waitFor(() => expect(placeholders().length).toBeGreaterThan(TURNS));
		expect(hasText("Final answer for turn 1.")).toBe(false);
		// Every turn is still in the transcript for the conversation map to find.
		expect(document.querySelectorAll("[data-message-id]")).toHaveLength(TURNS * 2);
		expect(document.querySelector('[data-message-id="msg_1_u"]')).not.toBeNull();
	});

	it("renders the oldest turn once the reader scrolls to it", async () => {
		await openLongChat();
		await vi.waitFor(() => expect(placeholders().length).toBeGreaterThan(TURNS));

		viewport().style.scrollBehavior = "auto";
		viewport().scrollTop = 0;

		await expect.element(page.getByText("Final answer for turn 1.")).toBeInTheDocument();
		await vi.waitFor(() => expect(hasText(`Final answer for turn ${TURNS - 10}.`)).toBe(false));
		// The current turn stays mounted wherever the reader is.
		expect(hasText(`Final answer for turn ${TURNS}.`)).toBe(true);
	});

	it("renders the oldest turn of a subagent's transcript once the reader scrolls to it", async () => {
		const delegation = tool(
			"subagent",
			{ agent: "explore", description: "Audit login", prompt: "Audit login" },
			"Done",
			{ id: "call_t1" },
		);
		const server = new FakeKilo2Server();
		server.addChat(session("ses_a", { title: "Chat" }), [
			userMessage("Audit login"),
			assistantMessage(
				[
					{
						...delegation,
						state: {
							...delegation.state,
							metadata: { sessionID: "ses_c1" },
						} as typeof delegation.state,
					},
				],
				{ finish: "stop", rawFinish: "stop" },
			),
			idleMessage(),
		]);
		server.addChat(session("ses_c1", { title: "Child", parentID: "ses_a" }), longSession(TURNS));
		await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
			otherPanes: [
				{
					id: subagentPaneId("ses_c1"),
					kind: SUBAGENT_PANE_KIND,
					title: "Audit login",
					object: chatPaneObject("ses_c1"),
					metadata: { chatId: "ses_a" },
					ordinal: 1,
				},
			],
		});
		const readonlyViewport = () =>
			document.querySelector<HTMLElement>('[data-slot="aui_readonly-thread-viewport"]')!;
		await expect
			.element(page.getByText(`Final answer for turn ${TURNS}.`), { timeout: 15_000 })
			.toBeInTheDocument();
		await vi.waitFor(() => expect(placeholders().length).toBeGreaterThan(TURNS));

		readonlyViewport().style.scrollBehavior = "auto";
		// Again until it holds: the viewport's autoscroll to the bottom may still be settling.
		await vi.waitFor(
			() => {
				readonlyViewport().scrollTop = 0;
				expect(hasText("Final answer for turn 1.")).toBe(true);
			},
			{ timeout: 15_000, interval: 250 },
		);
	});

	it("renders every message while the find bar is open, as find searches the page", async () => {
		await openLongChat();
		await vi.waitFor(() => expect(placeholders().length).toBeGreaterThan(TURNS));

		const mac = /mac/i.test(navigator.platform);
		window.dispatchEvent(
			new KeyboardEvent("keydown", { key: "f", code: "KeyF", metaKey: mac, ctrlKey: !mac }),
		);

		await expect.element(page.getByTestId("chat-find-bar")).toBeVisible();
		await vi.waitFor(() => expect(placeholders()).toHaveLength(0));
		expect(hasText("Final answer for turn 1.")).toBe(true);
	});
});

describe("manual disclosure memory", () => {
	function Detail() {
		const [open, setOpen] = useManualDisclosure("tool-1");
		return (
			<button type="button" onClick={() => setOpen(!open)}>
				{open ? "Open" : "Closed"}
			</button>
		);
	}

	it("keeps what the reader opened in a message that unmounts and comes back", async () => {
		const view = (shown: boolean) => (
			<ManualDisclosureMemoryProvider>
				{shown ? (
					<ManualDisclosureProvider scope="msg_1">
						<Detail />
					</ManualDisclosureProvider>
				) : null}
			</ManualDisclosureMemoryProvider>
		);
		const { rerender, container } = render(view(true));
		const button = () => container.querySelector("button");
		button()!.click();
		await vi.waitFor(() => expect(button()?.textContent).toBe("Open"));

		rerender(view(false));
		expect(button()).toBeNull();
		rerender(view(true));

		expect(button()?.textContent).toBe("Open");
	});
});
