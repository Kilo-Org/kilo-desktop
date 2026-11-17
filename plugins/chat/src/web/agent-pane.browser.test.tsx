import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { Panes, type Pane } from "@kilo-desktop/plugin-work-sessions/contracts";

import { chatPaneObject, COMPOSER_FOCUSED_KEY, Drafts } from "../contracts";
import { agentPane, chatSummary, workSession } from "../test/chat-host";
import { renderChat } from "../test/render-chat";
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

/**
 * Whether a transcript user message showing `text` (and passing `also`) was
 * rendered at any moment until the returned stop, however briefly.
 */
function watchTranscriptFor(
	text: string,
	also: (message: Element) => boolean = () => true,
): () => boolean {
	let shown = false;
	const check = () => {
		shown ||= [...document.querySelectorAll('[data-role="user"]')].some(
			(message) => !!message.textContent?.includes(text) && also(message),
		);
	};
	const observer = new MutationObserver(check);
	observer.observe(document.body, { subtree: true, childList: true, characterData: true });
	return () => {
		check();
		observer.disconnect();
		return shown;
	};
}

const promptText = (request: RecordedRequest) =>
	(request.body as { parts: { type: string; text?: string }[] }).parts
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("");

describe("a draft agent pane", () => {
	it("opens as a chat with messages will look: composer docked at the bottom, focused", async () => {
		await renderChat();

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
		const host = await renderChat({ instructions: ["Prefer small diffs."] });
		const draftThread = page.getByTestId("kilo-chat-thread").element();

		await send("Fix the login form");

		await vi.waitFor(() => expect(host.agent.calls.create).toHaveBeenCalledOnce());
		expect(host.agent.calls.create).toHaveBeenCalledWith({
			workSessionId: "wses_1",
			directory: "/projects/app",
			workspaceId: "w-app",
			workspaceFolders: [
				{ path: "/projects/app", isPrimary: true },
				{ path: "/projects/lib", isPrimary: false },
			],
		});
		await vi.waitFor(() =>
			expect(host.sessions.calls.update).toHaveBeenCalledWith({
				workSessionId: "wses_1",
				paneId: "pane_agent",
				object: chatPaneObject("ses_new_1"),
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
		// The thread that sent the first message keeps showing its chat.
		expect(page.getByTestId("kilo-chat-thread").element()).toBe(draftThread);
		expect(host.server.requestsTo("GET", "/session/ses_new_1/message").length).toBeLessThanOrEqual(
			1,
		);
	});

	it("starts an unscoped session's chat without a directory", async () => {
		const host = await renderChat({
			workSession: workSession({ workspaceId: null }),
			workspaceId: null,
			directory: null,
		});

		await send("Hi");

		await vi.waitFor(() =>
			expect(host.agent.calls.create).toHaveBeenCalledWith({ workSessionId: "wses_1" }),
		);
		const [prompt] = await promptsTo(host.server, "ses_new_1");
		expect(prompt!.directory).toBe("/chats/chat-1");
	});

	it("passes a worktree session's branch and folder", async () => {
		const host = await renderChat({
			workSession: workSession({
				branch: "kilo/fix",
				directory: "/projects/app/.kilo/worktrees/fix",
			}),
			directory: "/projects/app/.kilo/worktrees/fix",
		});

		await send("Hi");

		await vi.waitFor(() =>
			expect(host.agent.calls.create).toHaveBeenCalledWith(
				expect.objectContaining({
					directory: "/projects/app/.kilo/worktrees/fix",
					worktreeBranch: "kilo/fix",
				}),
			),
		);
	});

	it("says why a chat couldn't start and returns the message to the composer", async () => {
		const host = await renderChat({ createError: "The Kilo server isn't running." });

		await send("Try this");

		await expect.element(page.getByText("Could not start the chat")).toBeVisible();
		await expect.element(composerInput()).toHaveTextContent("Try this");
		expect(host.sessions.calls.update).not.toHaveBeenCalledWith(
			expect.objectContaining({ object: expect.anything() }),
		);
	});

	it("can't start a chat without kilo.core's chats", async () => {
		await renderChat({ withoutAgent: true });

		await send("Hello?");

		await expect.element(page.getByText("kilo.core's chats are not available.")).toBeVisible();
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
		await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
		});

		await expect.element(page.getByText("What does login do?")).toBeVisible();
		await expect.element(page.getByText("credentials")).toBeVisible();
		await expect.element(page.getByText(/^Worked for/)).toBeVisible();
		await expect.element(page.getByTestId("kilo-chat-thread")).not.toHaveAttribute("data-draft");
		expect(server.requestsTo("GET", "/session/ses_a")[0]!.directory).toBe("/projects/app");
	});

	it("starts a new chat in an agent pane naming none, though the session's chat is closed", async () => {
		const server = serverWithChat("ses_a", [userMessage("ses_a", "msg_u1", "The closed chat")]);
		await renderChat({
			server,
			workSession: workSession({ chatIds: ["ses_a"], directory: "/projects/app" }),
			pane: agentPane({ id: "pane_new" }),
			chats: [chatSummary("ses_a")],
		});

		await userEvent.fill(page.getByTestId("kilo-composer-input"), "Something new");
		await page.getByTestId("kilo-composer-send").click();

		const [prompt] = await promptsTo(server, "ses_new_1");
		expect(promptText(prompt!)).toBe("Something new");
		expect(page.getByText("The closed chat").elements()).toHaveLength(0);
	});

	it("leaves an agent pane added beside another a draft that starts a chat of its own", async () => {
		const server = serverWithChat("ses_a", [userMessage("ses_a", "msg_u1", "The first chat")]);
		const host = await renderChat({
			server,
			workSession: workSession({ chatIds: ["ses_a"], directory: "/projects/app" }),
			otherPanes: [agentPane({ id: "pane_first", object: chatPaneObject("ses_a") })],
			pane: agentPane({ id: "pane_second" }),
			chats: [chatSummary("ses_a")],
		});

		const first = page.getByTestId("pane-pane_first");
		const second = page.getByTestId("pane-pane_second");
		await expect.element(first.getByText("The first chat")).toBeVisible();
		await expect.element(second.getByTestId("kilo-chat-thread")).toHaveAttribute("data-draft");

		await userEvent.fill(second.getByTestId("kilo-composer-input"), "A second chat");
		await second.getByTestId("kilo-composer-send").click();

		const [prompt] = await promptsTo(server, "ses_new_1");
		expect(promptText(prompt!)).toBe("A second chat");
		await vi.waitFor(() =>
			expect(host.panes().panes.find((pane) => pane.id === "pane_second")?.object).toEqual(
				chatPaneObject("ses_new_1"),
			),
		);
		await expect.element(first.getByText("The first chat")).toBeVisible();
	});

	it("finds a chat's folder from the server when nothing else knows it", async () => {
		const server = serverWithChat("ses_far", [userMessage("ses_far", "msg_u1", "Far away")]);
		await renderChat({ server, pane: agentPane({ object: chatPaneObject("ses_far") }) });

		await expect.element(page.getByText("Far away")).toBeVisible();
	});

	it("streams the reply as it arrives", async () => {
		const server = serverWithChat();
		await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
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
		await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
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
		await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
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
		await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
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

		const shownWithAttachment = watchTranscriptFor(
			"Read these",
			(message) => !!message.querySelector('[data-qa-id="chat-attachment-tile"]'),
		);

		await send("Read these");

		const [prompt] = await promptsTo(server, "ses_a");
		const parts = (prompt!.body as { parts: Record<string, unknown>[] }).parts;
		expect(parts).toContainEqual(expect.objectContaining({ type: "file", filename: "notes.md" }));
		expect(promptText(prompt!)).toBe("Read these");
		expect(shownWithAttachment()).toBe(true);
	});

	it("keeps the window's one event stream open after its last pane goes", async () => {
		const server = serverWithChat();
		const host = await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
		});
		await vi.waitFor(() => expect(server.openStreams).toBe(1));

		host.view.unmount();
		await new Promise((resolve) => setTimeout(resolve, 100));

		expect(server.openStreams).toBe(1);
		expect(server.requestsTo("GET", "/global/event")).toHaveLength(1);
	});

	it("closes the previous test window's event stream before the next host opens", async () => {
		const first = serverWithChat();
		await renderChat({
			server: first,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
		});
		await vi.waitFor(() => expect(first.openStreams).toBe(1));

		const second = serverWithChat();
		await renderChat({
			server: second,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
		});

		await vi.waitFor(() => expect(first.openStreams).toBe(0));
		await vi.waitFor(() => expect(second.openStreams).toBe(1));
	});
});

describe("a turn that ends while its chat opens", () => {
	const working = assistantMessage("ses_a", "msg_a1", "msg_u1", [
		{ type: "text", text: "Working on it", time: { start: 1, end: 2 } },
	]);
	const unfinished = {
		...working,
		info: { ...working.info, finish: undefined, time: { created: Date.now() } },
	};

	function busyChat() {
		const server = serverWithChat("ses_a", [
			userMessage("ses_a", "msg_u1", "Hello", 1),
			unfinished,
		]);
		server.addChat({
			id: "ses_b",
			directory: "/projects/app",
			title: "Other",
			messages: [userMessage("ses_b", "msg_b1", "Elsewhere")],
		});
		server.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });
		return server;
	}

	/** Waits until the opening chat has read its status, then ends its turn. */
	async function endTurnOnceStatusIsRead(server: FakeKiloServer, statusReadsBefore: number) {
		await expect.element(page.getByText("Working on it")).toBeVisible();
		await vi.waitFor(() =>
			expect(server.requestsTo("GET", "/session/status").length).toBeGreaterThan(statusReadsBefore),
		);
		await expect.element(page.getByTestId("kilo-composer-stop")).toBeVisible();
		server.chats.get("ses_a")!.messages[1] = working;
		server.emit("message.updated", { info: working.info });
		server.emit("session.status", { sessionID: "ses_a", status: { type: "idle" } });
		server.emit("session.idle", { sessionID: "ses_a" });
	}

	it("shows it ended when the chat was switched to", async () => {
		const server = busyChat();
		const host = await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_b") }),
			chats: [chatSummary("ses_a"), chatSummary("ses_b")],
		});
		await expect.element(page.getByText("Elsewhere")).toBeVisible();
		await vi.waitFor(() => expect(server.openStreams).toBe(1));
		server.eventStreamDelayMs = 300;
		const statusReads = server.requestsTo("GET", "/session/status").length;

		await host.host.renderer.kernelSdk.domainObjects.get(Panes)!.methods.update({
			workSessionId: "wses_1",
			paneId: "pane_agent",
			object: chatPaneObject("ses_a"),
		});
		await endTurnOnceStatusIsRead(server, statusReads);

		await expect.element(page.getByTestId("kilo-composer-send")).toBeVisible();
		await expect.element(page.getByText("Considering next steps")).not.toBeInTheDocument();
	});

	it("shows it ended when the window's event stream was still connecting", async () => {
		const server = busyChat();
		let openStream!: () => void;
		server.eventStreamGate = new Promise((resolve) => {
			openStream = resolve;
		});

		await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a"), chatSummary("ses_b")],
		});
		await endTurnOnceStatusIsRead(server, 0);
		expect(server.openStreams).toBe(0);
		openStream();

		await vi.waitFor(() => expect(server.openStreams).toBe(1));
		await expect.element(page.getByTestId("kilo-composer-send")).toBeVisible();
	});
});

describe("a prompt queued while the agent works", () => {
	function twoChats() {
		const server = serverWithChat();
		server.addChat({
			id: "ses_b",
			directory: "/projects/app",
			title: "Other",
			messages: [userMessage("ses_b", "msg_b1", "Elsewhere")],
		});
		return server;
	}

	async function queueWhileBusy(text: string) {
		const server = twoChats();
		const host = await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a"), chatSummary("ses_b")],
		});
		await expect.element(page.getByText("Hello")).toBeVisible();
		await vi.waitFor(() => expect(server.openStreams).toBe(1));
		server.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });
		await expect.element(page.getByTestId("kilo-composer-stop")).toBeVisible();
		await userEvent.fill(composerInput(), text);
		await page.getByTestId("kilo-composer-queue-submit").click();
		await expect
			.element(page.getByTestId("kilo-composer-queue-toggle"))
			.toHaveTextContent("1 queued");
		return { server, host };
	}

	const showChat = (host: Awaited<ReturnType<typeof renderChat>>, chatId: string) =>
		host.host.renderer.kernelSdk.domainObjects.get(Panes)!.methods.update({
			workSessionId: "wses_1",
			paneId: "pane_agent",
			object: chatPaneObject(chatId),
		});

	it("stays queued when another chat is shown and back", async () => {
		const { host } = await queueWhileBusy("Then add tests");

		await showChat(host, "ses_b");
		await expect.element(page.getByText("Elsewhere")).toBeVisible();
		await showChat(host, "ses_a");
		await expect.element(page.getByText("Hello")).toBeVisible();

		await expect
			.element(page.getByTestId("kilo-composer-queue-item").getByText("Then add tests"))
			.toBeVisible();
	});

	it("is sent when the turn ends while another chat is shown, as it was queued", async () => {
		const { server, host } = await queueWhileBusy("Then add tests");
		await showChat(host, "ses_b");
		await expect.element(page.getByText("Elsewhere")).toBeVisible();

		server.emit("session.status", { sessionID: "ses_a", status: { type: "idle" } });
		server.emit("session.idle", { sessionID: "ses_a" });

		const [prompt] = await promptsTo(server, "ses_a");
		expect(promptText(prompt!)).toBe("Then add tests");
		expect(prompt!.directory).toBe("/projects/app");
		expect(prompt!.body).toMatchObject({
			agent: "code",
			model: { providerID: "acme", modelID: "fast-1" },
			system: expect.stringContaining("/projects/app"),
		});
	});

	async function queueWithAttachment(text: string) {
		const transfer = new DataTransfer();
		transfer.items.add(new File(["# Notes"], "notes.md", { type: "text/markdown" }));
		const dropzone = document.querySelector('[data-slot="aui_composer-shell"]')!;
		for (const type of ["dragenter", "dragover", "drop"]) {
			dropzone.dispatchEvent(
				new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
			);
		}
		await expect.element(page.getByRole("button", { name: "Remove file" })).toBeInTheDocument();
		await userEvent.fill(composerInput(), text);
		await page.getByTestId("kilo-composer-queue-submit").click();
	}

	async function expectQueuedOnly(text: string) {
		const stop = watchTranscriptFor(text);
		await queueWithAttachment(text);
		await expect
			.element(page.getByTestId("kilo-composer-queue-item").getByText(text))
			.toBeVisible();
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(stop()).toBe(false);
	}

	it("shows a prompt queued with an attachment in the queue only, never the transcript", async () => {
		await queueWhileBusy("First");

		await expectQueuedOnly("Read this");
	});

	it("keeps it out of the transcript of a chat this pane started from a draft", async () => {
		const host = await renderChat();
		await send("Fix the login form");
		await promptsTo(host.server, "ses_new_1");
		host.server.emit("session.status", { sessionID: "ses_new_1", status: { type: "busy" } });
		await expect.element(page.getByTestId("kilo-composer-stop")).toBeVisible();

		await expectQueuedOnly("Read this");
	});

	it("carries its attachment, sent as a file part", async () => {
		const { server } = await queueWhileBusy("First");
		await queueWithAttachment("Read this");
		await expect
			.element(page.getByTestId("kilo-composer-queue-toggle"))
			.toHaveTextContent("2 queued");

		server.emit("session.idle", { sessionID: "ses_a" });
		await promptsTo(server, "ses_a");
		server.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });
		server.emit("session.idle", { sessionID: "ses_a" });

		await vi.waitFor(() =>
			expect(server.requestsTo("POST", "/session/ses_a/prompt_async")).toHaveLength(2),
		);
		const second = server.requestsTo("POST", "/session/ses_a/prompt_async")[1]!;
		expect(promptText(second)).toBe("Read this");
		expect((second.body as { parts: unknown[] }).parts).toContainEqual(
			expect.objectContaining({
				type: "file",
				filename: "notes.md",
				url: `data:text/plain;base64,${btoa("# Notes")}`,
			}),
		);
	});

	it("goes with the chat's pane when it pops out", async () => {
		const { host } = await queueWhileBusy("Then add tests");

		await host.popOut();

		await expect
			.element(page.getByTestId("kilo-composer-queue-item").getByText("Then add tests"))
			.toBeVisible();
	});
});

describe("unsent text", () => {
	it("goes with the chat's pane when it pops out", async () => {
		const host = await renderChat({
			server: serverWithChat(),
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
		});
		await expect.element(page.getByText("Hello")).toBeVisible();
		await userEvent.fill(composerInput(), "Half a thought");
		await vi.waitFor(() =>
			expect(host.host.main.kernelSdk.domainObjects.get(Drafts)!.getState().drafts).toEqual({
				wses_1: { text: "", panes: { pane_agent: "Half a thought" } },
			}),
		);

		await host.popOut();

		await expect.element(composerInput()).toHaveTextContent("Half a thought");
	});

	it("leaves the composer once queued, even when the pane renders again as it goes", async () => {
		const server = serverWithChat();
		const host = await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
		});
		await expect.element(page.getByText("Hello")).toBeVisible();
		await vi.waitFor(() => expect(server.openStreams).toBe(1));
		server.emit("session.status", { sessionID: "ses_a", status: { type: "busy" } });
		await expect.element(page.getByTestId("kilo-composer-stop")).toBeVisible();
		await userEvent.fill(composerInput(), "Then add tests");
		await vi.waitFor(() =>
			expect(host.host.main.kernelSdk.domainObjects.get(Drafts)!.getState().drafts).toEqual({
				wses_1: { text: "", panes: { pane_agent: "Then add tests" } },
			}),
		);

		// Anything the pane follows (sessions, chats, panes) can render it in the
		// same commit as the send empties the composer.
		(page.getByTestId("kilo-composer-queue-submit").element() as HTMLElement).click();
		host.rerender();

		await expect
			.element(page.getByTestId("kilo-composer-queue-toggle"))
			.toHaveTextContent("1 queued");
		await expect.element(composerInput()).toHaveTextContent("");
		await vi.waitFor(() =>
			expect(host.host.main.kernelSdk.domainObjects.get(Drafts)!.getState().drafts).toEqual({}),
		);
	});
});

describe("unsent text, when the chat is slow to load", () => {
	it("comes back in the popped-out pane once its chat has loaded", async () => {
		const server = serverWithChat();
		const host = await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
		});
		await expect.element(page.getByText("Hello")).toBeVisible();
		await userEvent.fill(composerInput(), "hi");
		const drafts = host.host.main.kernelSdk.domainObjects.get(Drafts)!;
		await vi.waitFor(() => expect(drafts.getState().drafts.wses_1?.panes?.pane_agent).toBe("hi"));
		server.chatReadDelayMs = 300;
		const kept: (string | undefined)[] = [];
		drafts.subscribe(() => kept.push(drafts.getState().drafts.wses_1?.panes?.pane_agent));

		await host.popOut();

		await expect.element(page.getByText("Hello")).toBeVisible();
		await new Promise((resolve) => setTimeout(resolve, 400));
		await expect.element(composerInput()).toHaveTextContent("hi");
		expect(drafts.getState().drafts.wses_1?.panes?.pane_agent).toBe("hi");
		expect(kept.every((text) => text === "hi")).toBe(true);
	});
});

describe("several agent panes in a session", () => {
	const draftsOf = (host: Awaited<ReturnType<typeof renderChat>>) =>
		host.host.main.kernelSdk.domainObjects.get(Drafts)!.getState().drafts;

	it("keeps each pane's unsent text to itself", async () => {
		const host = await renderChat({
			server: serverWithChat(),
			otherPanes: [agentPane({ id: "pane_first", object: chatPaneObject("ses_a") })],
			pane: agentPane({ id: "pane_second" }),
			chats: [chatSummary("ses_a")],
		});
		const first = page.getByTestId("pane-pane_first");
		const second = page.getByTestId("pane-pane_second");
		await expect.element(first.getByText("Hello")).toBeVisible();

		await userEvent.fill(first.getByTestId("kilo-composer-input"), "First thought");
		await userEvent.fill(second.getByTestId("kilo-composer-input"), "Second thought");

		await vi.waitFor(() =>
			expect(draftsOf(host).wses_1?.panes).toEqual({
				pane_first: "First thought",
				pane_second: "Second thought",
			}),
		);
		await expect
			.element(first.getByTestId("kilo-composer-input"))
			.toHaveTextContent("First thought");
	});

	it("starts a pane added later empty", async () => {
		const host = await renderChat({ pane: agentPane({ id: "pane_first" }) });
		await userEvent.fill(
			page.getByTestId("pane-pane_first").getByTestId("kilo-composer-input"),
			"Half a thought",
		);
		await vi.waitFor(() =>
			expect(draftsOf(host).wses_1?.panes).toEqual({ pane_first: "Half a thought" }),
		);

		await host.host.renderer.kernelSdk.domainObjects
			.get(Panes)!
			.methods.open({ workSessionId: "wses_1", kind: "kilo.chat/agent", paneId: "pane_second" });

		const second = page.getByTestId("pane-pane_second");
		await expect.element(second.getByTestId("kilo-composer-input")).toBeVisible();
		await expect.element(second.getByTestId("kilo-composer-input")).toHaveTextContent("");
		expect(draftsOf(host).wses_1?.panes).toEqual({ pane_first: "Half a thought" });
	});

	it("takes each pane's unsent text with it when it pops out", async () => {
		const host = await renderChat({
			otherPanes: [agentPane({ id: "pane_first", object: chatPaneObject("ses_a") })],
			pane: agentPane({ id: "pane_second" }),
		});
		await userEvent.fill(
			page.getByTestId("pane-pane_second").getByTestId("kilo-composer-input"),
			"Only in the second",
		);
		await vi.waitFor(() =>
			expect(draftsOf(host).wses_1?.panes?.pane_second).toBe("Only in the second"),
		);

		await host.popOut();

		await expect
			.element(page.getByTestId("pane-pane_second").getByTestId("kilo-composer-input"))
			.toHaveTextContent("Only in the second");
		await expect
			.element(page.getByTestId("pane-pane_first").getByTestId("kilo-composer-input"))
			.toHaveTextContent("");
	});
});

describe("focus-composer", () => {
	it("focuses the open session's composer", async () => {
		const host = await renderChat();
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
		const host = await renderChat({
			otherPanes: [TERMINAL_PANE],
		});
		await host.host.renderer.kernelSdk.domainObjects
			.get(Panes)!
			.methods.activate({ workSessionId: "wses_1", paneId: "pane_term" });

		await host.run("focus-composer");

		await vi.waitFor(() => expect(host.panes().activePaneId).toBe("pane_agent"));
		await expect.element(composerInput()).toHaveFocus();
	});

	it("brings forward the session's first agent pane when it has several", async () => {
		const host = await renderChat({
			otherPanes: [agentPane({ id: "pane_first" }), TERMINAL_PANE],
			pane: agentPane({ id: "pane_second" }),
		});
		await host.host.renderer.kernelSdk.domainObjects
			.get(Panes)!
			.methods.activate({ workSessionId: "wses_1", paneId: "pane_term" });

		await host.run("focus-composer");

		await vi.waitFor(() => expect(host.panes().activePaneId).toBe("pane_first"));
		expect(host.sessions.calls.open).not.toHaveBeenCalled();
	});

	it("adds an agent pane when the session has none", async () => {
		const host = await renderChat({
			pane: TERMINAL_PANE,
		});

		await host.run("focus-composer");

		await vi.waitFor(() => expect(host.sessions.calls.open).toHaveBeenCalledOnce());
		await expect.element(composerInput()).toHaveFocus();
	});
});
