import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { PluginEntry } from "@kilo-desktop/kernel";

import { agentPane, chatSummary, renderAgentPane, session } from "../../test/chat-host";
import {
	assistantMessage,
	FakeKiloServer,
	userMessage,
	type RecordedRequest,
} from "../../test/fake-kilo-server";

afterEach(() => {
	vi.unstubAllGlobals();
});

const input = () => page.getByTestId("kilo-composer-input");

function serverWithChat(cost = 0) {
	const server = new FakeKiloServer();
	const prompt = userMessage("ses_a", "msg_u1", "Hello");
	const answer = assistantMessage("ses_a", "msg_a1", "msg_u1", [
		{ type: "text", text: "Done.", time: { start: 1, end: 2 } },
	]);
	Object.assign(answer.info, {
		cost,
		tokens: { input: 1_200, output: 300, reasoning: 0, cache: { read: 0, write: 0 } },
	});
	server.addChat({
		id: "ses_a",
		directory: "/projects/app",
		title: "Fix login",
		messages: [prompt, answer],
	});
	return server;
}

/** kilo.flags with the named flags on. */
function flags(...on: string[]) {
	return {
		manifest: {
			manifestVersion: 1,
			id: "kilo.flags",
			displayName: "Flags",
			version: "1.0.0",
			contextKeys: [{ id: "flag:*", scope: "global" }],
		},
		main: {
			activate(sdk) {
				for (const flag of on) sdk.context.set(`flag:${flag}`, true);
			},
		} satisfies PluginEntry,
	};
}

async function promptsTo(server: FakeKiloServer, chatId: string): Promise<RecordedRequest[]> {
	let prompts: RecordedRequest[] = [];
	await vi.waitFor(() => {
		prompts = server.requestsTo("POST", `/session/${chatId}/prompt_async`);
		expect(prompts.length).toBeGreaterThan(0);
	});
	return prompts;
}

const textOf = (prompt: RecordedRequest) =>
	(prompt.body as { parts: { type: string; text?: string }[] }).parts
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("");

describe("attachments", () => {
	it("adds the files picked from the attach button", async () => {
		await renderAgentPane();
		const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});

		await page.getByTestId("kilo-composer-action-attach").click();
		const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
		expect(picker.multiple).toBe(true);
		expect(click).toHaveBeenCalled();
		const transfer = new DataTransfer();
		transfer.items.add(new File(["# Notes"], "notes.md", { type: "text/markdown" }));
		picker.files = transfer.files;
		picker.dispatchEvent(new Event("change"));

		await expect.element(page.getByRole("button", { name: "Remove file" })).toBeInTheDocument();
		expect(document.querySelector('input[type="file"]')).toBeNull();
	});

	it("adds a file pasted into the input", async () => {
		await renderAgentPane();
		await input().click();
		const transfer = new DataTransfer();
		transfer.items.add(new File(["png"], "shot.png", { type: "image/png" }));
		input()
			.element()
			.dispatchEvent(
				new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
			);

		await expect.element(page.getByRole("button", { name: "Remove file" })).toBeInTheDocument();
	});
});

describe("the / menu", () => {
	it("lists Kilo's commands for the chat's folder and inserts the chosen one as a chip", async () => {
		const host = await renderAgentPane();
		await input().click();
		await userEvent.keyboard("/rev");

		await page.getByText("Review the changes").click();
		await expect
			.element(page.getByLabelText("command: review", { exact: false }))
			.toBeInTheDocument();
		expect(host.server.requestsTo("GET", "/command").map((request) => request.directory)).toContain(
			"/projects/app",
		);
	});
});

describe("Enter while the agent works", () => {
	it("queues the text, and on an empty composer sends the next queued prompt now", async () => {
		const server = serverWithChat();
		await renderAgentPane({
			server,
			pane: agentPane({ metadata: { chatId: "ses_a" } }),
			chats: [chatSummary("ses_a")],
		});
		await expect.element(page.getByText("Done.")).toBeVisible();
		await vi.waitFor(() => expect(server.openStreams).toBe(1));
		server.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });
		await expect.element(page.getByTestId("kilo-composer-stop")).toBeVisible();

		await input().click();
		await userEvent.keyboard("Queued by Enter");
		await userEvent.keyboard("{Enter}");
		await expect
			.poll(() => page.getByTestId("kilo-composer-queue-toggle").element().textContent)
			.toContain("1 queued");
		expect(server.requestsTo("POST", "/session/ses_a/prompt_async")).toHaveLength(0);

		await userEvent.keyboard("{Enter}");
		await vi.waitFor(() =>
			expect(server.requestsTo("POST", "/session/ses_a/abort")).toHaveLength(1),
		);
		server.emit("session.idle", { sessionID: "ses_a" });
		const [prompt] = await promptsTo(server, "ses_a");
		expect(textOf(prompt!)).toBe("Queued by Enter");
	});
});

describe("queued prompts with prompt-queue-editing", () => {
	it("pauses, edits and deletes queued prompts before they are sent", async () => {
		const server = serverWithChat();
		await renderAgentPane({
			server,
			pane: agentPane({ metadata: { chatId: "ses_a" } }),
			chats: [chatSummary("ses_a")],
			plugins: [flags("prompt-queue-editing")],
		});
		await expect.element(page.getByText("Done.")).toBeVisible();
		await vi.waitFor(() => expect(server.openStreams).toBe(1));
		server.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });
		await expect.element(page.getByTestId("kilo-composer-stop")).toBeVisible();

		for (const text of ["First", "Second"]) {
			await userEvent.fill(input(), text);
			await page.getByTestId("kilo-composer-queue-submit").click();
		}
		await expect
			.element(page.getByTestId("kilo-composer-queue-toggle"))
			.toHaveTextContent("2 queued");

		await page.getByTestId("kilo-composer-queue-pause").click();
		await expect.element(page.getByTestId("kilo-composer-queue-paused")).toBeVisible();

		await page.getByTestId("kilo-composer-queue-edit").first().click();
		await userEvent.fill(page.getByTestId("kilo-composer-queue-edit-input"), "First, edited");
		await page.getByTestId("kilo-composer-queue-edit-save").click();
		await expect
			.poll(() => page.getByTestId("kilo-composer-queue-item").first().element().textContent)
			.toContain("First, edited");

		await page.getByTestId("kilo-composer-queue-delete").nth(1).click();
		await expect
			.poll(() => page.getByTestId("kilo-composer-queue-toggle").element().textContent)
			.toContain("1 queued");

		server.emit("session.idle", { sessionID: "ses_a" });
		await page.getByTestId("kilo-composer-queue-pause").click();
		const [prompt] = await promptsTo(server, "ses_a");
		expect(textOf(prompt!)).toBe("First, edited");
	});
});

describe("the footer", () => {
	it("shows where a chat works and its context usage", async () => {
		const server = serverWithChat(0.42);
		await renderAgentPane({
			server,
			pane: agentPane({ metadata: { chatId: "ses_a" } }),
			chats: [chatSummary("ses_a")],
		});

		await expect.element(page.getByTestId("kilo-composer-session-mode")).toHaveTextContent("Local");
		await page.getByRole("button", { name: "Context usage" }).click();
		await expect.element(page.getByTestId("kilo-composer-context-popover")).toBeVisible();
	});

	it("sits below the composer, leaving its bottom edge uncovered", async () => {
		await renderAgentPane({
			server: serverWithChat(0.42),
			pane: agentPane({ metadata: { chatId: "ses_a" } }),
			chats: [chatSummary("ses_a")],
		});
		await expect.element(page.getByTestId("kilo-composer-session-mode")).toBeVisible();

		const composer = document.querySelector(".aui-composer-root")!.getBoundingClientRect();
		const footer = page.getByTestId("kilo-composer-footer").element().getBoundingClientRect();
		// The footer's backdrop reaches 6px (`-top-1.5`) above it: that must stay in the gap.
		expect(footer.top - composer.bottom).toBeGreaterThanOrEqual(6);
	});

	it("names a worktree chat's worktree", async () => {
		const server = new FakeKiloServer();
		server.addChat({
			id: "ses_a",
			directory: "/worktrees/fix-login",
			title: "Fix login",
			messages: [userMessage("ses_a", "msg_u1", "Hello")],
		});
		await renderAgentPane({
			server,
			directory: "/worktrees/fix-login",
			session: session({ directory: "/worktrees/fix-login", worktreeBranch: "fix-login" }),
			pane: agentPane({ metadata: { chatId: "ses_a" } }),
			chats: [chatSummary("ses_a", { directory: "/worktrees/fix-login" })],
		});

		await expect
			.element(page.getByTestId("kilo-composer-session-mode"))
			.toHaveTextContent("fix-login");
	});
});

describe("unavailable workspace folders", () => {
	const warning = () => page.getByTestId("kilo-composer-unavailable-folders");

	it("warns under a chat's composer and opens the workspace's settings", async () => {
		const host = await renderAgentPane({
			server: serverWithChat(),
			pane: agentPane({ metadata: { chatId: "ses_a" } }),
			chats: [chatSummary("ses_a")],
			unavailableFolderIds: ["f-lib"],
		});

		await expect.element(warning()).toHaveAccessibleName("App has unavailable folders");
		await warning().click();
		expect(host.workspaceEdited).toHaveBeenCalledWith({ workspaceId: "w-app" });
	});

	it("warns under a new chat's composer", async () => {
		await renderAgentPane({ unavailableFolderIds: ["f-lib"] });

		await expect.element(page.getByTestId("kilo-composer-draft-footer")).toBeVisible();
		await expect.element(warning()).toBeVisible();
	});

	it("stays out of the way while every folder is there", async () => {
		await renderAgentPane();
		await expect.element(input()).toBeVisible();

		await expect.element(warning()).not.toBeInTheDocument();
		await expect.element(page.getByTestId("kilo-composer-draft-footer")).not.toBeVisible();
	});

	it("says nothing for a chat outside any workspace", async () => {
		await renderAgentPane({ workspaceId: null, unavailableFolderIds: ["f-lib"] });
		await expect.element(input()).toBeVisible();

		await expect.element(warning()).not.toBeInTheDocument();
	});
});
