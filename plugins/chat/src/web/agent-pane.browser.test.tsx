import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { Panes, type Pane } from "@kilo-desktop/plugin-sessions/contracts";

import { COMPOSER_FOCUSED_KEY } from "../contracts";
import { agentPane, chatSummary, renderAgentPane, session } from "../test/chat-host";
import {
	assistantMessage,
	FakeKiloServer,
	userMessage,
	type RecordedRequest,
} from "../test/fake-kilo-server";

afterEach(() => {
	vi.unstubAllGlobals();
});

const TERMINAL_PANE: Pane = {
	id: "pane_term",
	kind: "kilo.terminal/terminal",
	title: "Terminal",
	metadata: {},
	ordinal: 1,
};

const composerInput = () => page.getByTestId("kilo-composer-input");

async function send(text: string) {
	await userEvent.fill(composerInput(), text);
	await page.getByTestId("kilo-composer-send").click();
}

function serverWithChat(chatId = "ses_a", messages = [userMessage("ses_a", "msg_u1", "Hello")]) {
	const server = new FakeKiloServer();
	server.addChat({ id: chatId, directory: "/projects/app", title: "Fix login", messages });
	return server;
}

async function promptsTo(server: FakeKiloServer, chatId: string): Promise<RecordedRequest[]> {
	let prompts: RecordedRequest[] = [];
	await vi.waitFor(() => {
		prompts = server.requestsTo("POST", `/session/${chatId}/prompt_async`);
		expect(prompts.length).toBeGreaterThan(0);
	});
	return prompts;
}

const promptText = (request: RecordedRequest) =>
	(request.body as { parts: { type: string; text?: string }[] }).parts
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("");

describe("a draft agent pane", () => {
	it("opens as a chat with messages will look: composer docked at the bottom, focused", async () => {
		await renderAgentPane();

		const thread = page.getByTestId("kilo-chat-thread");
		await expect.element(thread).toHaveAttribute("data-draft", "true");
		await expect.element(page.getByTestId("kilo-composer-send")).toBeDisabled();
		await expect.element(page.getByRole("button", { name: "Add attachment" })).toBeVisible();
		expect(page.getByTestId("chat-welcome-headline").elements()).toHaveLength(0);

		const composer = document.querySelector(".aui-composer-root")!.getBoundingClientRect();
		const pane = thread.element().getBoundingClientRect();
		// Docked: the composer sits in the bottom quarter, not centred in the pane.
		expect(composer.bottom).toBeGreaterThan(pane.bottom - pane.height / 4);
		await vi.waitFor(
			() => expect(document.activeElement?.closest(".aui-composer-root")).not.toBeNull(),
			{ timeout: 5_000 },
		);
	});

	it("creates the session's chat on the first send and records it in the pane", async () => {
		const host = await renderAgentPane({ instructions: ["Prefer small diffs."] });

		await send("Fix the login form");

		await vi.waitFor(() => expect(host.agent.calls.create).toHaveBeenCalledOnce());
		expect(host.agent.calls.create).toHaveBeenCalledWith({
			sessionId: "wses_1",
			directory: "/projects/app",
			workspaceId: "w-app",
			workspaceFolders: [
				{ path: "/projects/app", isPrimary: true },
				{ path: "/projects/lib", isPrimary: false },
			],
		});
		await vi.waitFor(() =>
			expect(host.sessions.calls.update).toHaveBeenCalledWith({
				sessionId: "wses_1",
				paneId: "pane_agent",
				metadata: { chatId: "ses_new_1" },
			}),
		);
		const [prompt] = await promptsTo(host.server, "ses_new_1");
		expect(prompt!.directory).toBe("/projects/app");
		expect(promptText(prompt!)).toBe("Fix the login form");
		const body = prompt!.body as { system: string; snapshotInitialization: string };
		expect(body.snapshotInitialization).toBe("wait");
		expect(body.system).toContain('Primary folder (default working directory): "/projects/app"');
		expect(body.system).toContain('Additional workspace folder: "/projects/lib"');
		expect(body.system).toContain("Prefer small diffs.");
		await expect.element(page.getByText("Fix the login form")).toBeVisible();
		expect(host.server.requestsTo("GET", "/session/ses_new_1/message").length).toBeLessThanOrEqual(
			1,
		);
	});

	it("starts an unscoped session's chat without a directory", async () => {
		const host = await renderAgentPane({
			session: session({ workspaceId: null }),
			workspaceId: null,
			directory: null,
		});

		await send("Hi");

		await vi.waitFor(() =>
			expect(host.agent.calls.create).toHaveBeenCalledWith({
				sessionId: "wses_1",
				workspaceFolders: [],
			}),
		);
		const [prompt] = await promptsTo(host.server, "ses_new_1");
		expect(prompt!.directory).toBe("/chats/session-1");
	});

	it("passes a worktree session's branch and folder", async () => {
		const host = await renderAgentPane({
			session: session({ worktreeBranch: "kilo/fix" }),
			directory: "/projects/app/.kilo/worktrees/fix",
		});

		await send("Hi");

		await vi.waitFor(() =>
			expect(host.agent.calls.create).toHaveBeenCalledWith(
				expect.objectContaining({
					directory: "/projects/app/.kilo/worktrees/fix",
					worktreeBranch: "kilo/fix",
					workspaceFolders: [
						{ path: "/projects/app/.kilo/worktrees/fix", isPrimary: true },
						{ path: "/projects/lib", isPrimary: false },
					],
				}),
			),
		);
	});

	it("says why a chat couldn't start and returns the message to the composer", async () => {
		const host = await renderAgentPane({ createError: "The Kilo server isn't running." });

		await send("Try this");

		await expect.element(page.getByText("Could not start the chat")).toBeVisible();
		await expect.element(composerInput()).toHaveTextContent("Try this");
		expect(host.sessions.calls.update).not.toHaveBeenCalled();
	});

	it("can't start a chat without kilo.agent", async () => {
		await renderAgentPane({ withoutAgent: true });

		await send("Hello?");

		await expect.element(page.getByText("Kilo chats aren't available.")).toBeVisible();
	});
});

describe("an agent pane with a chat", () => {
	it("shows the chat named in the pane", async () => {
		const server = serverWithChat("ses_a", [
			userMessage("ses_a", "msg_u1", "What does login do?"),
			assistantMessage("ses_a", "msg_a1", "msg_u1", [
				{ type: "reasoning", text: "Looking at the form", time: { start: 1, end: 2 } },
				{
					type: "tool",
					tool: "read",
					callID: "call_1",
					state: {
						status: "completed",
						input: { filePath: "/projects/app/login.ts" },
						output: "…",
						title: "login.ts",
						metadata: {},
						time: { start: 2, end: 3 },
					},
				},
				{ type: "text", text: "It posts **credentials**.", time: { start: 3, end: 4 } },
			]),
		]);
		await renderAgentPane({
			server,
			pane: agentPane({ metadata: { chatId: "ses_a" } }),
			chats: [chatSummary("ses_a")],
		});

		await expect.element(page.getByText("What does login do?")).toBeVisible();
		await expect.element(page.getByText("credentials")).toBeVisible();
		await expect.element(page.getByText(/^Worked for/)).toBeVisible();
		await expect.element(page.getByTestId("kilo-chat-thread")).not.toHaveAttribute("data-draft");
		expect(server.requestsTo("GET", "/session/ses_a")[0]!.directory).toBe("/projects/app");
	});

	it("shows the session's chat in a pane handed over without metadata", async () => {
		const server = serverWithChat("ses_legacy", [
			userMessage("ses_legacy", "msg_u1", "An older chat"),
		]);
		await renderAgentPane({
			server,
			session: session({ chatIds: ["ses_legacy"], directory: "/projects/app" }),
			pane: agentPane({ id: "agent:wses_1" }),
		});

		await expect.element(page.getByText("An older chat")).toBeVisible();
	});

	it("finds a chat's folder from the server when nothing else knows it", async () => {
		const server = serverWithChat("ses_far", [userMessage("ses_far", "msg_u1", "Far away")]);
		await renderAgentPane({ server, pane: agentPane({ metadata: { chatId: "ses_far" } }) });

		await expect.element(page.getByText("Far away")).toBeVisible();
	});

	it("streams the reply as it arrives", async () => {
		const server = serverWithChat();
		await renderAgentPane({
			server,
			pane: agentPane({ metadata: { chatId: "ses_a" } }),
			chats: [chatSummary("ses_a")],
		});
		await expect.element(page.getByText("Hello")).toBeVisible();
		await vi.waitFor(() => expect(server.openStreams).toBe(1));

		server.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });
		const reply = assistantMessage("ses_a", "msg_a1", "msg_u1", []);
		server.emit("message.updated", { info: { ...reply.info, time: { created: Date.now() } } });
		server.emit("message.part.updated", {
			part: {
				id: "part_1",
				sessionID: "ses_a",
				messageID: "msg_a1",
				type: "text",
				text: "Working on",
				time: { start: Date.now() },
			},
		});
		server.emit("message.part.delta", {
			sessionID: "ses_a",
			messageID: "msg_a1",
			partID: "part_1",
			field: "text",
			delta: " it now",
		});

		await expect.element(page.getByText("Working on it now")).toBeVisible();
		await expect.element(page.getByTestId("kilo-turn-working")).toBeVisible();
		await expect.element(page.getByTestId("kilo-composer-stop")).toBeVisible();

		server.emit("session.idle", { sessionID: "ses_a" });
		await expect.element(page.getByTestId("kilo-composer-send")).toBeVisible();
	});

	it("stops the running turn", async () => {
		const server = serverWithChat();
		await renderAgentPane({
			server,
			pane: agentPane({ metadata: { chatId: "ses_a" } }),
			chats: [chatSummary("ses_a")],
		});
		await expect.element(page.getByText("Hello")).toBeVisible();
		await vi.waitFor(() => expect(server.openStreams).toBe(1));
		server.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });

		await page.getByTestId("kilo-composer-stop").click();

		await vi.waitFor(() =>
			expect(server.requestsTo("POST", "/session/ses_a/abort")).toHaveLength(1),
		);
		expect(server.requestsTo("POST", "/session/ses_a/abort")[0]!.directory).toBe("/projects/app");
	});

	it("queues a prompt sent while the agent works and sends it when the turn ends", async () => {
		const server = serverWithChat();
		await renderAgentPane({
			server,
			pane: agentPane({ metadata: { chatId: "ses_a" } }),
			chats: [chatSummary("ses_a")],
		});
		await expect.element(page.getByText("Hello")).toBeVisible();
		await vi.waitFor(() => expect(server.openStreams).toBe(1));
		server.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });
		await expect.element(page.getByTestId("kilo-composer-stop")).toBeVisible();

		await userEvent.fill(composerInput(), "Then add tests");
		await page.getByTestId("kilo-composer-queue-submit").click();

		await expect
			.element(page.getByTestId("kilo-composer-queue-toggle"))
			.toHaveTextContent("1 queued");
		await expect
			.element(page.getByTestId("kilo-composer-queue-item").getByText("Then add tests"))
			.toBeVisible();
		expect(server.requestsTo("POST", "/session/ses_a/prompt_async")).toHaveLength(0);

		server.emit("session.idle", { sessionID: "ses_a" });

		const [prompt] = await promptsTo(server, "ses_a");
		expect(promptText(prompt!)).toBe("Then add tests");
		await expect.element(page.getByTestId("kilo-composer-queue")).not.toBeInTheDocument();
	});

	it("sends an attachment with the prompt", async () => {
		const server = serverWithChat();
		await renderAgentPane({
			server,
			pane: agentPane({ metadata: { chatId: "ses_a" } }),
			chats: [chatSummary("ses_a")],
		});
		await expect.element(page.getByText("Hello")).toBeVisible();

		const transfer = new DataTransfer();
		transfer.items.add(new File(["# Notes"], "notes.md", { type: "text/markdown" }));
		const dropzone = document.querySelector('[data-slot="aui_composer-shell"]')!;
		for (const type of ["dragenter", "dragover", "drop"]) {
			dropzone.dispatchEvent(
				new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
			);
		}
		await expect.element(page.getByRole("button", { name: "Remove file" })).toBeInTheDocument();
		await vi.waitFor(() =>
			expect(
				document.querySelector('.aui-attachment-tile[aria-label$=" attachment"]'),
			).not.toBeNull(),
		);

		await send("Read these");

		const [prompt] = await promptsTo(server, "ses_a");
		const parts = (prompt!.body as { parts: Record<string, unknown>[] }).parts;
		expect(parts).toContainEqual(expect.objectContaining({ type: "file", filename: "notes.md" }));
		expect(promptText(prompt!)).toBe("Read these");
	});

	it("shares one event stream between the window's panes and closes it with the last", async () => {
		const server = serverWithChat();
		const host = await renderAgentPane({
			server,
			pane: agentPane({ metadata: { chatId: "ses_a" } }),
			chats: [chatSummary("ses_a")],
		});
		await vi.waitFor(() => expect(server.openStreams).toBe(1));

		host.view.unmount();

		await vi.waitFor(() => expect(server.openStreams).toBe(0));
		expect(server.requestsTo("GET", "/global/event")).toHaveLength(1);
	});
});

describe("focus-composer", () => {
	it("focuses the open session's composer", async () => {
		const host = await renderAgentPane();
		await expect.element(composerInput()).toBeVisible();

		await host.run("focus-composer");

		await expect.element(composerInput()).toHaveFocus();
		await vi.waitFor(() =>
			expect(host.host.renderer.contextKeys.get(COMPOSER_FOCUSED_KEY)).toBe(true),
		);
		(document.activeElement as HTMLElement).blur();
		await vi.waitFor(() =>
			expect(host.host.renderer.contextKeys.get(COMPOSER_FOCUSED_KEY)).toBe(false),
		);
	});

	it("brings the session's agent pane forward first", async () => {
		const host = await renderAgentPane({
			otherPanes: [TERMINAL_PANE],
		});
		await host.host.renderer.kernelSdk.domains
			.get(Panes)!
			.methods.activate({ sessionId: "wses_1", paneId: "pane_term" });

		await host.run("focus-composer");

		await vi.waitFor(() => expect(host.panes().activePaneId).toBe("pane_agent"));
		await expect.element(composerInput()).toHaveFocus();
	});

	it("adds an agent pane when the session has none", async () => {
		const host = await renderAgentPane({
			pane: TERMINAL_PANE,
		});

		await host.run("focus-composer");

		await vi.waitFor(() => expect(host.sessions.calls.open).toHaveBeenCalledOnce());
		await expect.element(composerInput()).toHaveFocus();
	});
});
