import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { agentPane, chatSummary, renderAgentPane } from "../../test/chat-host";
import {
	assistantMessage,
	FakeKiloServer,
	userMessage,
	type FakeMessage,
} from "../../test/fake-kilo-server";
import { button, expandUntil, turnWork } from "../../test/transcript";

afterEach(() => {
	vi.unstubAllGlobals();
});

async function showChat(messages: FakeMessage[]) {
	const server = new FakeKiloServer();
	server.addChat({ id: "ses_a", directory: "/projects/app", title: "Chat", messages });
	return renderAgentPane({
		server,
		pane: agentPane({ metadata: { chatId: "ses_a" } }),
		chats: [chatSummary("ses_a")],
	});
}

const tool = (name: string, state: Record<string, unknown>) => ({
	type: "tool",
	tool: name,
	callID: `call_${name}`,
	state: { input: {}, time: { start: 1 }, ...state },
});

describe("the transcript", () => {
	it("renders code blocks with a copy button", async () => {
		const host = await showChat([
			userMessage("ses_a", "msg_1", "Show me"),
			assistantMessage("ses_a", "msg_2", "msg_1", [
				{
					type: "text",
					text: "Run `pnpm test`:\n\n```sh\npnpm test\n```\n",
					time: { start: 1, end: 2 },
				},
			]),
		]);

		await expect.element(page.getByText("sh", { exact: true })).toBeVisible();
		await page.getByTestId("chat-code-copy").click();

		await vi.waitFor(() => expect(host.copied).toContain("pnpm test\n"));
	});

	it("renders a Mermaid fence as a diagram card with its source", async () => {
		const host = await showChat([
			userMessage("ses_a", "msg_1", "Draw it"),
			assistantMessage("ses_a", "msg_2", "msg_1", [
				{
					type: "text",
					text: "```mermaid\nflowchart TD\n  A --> B\n```\n",
					time: { start: 1, end: 2 },
				},
			]),
		]);

		await expect
			.element(page.getByTestId("chat-mermaid-card").getByText("Flowchart"))
			.toBeVisible();
		await page.getByTestId("chat-mermaid-source-toggle").click();
		await expect
			.element(page.getByTestId("chat-mermaid-source").getByText("A --> B", { exact: false }))
			.toBeVisible();
		await page.getByTestId("chat-mermaid-copy").click();
		await vi.waitFor(() => expect(host.copied.at(-1)).toContain("flowchart TD"));
	});

	it("folds reasoning under a disclosure", async () => {
		await showChat([
			userMessage("ses_a", "msg_1", "Think"),
			assistantMessage("ses_a", "msg_2", "msg_1", [
				{ type: "reasoning", text: "Weighing the options", time: { start: 1, end: 2 } },
				{ type: "text", text: "Done.", time: { start: 2, end: 3 } },
			]),
		]);

		await expect.element(page.getByText("Done.")).toBeVisible();
		expect(document.body.textContent).not.toContain("Weighing the options");

		await expandUntil([turnWork, button("Thought")], () =>
			expect(page.getByText("Weighing the options").element()).toBeVisible(),
		);
	});

	it("shows each tool call's state", async () => {
		await showChat([
			userMessage("ses_a", "msg_1", "Go"),
			assistantMessage("ses_a", "msg_2", "msg_1", [
				tool("bash", {
					status: "error",
					input: { command: "make" },
					error: "exit 2",
					time: { start: 1, end: 2 },
				}),
				tool("github_list_issues", {
					status: "completed",
					output: "[]",
					title: "",
					metadata: {},
					time: { start: 1, end: 2 },
				}),
			]),
		]);

		await expandUntil([turnWork, button("2 tools used")], () =>
			expect(page.getByRole("button", { name: "Ran make" }).element()).toBeVisible(),
		);
		await expect.element(page.getByRole("button", { name: "Github List issues" })).toBeVisible();
	});

	it("copies a reply", async () => {
		const host = await showChat([
			userMessage("ses_a", "msg_1", "Summarize"),
			assistantMessage("ses_a", "msg_2", "msg_1", [
				{ type: "text", text: "A short summary.", time: { start: 1, end: 2 } },
			]),
		]);
		await expect.element(page.getByText("A short summary.")).toBeVisible();

		const copy = document.querySelector<HTMLButtonElement>(
			'[data-role="assistant"] [data-qa-id="chat-message-copy"]',
		);
		copy!.click();

		await vi.waitFor(() => expect(host.copied).toContain("A short summary."));
	});

	it("explains a reply that ended in an error", async () => {
		const prompt = userMessage("ses_a", "msg_1", "Go");
		const failed = assistantMessage("ses_a", "msg_2", "msg_1", []);
		await showChat([
			prompt,
			{
				...failed,
				info: {
					...failed.info,
					error: {
						name: "APIError",
						data: { message: 'Gateway said {"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}' },
					},
				},
			},
		]);

		await expect
			.element(page.getByTestId("chat-message-error"))
			.toHaveTextContent("You need to connect to Kilo to use this model");
	});

	it("notes a reply the person stopped", async () => {
		const stopped = assistantMessage("ses_a", "msg_2", "msg_1", [
			{ type: "text", text: "Partial", time: { start: 1, end: 2 } },
		]);
		await showChat([
			userMessage("ses_a", "msg_1", "Go", 1_000),
			{
				...stopped,
				info: {
					...stopped.info,
					time: { created: 1_500, completed: 4_000 },
					error: { name: "MessageAbortedError", data: { message: "Aborted" } },
				},
			},
		]);

		await expect
			.element(page.getByTestId("kilo-turn-stopped"))
			.toHaveTextContent("You stopped after 3s");
	});

	it("shows a running turn's live reasoning and tools", async () => {
		const host = await showChat([userMessage("ses_a", "msg_1", "Go")]);
		await expect.element(page.getByText("Go")).toBeVisible();
		await vi.waitFor(() => expect(host.server.openStreams).toBe(1));
		const reply = assistantMessage("ses_a", "msg_2", "msg_1", []);

		host.server.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });
		host.server.emit("message.updated", {
			info: { ...reply.info, time: { created: Date.now() }, finish: undefined },
		});
		host.server.emit("message.part.updated", {
			part: {
				id: "part_r",
				sessionID: "ses_a",
				messageID: "msg_2",
				type: "reasoning",
				text: "Thinking it through",
				time: { start: Date.now() },
			},
		});
		host.server.emit("message.part.updated", {
			part: {
				id: "part_t",
				sessionID: "ses_a",
				messageID: "msg_2",
				type: "tool",
				tool: "grep",
				callID: "call_grep",
				state: { status: "running", input: { pattern: "login" }, time: { start: Date.now() } },
			},
		});

		await expect
			.element(page.getByRole("button", { name: "Searching the codebase" }))
			.toBeVisible();
		host.server.emit("session.idle", { sessionID: "ses_a" });
		await expect.element(page.getByTestId("kilo-turn-work-toggle")).toBeVisible();
	});

	it("shows a sent image", async () => {
		const sent = userMessage("ses_a", "msg_1", "Look");
		await showChat([
			{
				...sent,
				parts: [
					...sent.parts,
					{
						id: "msg_1_f",
						sessionID: "ses_a",
						messageID: "msg_1",
						type: "file",
						mime: "image/png",
						filename: "shot.png",
						url: "data:image/png;base64,iVBORw0KGgo=",
					},
				],
			},
		]);

		await expect.element(page.getByRole("button", { name: "Image attachment" })).toBeVisible();
	});

	it("doesn't scroll a new chat, whose docked composer fits the pane", async () => {
		await renderAgentPane();
		await expect.element(page.getByTestId("kilo-composer-dock")).toBeVisible();

		const viewport = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]')!;
		expect(viewport.scrollHeight).toBe(viewport.clientHeight);
	});

	it("removes an attachment before sending", async () => {
		await renderAgentPane();
		const transfer = new DataTransfer();
		transfer.items.add(new File(["a,b"], "data.csv", { type: "text/csv" }));
		const dropzone = document.querySelector('[data-slot="aui_composer-shell"]')!;
		for (const type of ["dragenter", "dragover", "drop"]) {
			dropzone.dispatchEvent(
				new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
			);
		}
		const remove = page.getByRole("button", { name: "Remove file" });
		await expect.element(remove).toBeInTheDocument();

		await remove.click();

		await expect.element(remove).not.toBeInTheDocument();
	});
});
