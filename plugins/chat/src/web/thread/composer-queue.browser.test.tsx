import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { chatPaneObject } from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import { FakeKilo2Server } from "../../test/kilo2/fake-kilo2-server";
import { session, userMessage } from "../../test/kilo2/fixtures";
import { renderChat } from "../../test/render-chat";

const input = () => page.getByTestId("kilo-composer-input");
const items = () => page.getByTestId("kilo-composer-queue-item");
const itemText = (index: number) => items().nth(index).getByTestId("kilo-composer-queue-text");

const promptTexts = (server: FakeKilo2Server) =>
	server.promptsTo("ses_a").map((prompt) => prompt.text);

/** A chat that is working, with `texts` queued behind its turn. */
async function queueBehindTurn(texts: readonly string[]) {
	const server = new FakeKilo2Server();
	server.addChat(session("ses_a", { title: "Chat" }), [userMessage("Hello")]);
	await renderChat({
		server,
		pane: agentPane({ object: chatPaneObject("ses_a") }),
		chats: [chatSummary("ses_a")],
	});
	await expect.element(page.getByText("Hello")).toBeVisible();
	await vi.waitFor(() => expect(server.openStreams).toBe(1));
	server.startTurn("ses_a");
	await expect.element(page.getByTestId("kilo-composer-stop")).toBeVisible();
	for (const text of texts) {
		await userEvent.fill(input(), text);
		await page.getByTestId("kilo-composer-queue-submit").click();
	}
	await expect
		.element(page.getByTestId("kilo-composer-queue-toggle"))
		.toHaveTextContent(`${texts.length} queued`);
	return server;
}

const endTurn = (server: FakeKilo2Server) => server.turn("ses_a")?.succeed();

describe("the composer's queue", () => {
	it("collapses and expands its list", async () => {
		await queueBehindTurn(["First"]);
		await expect.element(items().getByText("First")).toBeVisible();

		await page.getByTestId("kilo-composer-queue-toggle").click();
		expect(items().query()).toBeNull();
		await page.getByTestId("kilo-composer-queue-toggle").click();

		await expect.element(items().getByText("First")).toBeVisible();
	});

	it("deletes a queued prompt before it is sent", async () => {
		const server = await queueBehindTurn(["First", "Second"]);

		await items().first().getByTestId("kilo-composer-queue-delete").click();
		await expect
			.element(page.getByTestId("kilo-composer-queue-toggle"))
			.toHaveTextContent("1 queued");
		endTurn(server);

		await vi.waitFor(() => expect(promptTexts(server)).toEqual(["Second"]));
	});

	it("holds what waits while paused and sends it once resumed", async () => {
		const server = await queueBehindTurn(["First"]);

		await page.getByTestId("kilo-composer-queue-pause").click();
		await expect.element(page.getByTestId("kilo-composer-queue-paused")).toBeVisible();
		endTurn(server);
		await expect.element(page.getByTestId("kilo-composer-stop")).not.toBeInTheDocument();
		expect(server.promptsTo("ses_a")).toEqual([]);

		await page.getByRole("button", { name: "Resume queue" }).click();

		await vi.waitFor(() => expect(promptTexts(server)).toEqual(["First"]));
	});

	it("edits a queued prompt in place, or leaves it as it was on cancel", async () => {
		const server = await queueBehindTurn(["First", "Second"]);

		await items().first().getByTestId("kilo-composer-queue-edit").click();
		await expect.element(page.getByTestId("kilo-composer-queue-editing")).toBeVisible();
		await userEvent.fill(page.getByTestId("kilo-composer-queue-edit-input"), "Not this");
		await page.getByTestId("kilo-composer-queue-edit-cancel").click();
		await expect.element(itemText(0)).toHaveTextContent("First");

		await items().first().getByTestId("kilo-composer-queue-edit").click();
		await userEvent.fill(page.getByTestId("kilo-composer-queue-edit-input"), "First, edited");
		await page.getByTestId("kilo-composer-queue-edit-save").click();
		await expect.element(itemText(0)).toHaveTextContent("First, edited");
		await expect.element(page.getByTestId("kilo-composer-queue-editing")).not.toBeInTheDocument();

		endTurn(server);
		await vi.waitFor(() => expect(promptTexts(server)[0]).toBe("First, edited"));
	});

	it("moves a queued prompt with the keyboard", async () => {
		await queueBehindTurn(["First", "Second"]);

		const grip = items().nth(1).getByTestId("kilo-composer-queue-grip");
		(grip.element() as HTMLElement).focus();
		await userEvent.keyboard("{ArrowUp}");

		await expect
			.element(page.getByTestId("kilo-composer-queue-announcer"))
			.toHaveTextContent("Moved to position 1 of 2");
		await expect.element(itemText(0)).toHaveTextContent("Second");
	});

	it("sends a queued prompt now, stopping the turn", async () => {
		const server = await queueBehindTurn(["First"]);

		await items().first().getByTestId("kilo-composer-queue-send-now").click();

		await vi.waitFor(() =>
			expect(server.requestsTo("POST", "/api/session/ses_a/interrupt").length).toBeGreaterThan(0),
		);
	});
});
