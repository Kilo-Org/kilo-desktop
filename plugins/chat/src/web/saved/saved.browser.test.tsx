import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	SavedSource,
	type SavedSourceImplementation,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { paintedSavedRanges } from "@kilo-desktop/ui/lib/reading/saved-highlights";

import { chatPaneObject } from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import { assistantMessage, FakeKiloServer, userMessage } from "../../test/fake-kilo-server";
import { renderChat } from "../../test/render-chat";

afterEach(() => {
	vi.unstubAllGlobals();
});

const ANSWER =
	"The redirect breaks after sign-in.\n\nWe should keep the return URL in the session.";

const EARLIER_ANSWER = "Login reads the session cookie first.";

async function showReply({ earlierTurn = false } = {}) {
	const server = new FakeKiloServer();
	server.addChat({
		id: "ses_a",
		directory: "/projects/app",
		title: "Fix login",
		messages: [
			...(earlierTurn
				? [
						userMessage("ses_a", "msg_0", "Where does login start?"),
						assistantMessage("ses_a", "msg_00", "msg_0", [
							{ type: "text", text: EARLIER_ANSWER, time: { start: 1, end: 2 } },
						]),
					]
				: []),
			userMessage("ses_a", "msg_1", "Why does login fail?"),
			assistantMessage("ses_a", "msg_2", "msg_1", [
				{ type: "text", text: ANSWER, time: { start: 3, end: 4 } },
			]),
		],
	});
	const host = await renderChat({
		server,
		pane: agentPane({ object: chatPaneObject("ses_a") }),
		chats: [chatSummary("ses_a", { title: "Fix login" })],
	});
	await expect
		.element(page.getByText("We should keep the return URL in the session.").first())
		.toBeInTheDocument();
	return host;
}

/** Selects `text` inside the first element showing it, as a person dragging over it would. */
async function selectText(text: string, within: string) {
	const element = page.getByText(within).first().element();
	const node = [...element.childNodes].find(
		(child): child is Text => child instanceof Text && child.data.includes(text),
	)!;
	const start = node.data.indexOf(text);
	const range = document.createRange();
	range.setStart(node, start);
	range.setEnd(node, start + text.length);
	const selection = getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
	element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
}

describe("Save in the chat", () => {
	it("saves selected reply text, marks it in place, and offers View and Undo", async () => {
		const host = await showReply();

		await selectText("keep the return URL", "We should keep the return URL in the session.");
		await page.getByTestId("chat-selection-menu-save").click();

		await expect
			.poll(() =>
				host.workSessions.saved().state.items.map(({ text, source }) => ({ text, source })),
			)
			.toEqual([{ text: "keep the return URL", source: "kilo.chat/chat-text" }]);
		const item = host.workSessions.saved().state.items[0]!;
		expect(item).toMatchObject({
			title: "Fix login",
			ref: { type: "kilo.core/chat", id: "ses_a" },
		});
		await expect
			.poll(() => paintedSavedRanges().map((range) => range.toString()))
			.toEqual(["keep the return URL"]);
		const toast = page.getByRole("status");
		await expect.element(toast.getByText("Added to Saved")).toBeVisible();
		await expect.element(toast.getByRole("button", { name: "View" })).toBeVisible();
		await expect.element(page.getByTestId("chat-selection-menu-remove")).toBeVisible();
		await expect.element(page.getByTestId("chat-selection-menu-save")).not.toBeInTheDocument();

		await toast.getByRole("button", { name: "Undo" }).click();

		await expect.poll(() => host.workSessions.saved().state.items).toEqual([]);
		await expect.poll(() => paintedSavedRanges()).toEqual([]);
		await expect.element(page.getByTestId("chat-selection-menu")).not.toBeInTheDocument();
	});

	it("turns Save into Remove once saved, which takes the text straight back out", async () => {
		const host = await showReply();
		await selectText("keep the return URL", "We should keep the return URL in the session.");
		await page.getByTestId("chat-selection-menu-save").click();
		await expect.poll(() => host.workSessions.saved().state.items).toHaveLength(1);

		await page.getByTestId("chat-selection-menu-remove").click();

		await expect.poll(() => host.workSessions.saved().state.items).toEqual([]);
		await expect.element(page.getByRole("status").getByText("Removed from Saved")).toBeVisible();
		await expect.element(page.getByTestId("chat-selection-menu")).not.toBeInTheDocument();
	});

	it("offers Remove when clicking saved text, with Undo", async () => {
		const host = await showReply();
		await selectText("redirect breaks", "The redirect breaks after sign-in.");
		await page.getByTestId("chat-selection-menu-save").click();
		await expect.poll(() => host.workSessions.saved().state.items).toHaveLength(1);
		await page.getByTestId("chat-saved-toast-undo").element();

		const paragraph = page.getByText("The redirect breaks after sign-in.").first().element();
		const node = [...paragraph.childNodes].find((child): child is Text => child instanceof Text)!;
		const caret = document.createRange();
		caret.setStart(node, node.data.indexOf("breaks") + 2);
		caret.collapse(true);
		getSelection()!.removeAllRanges();
		getSelection()!.addRange(caret);
		paragraph.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

		await page.getByTestId("chat-selection-menu-remove").click();
		await expect.poll(() => host.workSessions.saved().state.items).toEqual([]);
		await expect.element(page.getByRole("status").getByText("Removed from Saved")).toBeVisible();
		await page.getByTestId("chat-saved-toast-undo").click();
		await expect.poll(() => host.workSessions.saved().state.items).toHaveLength(1);
	});

	it("offers the bookmark under the last reply only, moving to a new reply once it finishes", async () => {
		const host = await showReply({ earlierTurn: true });
		const bookmarkedReply = () =>
			page
				.getByTestId("chat-message-bookmark")
				.elements()
				.map((button) => button.closest("[data-message-id]")?.getAttribute("data-message-id"));
		await expect.poll(bookmarkedReply).toEqual(["msg_2"]);
		await page.getByText(EARLIER_ANSWER).hover();
		const earlier = page.getByText(EARLIER_ANSWER).element().closest("[data-message-id]")!;
		await vi.waitFor(() =>
			expect(earlier.querySelector(".aui-assistant-action-bar-root")).not.toBeNull(),
		);
		expect(bookmarkedReply()).toEqual(["msg_2"]);
		await vi.waitFor(() => expect(host.server.openStreams).toBeGreaterThan(0));

		const user = userMessage("ses_a", "msg_3", "And the redirect?");
		const reply = assistantMessage("ses_a", "msg_4", "msg_3", []);
		const { completed: _completed, ...running } = reply.info.time as {
			created: number;
			completed?: number;
		};
		host.server.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });
		host.server.emit("message.updated", { info: user.info });
		for (const part of user.parts) host.server.emit("message.part.updated", { part });
		host.server.emit("message.updated", {
			info: { ...reply.info, time: running, finish: undefined },
		});
		const part = {
			id: "part_live",
			sessionID: "ses_a",
			messageID: "msg_4",
			type: "text",
			text: "The redirect drops the return URL.",
			time: { start: running.created },
		};
		host.server.emit("message.part.updated", { part });
		await expect.element(page.getByText("The redirect drops the return URL.")).toBeInTheDocument();

		// Action rows hide while the agent works; the bookmark never joins the streaming reply.
		expect(bookmarkedReply()).not.toContain("msg_4");

		host.server.emit("message.part.updated", { part: { ...part, time: { start: 5, end: 6 } } });
		host.server.emit("message.updated", { info: reply.info });
		host.server.emit("session.status", { sessionID: "ses_a", status: { type: "idle" } });
		host.server.emit("session.idle", { sessionID: "ses_a" });
		await expect.poll(bookmarkedReply).toEqual(["msg_4"]);
	});

	it("bookmarks the chat from a reply's action row, filled while bookmarked", async () => {
		const host = await showReply();
		const button = page.getByTestId("chat-message-bookmark").last();
		await expect.element(button).toHaveAttribute("aria-pressed", "false");

		await button.click();

		await expect
			.poll(() =>
				host.workSessions.saved().state.items.map(({ source, text }) => ({ source, text })),
			)
			.toEqual([{ source: "kilo.chat/chat-bookmark", text: "" }]);
		await expect.element(button).toHaveAttribute("aria-pressed", "true");
		await expect.element(page.getByRole("status").getByText("Added to Saved")).toBeVisible();

		await button.click();
		await expect.poll(() => host.workSessions.saved().state.items).toEqual([]);
		await expect.element(button).toHaveAttribute("aria-pressed", "false");
	});

	it("opens a bookmarked chat from the Saved page at its latest message", async () => {
		const host = await showReply({ earlierTurn: true });
		await page.getByTestId("chat-message-bookmark").click();
		await expect.poll(() => host.workSessions.saved().state.items).toHaveLength(1);
		const item = host.workSessions.saved().state.items[0]!;
		expect(JSON.parse(item.anchor)).toEqual({ v: 1 });
		const viewport = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]')!;
		viewport.scrollTop = 0;
		const source = host.host.renderer.extensions
			.list(SavedSource)
			.find((candidate) => candidate.key === "kilo.chat/chat-bookmark")!;
		const reveal = (saved: typeof item) =>
			(source.implementation as SavedSourceImplementation).reveal(saved, { windowId: "main" });

		expect(await reveal(item)).toBe("exact");
		await expect
			.poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop)
			.toBeLessThan(2);

		viewport.scrollTop = 0;
		const older = { ...item, anchor: JSON.stringify({ v: 1, messageId: "msg_00" }) };
		expect(await reveal(older)).toBe("exact");
		await expect
			.poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop)
			.toBeLessThan(2);
	});

	it("goes back to saved text from the Saved page: opens the chat and finds the passage", async () => {
		const host = await showReply();
		await selectText("keep the return URL", "We should keep the return URL in the session.");
		await page.getByTestId("chat-selection-menu-save").click();
		await expect.poll(() => host.workSessions.saved().state.items).toHaveLength(1);
		const source = host.host.renderer.extensions
			.list(SavedSource)
			.find((candidate) => candidate.key === "kilo.chat/chat-text")!;
		expect(source.metadata).toMatchObject({ presentation: "quote", filter: "text" });

		const result = await (source.implementation as SavedSourceImplementation).reveal(
			host.workSessions.saved().state.items[0]!,
			{ windowId: "main" },
		);

		expect(result).toBe("exact");
		const unknown = await (source.implementation as SavedSourceImplementation).reveal(
			{ ...host.workSessions.saved().state.items[0]!, anchor: "not json" },
			{ windowId: "main" },
		);
		expect(unknown).toBe("unavailable");
	});
});
