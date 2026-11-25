import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { chatPaneObject } from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import { FakeKiloServer, nextCreated } from "../../test/fake-kilo-server";
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
	const server = new FakeKiloServer();
	server.addChat({
		id: "ses_a",
		directory: "/projects/app",
		title: "Long chat",
		messages: longSession(TURNS),
	});
	await renderChat({
		server,
		pane: agentPane({ object: chatPaneObject("ses_a") }),
		chats: [chatSummary("ses_a")],
	});
	await expect
		.element(page.getByText(`Final answer for turn ${TURNS}.`), { timeout: 15_000 })
		.toBeInTheDocument();
	await vi.waitFor(() => expect(server.openStreams).toBeGreaterThan(0));

	server.startTurn("ses_a");
	// The prompt arrives through the inbox, and the reply streams as v2 events.
	const user = { type: "user", payload: { text: "Go on" }, delivery: "steer" };
	server.emit("session.inbox.enqueued", { inboxID: "msg_live_u", sessionID: "ses_a", item: user });
	server.emit("session.inbox.delivered", { sessionID: "ses_a", inboxID: "msg_live_u" });
	const ids = { sessionID: "ses_a", assistantMessageID: "msg_live_a" };
	server.emit("session.step.started", {
		...ids,
		agent: "code",
		model: { providerID: "kilo", id: "test-model" },
		started: nextCreated(),
	});
	server.emit("session.text.started", { ...ids, ordinal: 0 });
	server.emit("session.text.delta", { ...ids, ordinal: 0, delta: "Streaming" });
	await expect.element(page.getByText("Streaming")).toBeInTheDocument();

	let delta = 0;
	/** Streams `count` tokens a frame apart, every 20th starting a paragraph. */
	const stream = async (count: number) => {
		for (let index = 0; index < count; index += 1, delta += 1) {
			server.emit("session.text.delta", {
				...ids,
				ordinal: 0,
				delta: delta % 20 === 19 ? "\n\nNext paragraph" : ` word${delta}`,
			});
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
