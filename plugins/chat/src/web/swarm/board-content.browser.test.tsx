import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import type { BoardMessage } from "@kilo-desktop/plugin-core/contracts";

import { chatPaneObject, SWARM_PANE_KIND, swarmPaneId } from "../../contracts";
import { chatSummary } from "../../test/chat-host";
import { FakeKiloServer, userMessage } from "../../test/fake-kilo-server";
import { renderChat } from "../../test/render-chat";
import { useSwarmBoardStore } from "./swarm-board-store";

const WAIT = { timeout: 15_000 };
const START = Date.UTC(2026, 10, 16, 9);
const message = (id: string, patch: Partial<BoardMessage> = {}): BoardMessage => ({
	id,
	timestamp: START + Number(id.slice(1)) * 1_000,
	from: "ses_c1",
	to: "main",
	type: "INFO",
	body: `Finding ${id}`,
	...patch,
});

async function showBoard(messages: BoardMessage[]) {
	const server = new FakeKiloServer();
	server.addChat({
		id: "ses_a",
		directory: "/projects/app",
		title: "Review bridge",
		messages: [userMessage("ses_a", "msg_1", "Review the bridge")],
	});
	return renderChat({
		server,
		pane: {
			id: swarmPaneId("ses_a"),
			kind: SWARM_PANE_KIND,
			title: "Swarm board",
			metadata: {},
			object: chatPaneObject("ses_a"),
			ordinal: 1,
		},
		chats: [
			chatSummary("ses_a", { title: "Review bridge", createdAt: START }),
			chatSummary("ses_c1", { parentId: "ses_a", title: "Bridge RPC", createdAt: START }),
			chatSummary("ses_c2", { parentId: "ses_a", title: "Desktop UI", createdAt: START }),
		],
		boards: { ses_a: { ownerChatId: "ses_a", revision: 1, messages, hasMore: false } },
		boardEvents: true,
	});
}

beforeEach(() => {
	localStorage.clear();
	useSwarmBoardStore.setState({ filters: {}, seen: {} });
});

describe("board content", () => {
	it("reveals a search match beyond a folded message's first line", async () => {
		await showBoard([
			message("m1", {
				body: `Summary\n\n${"Background context. ".repeat(40)}\n\nNeedle found here.`,
			}),
			message("m2"),
		]);
		const post = page.getByTestId("swarm-board-message").first();
		await expect.element(post.getByTestId("swarm-board-message-preview"), WAIT).toBeVisible();
		await page.getByTestId("swarm-board-search").fill("needle");
		await expect.poll(() => post.element().querySelector("mark")?.textContent, WAIT).toBe("Needle");
		await expect
			.element(post.getByTestId("swarm-board-message-toggle"))
			.toHaveAttribute("aria-expanded", "true");
		await page.getByTestId("swarm-board-search").fill("");
		await expect.element(post.getByTestId("swarm-board-message-preview")).toBeVisible();
	});

	it("labels the loaded search scope and requires two agents for Between", async () => {
		await showBoard([
			message("m1", { type: "ASK", to: "ses_c2" }),
			message("m2", { from: "ses_c2" }),
		]);
		await expect
			.element(page.getByRole("textbox", { name: "Search loaded messages" }), WAIT)
			.toBeVisible();
		await expect
			.poll(() => page.getByTestId("swarm-board-filter-count").element().textContent)
			.toBe("2 loaded messages");
		await page.getByTestId("swarm-board-filter-type-menu").click();
		await expect
			.poll(() => page.getByTestId("swarm-board-filter-open").element().textContent)
			.toContain("No reply yet");
		await page.getByTestId("swarm-board-filter-type-menu").click();
		await page.getByTestId("swarm-board-filter-agent-menu").click();
		const between = page.getByTestId("swarm-board-filter-direction-between");
		await expect.element(between).toHaveAttribute("aria-disabled", "true");
		const bridge = page.getByTestId("swarm-board-filter-agent").filter({ hasText: "Bridge RPC" });
		const desktop = page.getByTestId("swarm-board-filter-agent").filter({ hasText: "Desktop UI" });
		await bridge.click();
		await expect.element(between).toHaveAttribute("aria-disabled", "true");
		await desktop.click();
		await expect.element(between).not.toHaveAttribute("aria-disabled", "true");
		await between.click();
		await expect.element(between).toHaveAttribute("aria-checked", "true");
		await desktop.click();
		await expect.element(between).toHaveAttribute("aria-disabled", "true");
		await expect
			.element(page.getByTestId("swarm-board-filter-direction-both"))
			.toHaveAttribute("aria-checked", "true");
	});

	it("does not offer a transcript action for an unavailable sender", async () => {
		await showBoard([message("m1", { from: "gone", fromLabel: "Former agent" })]);
		const post = page.getByTestId("swarm-board-message");
		await expect.element(post.getByTestId("swarm-board-message-sender"), WAIT).toBeVisible();
		await expect
			.element(post.getByRole("button", { name: "Former agent" }))
			.not.toBeInTheDocument();
		await expect
			.element(post.getByTestId("swarm-board-message-sender"))
			.not.toHaveAttribute("title", "Open transcript");
	});

	it("shows complete agent-reported results with separate copy and source actions", async () => {
		const body =
			"Summary of work\n\nValidated the bridge schema and recorded remaining limitations.";
		const chat = await showBoard([
			message("m1", { type: "RESULT", body: "Superseded result" }),
			message("m2", { type: "RESULT", body }),
		]);
		await page.getByRole("tab", { name: /^Results/ }).click({ timeout: WAIT.timeout });
		const results = page.getByTestId("swarm-board-results");
		await expect.element(results.getByText("Agent-reported results")).toBeVisible();
		await expect.poll(() => results.element().textContent).toContain("2 loaded messages");
		await expect.poll(() => page.getByTestId("swarm-board-result").all().length).toBe(1);
		await expect
			.element(results.getByText("Validated the bridge schema and recorded remaining limitations."))
			.toBeVisible();
		await results.getByRole("button", { name: "Copy result" }).click();
		await expect.poll(() => chat.copied.at(-1)).toBe(body);
		await expect
			.element(page.getByRole("tab", { name: /^Results/ }))
			.toHaveAttribute("aria-selected", "true");
		await results.getByRole("button", { name: "View source message" }).click();
		await expect
			.element(page.getByRole("tab", { name: "Activity", exact: true }))
			.toHaveAttribute("aria-selected", "true");
		await expect
			.element(
				page
					.getByTestId("swarm-board-message")
					.getByText("Validated the bridge schema and recorded remaining limitations."),
			)
			.toBeInViewport();
	});

	it("makes unloaded history explicit even when no results are loaded", async () => {
		await showBoard([
			message("m0", { type: "RESULT", body: "Earlier result" }),
			...Array.from({ length: 50 }, (_, index) => message(`m${index + 1}`)),
		]);
		const scope = page.getByTestId("swarm-board-filter-count");
		await expect.poll(() => scope.element().textContent, WAIT).toBe("50 loaded messages");
		await expect
			.element(
				page.getByTestId("swarm-board-filters").getByText("Older messages are not searched."),
			)
			.toBeVisible();
		await page.getByRole("tab", { name: /^Results/ }).click();
		const results = page.getByTestId("swarm-board-results");
		await expect.element(results.getByText("No results in loaded messages")).toBeVisible();
		await expect
			.poll(() => results.element().textContent)
			.toContain("Older messages are not included.");
	});
});
