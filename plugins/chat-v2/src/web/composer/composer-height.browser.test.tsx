import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { chatPaneObject } from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import {
	assistantMessage,
	FakeKiloServer,
	textContent,
	userMessage,
} from "../../test/fake-kilo-server";
import { renderChat } from "../../test/render-chat";

afterEach(() => {
	vi.unstubAllGlobals();
});

const longPrompt = "Review this paragraph carefully before sending. ".repeat(120);

const input = () => page.getByTestId("kilo-composer-input");
const handle = () => page.getByRole("separator", { name: "Resize message input" });

function inputBox(): HTMLElement {
	const box = document.querySelector<HTMLElement>(".aui-composer-input");
	if (!box) throw new Error("Composer input was not rendered");
	return box;
}

function threadRoot(): HTMLElement {
	const root = document.querySelector<HTMLElement>('[data-qa-id="kilo-chat-thread"]');
	if (!root) throw new Error("Thread was not rendered");
	return root;
}

/** A chat that already has messages, so its composer is not a draft. */
async function showChat() {
	const server = new FakeKiloServer();
	server.addChat({
		id: "ses_a",
		directory: "/projects/app",
		title: "Chat",
		messages: [userMessage("msg_1", "Hello"), assistantMessage("msg_2", [textContent("Hi there")])],
	});
	const host = await renderChat({
		server,
		pane: agentPane({ object: chatPaneObject("ses_a") }),
		chats: [chatSummary("ses_a")],
	});
	await expect.element(page.getByText("Hi there")).toBeVisible();
	return host;
}

async function expectInputAtPaneShare(share: number) {
	await expect
		.poll(() => Math.abs(inputBox().offsetHeight - threadRoot().clientHeight * share))
		.toBeLessThanOrEqual(1);
}

async function fillToCap() {
	await userEvent.fill(input(), longPrompt);
	await expect.element(handle()).toBeVisible();
}

function focusHandle() {
	(handle().element() as HTMLElement).focus();
}

describe("the composer's height", () => {
	it("grows a chat's composer up to half the pane, then scrolls", async () => {
		await showChat();

		await userEvent.fill(input(), longPrompt);

		await expect.poll(() => inputBox().offsetHeight).toBeGreaterThan(128);
		await expectInputAtPaneShare(0.5);
		expect(inputBox().scrollHeight).toBeGreaterThan(inputBox().clientHeight);
	});

	it("keeps a new chat's composer at its compact cap, without a resize edge", async () => {
		await renderChat();
		await expect.element(input()).toBeVisible();

		expect(getComputedStyle(inputBox()).maxHeight).toBe("128px");
		await expect.element(handle()).not.toBeInTheDocument();
	});
});

describe("the composer's resize edge", () => {
	it("appears only once typing reaches half the pane", async () => {
		await showChat();

		await userEvent.fill(input(), "A short prompt");
		await expect.element(input()).toHaveTextContent("A short prompt");
		await expect.element(handle()).not.toBeInTheDocument();

		await fillToCap();

		await expect.element(handle()).toHaveAttribute("aria-valuenow", "50");
	});

	it("resizes between half and 70% of the pane from the keyboard", async () => {
		await showChat();
		await fillToCap();
		focusHandle();

		await userEvent.keyboard("{End}");
		await expectInputAtPaneShare(0.7);
		await expect.element(handle()).toHaveAttribute("aria-valuenow", "70");

		await userEvent.keyboard("{ArrowUp}");
		await expect.element(handle()).toHaveAttribute("aria-valuenow", "70");

		await userEvent.keyboard("{ArrowDown}");
		await expect.element(handle()).toHaveAttribute("aria-valuenow", "68");
		await expectInputAtPaneShare(0.68);

		await userEvent.keyboard("{Home}");
		await expect.element(handle()).toHaveAttribute("aria-valuenow", "50");
		await expectInputAtPaneShare(0.5);
	});

	it("holds the dragged height when the text is shorter, and focuses on a click below it", async () => {
		await showChat();
		await input().click();
		for (let line = 0; line < 60 && !handle().query(); line += 1) {
			await userEvent.keyboard("{Shift>}{Enter}{/Shift}Another line");
		}
		await expect.element(handle()).toBeVisible();
		focusHandle();

		await userEvent.keyboard("{End}");

		await expectInputAtPaneShare(0.7);
		expect(inputBox().scrollHeight).toBeLessThanOrEqual(inputBox().clientHeight);

		await page
			.elementLocator(inputBox())
			.click({ position: { x: 24, y: inputBox().clientHeight - 8 } });
		await expect.element(input()).toHaveFocus();
	});

	it("returns to the natural cap when the text shrinks or the message is sent", async () => {
		const host = await showChat();
		await fillToCap();
		focusHandle();
		await userEvent.keyboard("{End}");
		await expectInputAtPaneShare(0.7);

		await userEvent.fill(input(), "Short again");

		await expect.element(handle()).not.toBeInTheDocument();
		await expect.poll(() => inputBox().offsetHeight).toBeLessThan(128);

		await fillToCap();
		await expect.element(handle()).toHaveAttribute("aria-valuenow", "50");
		focusHandle();
		await userEvent.keyboard("{End}");
		await expectInputAtPaneShare(0.7);

		await page.getByTestId("kilo-composer-send").click();

		await expect
			.poll(() => host.server.requestsTo("POST", "/api/session/ses_a/prompt").length)
			.toBe(1);
		await expect.element(handle()).not.toBeInTheDocument();
		await expect.poll(() => inputBox().offsetHeight).toBeLessThan(128);
	});

	it("drops back to the natural cap on a double-click", async () => {
		await showChat();
		await fillToCap();
		focusHandle();
		await userEvent.keyboard("{End}");
		await expectInputAtPaneShare(0.7);

		await handle().dblClick();

		await expectInputAtPaneShare(0.5);
		await expect.element(handle()).toHaveAttribute("aria-valuenow", "50");
	});
});
