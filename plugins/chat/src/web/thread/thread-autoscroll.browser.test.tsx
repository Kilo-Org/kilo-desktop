import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { chatPaneObject } from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import { FakeKilo2Server, KILO2_BASE_URL } from "../../test/kilo2/fake-kilo2-server";
import { session } from "../../test/kilo2/fixtures";
import type { Turn } from "../../test/kilo2/turn";
import { longSession } from "../../test/long-session";
import { renderChat } from "../../test/render-chat";

afterEach(() => {
	vi.unstubAllGlobals();
});

const TURNS = 20;

const viewport = () => document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]')!;
const distanceFromBottom = () => {
	const element = viewport();
	return element.scrollHeight - element.clientHeight - element.scrollTop;
};
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Opens a long chat whose next reply is streaming; `stream` sends it more tokens. */
async function openStreamingChat() {
	const server = new FakeKilo2Server();
	server.addChat(session("ses_a", { title: "Long chat" }), longSession(TURNS));
	await renderChat({
		server,
		pane: agentPane({ object: chatPaneObject("ses_a") }),
		chats: [chatSummary("ses_a")],
	});
	await expect
		.element(page.getByText(`Final answer for turn ${TURNS}.`), { timeout: 15_000 })
		.toBeInTheDocument();
	await vi.waitFor(() => expect(server.openStreams).toBeGreaterThan(0));

	let live: Turn | undefined;
	server.replies.push((turn) => {
		live = turn;
	});
	// Prompted from another client, as v1's test had the server deliver it: a
	// prompt sent from this composer would scroll its turn to the top instead.
	const { username, password } = server.connection;
	await server.fetch(`${KILO2_BASE_URL}/api/session/ses_a/prompt`, {
		method: "POST",
		headers: {
			authorization: `Basic ${btoa(`${username}:${password}`)}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ text: "Go on" }),
	});
	await expect.element(page.getByText("Go on")).toBeInTheDocument();
	expect(live).toBeDefined();
	// The reply's text part is streamed by hand, a delta a frame, as kilo2 streams tokens.
	const assistantMessageID = live!.step().message.id;
	server.emit("session.text.started", { assistantMessageID, ordinal: 0 }, "ses_a");
	server.emit(
		"session.text.delta",
		{ assistantMessageID, ordinal: 0, delta: "Streaming" },
		"ses_a",
	);
	await expect.element(page.getByText("Streaming")).toBeInTheDocument();

	let delta = 0;
	/** Streams `count` tokens a frame apart, every 20th starting a paragraph. */
	const stream = async (count: number) => {
		for (let index = 0; index < count; index += 1, delta += 1) {
			server.emit(
				"session.text.delta",
				{
					assistantMessageID,
					ordinal: 0,
					delta: delta % 20 === 19 ? "\n\nNext paragraph" : ` word${delta}`,
				},
				"ses_a",
			);
			await nextFrame();
		}
	};
	await stream(40);
	await vi.waitFor(() => expect(distanceFromBottom()).toBeLessThan(2));
	return { stream };
}

describe("following a streamed reply", () => {
	it("follows the reply while the reader stays at the bottom", async () => {
		const { stream } = await openStreamingChat();

		await stream(40);

		await vi.waitFor(() => expect(distanceFromBottom()).toBeLessThan(2));
	});

	it("stops following once the reader scrolls up, while tokens keep arriving", async () => {
		const { stream } = await openStreamingChat();

		await Promise.all([userEvent.wheel(viewport(), { direction: "up", times: 6 }), stream(30)]);
		const away = distanceFromBottom();
		await stream(60);

		expect(away).toBeGreaterThan(400);
		expect(distanceFromBottom()).toBeGreaterThanOrEqual(away);
	});

	it("keeps the last message clear of the docked composer", async () => {
		const { stream } = await openStreamingChat();
		await stream(40);
		const composer = document.querySelector<HTMLElement>("[data-qa-id='kilo-composer-dock']")!;
		const lastMessage = [...document.querySelectorAll<HTMLElement>("[data-message-id]")].at(-1)!;

		await vi.waitFor(() =>
			expect(lastMessage.getBoundingClientRect().bottom).toBeLessThanOrEqual(
				composer.getBoundingClientRect().top,
			),
		);
	});

	it("stops following after a scroll up shorter than the docked composer", async () => {
		const { stream } = await openStreamingChat();
		const footer = document.querySelector<HTMLElement>(".aui-thread-viewport-footer")!;

		await userEvent.wheel(viewport(), { delta: { y: -footer.offsetHeight / 2 } });
		await stream(40);

		expect(distanceFromBottom()).toBeGreaterThan(footer.offsetHeight / 4);
	});
});
