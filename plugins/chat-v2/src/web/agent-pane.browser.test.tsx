import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { KernelError } from "@kilo-desktop/kernel";
import { Panes, type Pane } from "@kilo-desktop/plugin-work-sessions/contracts";

import { chatPaneObject, COMPOSER_FOCUSED_KEY, Drafts } from "../contracts";
import { agentPane, chatSummary, workSession } from "../test/chat-host";
import { renderChat } from "../test/render-chat";
import {
	assistantMessage,
	FakeKiloServer,
	reasoningContent,
	textContent,
	toolContent,
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

function serverWithChat(chatId = "ses_a", messages = [userMessage("msg_u1", "Hello")]) {
	const server = new FakeKiloServer();
	server.addChat({ id: chatId, directory: "/projects/app", title: "Fix login", messages });
	return server;
}

async function promptsTo(server: FakeKiloServer, chatId: string): Promise<RecordedRequest[]> {
	let prompts: RecordedRequest[] = [];
	await vi.waitFor(() => {
		prompts = server.requestsTo("POST", `/api/session/${chatId}/prompt`);
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

const promptText = (request: RecordedRequest) => (request.body as { text: string }).text;

/** The hidden notes (system text) sent to `chatId`, joined. */
const syntheticTo = (server: FakeKiloServer, chatId: string) =>
	server
		.requestsTo("POST", `/api/session/${chatId}/synthetic`)
		.map((request) => (request.body as { text: string }).text)
		.join("\n");

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
		const system = syntheticTo(host.server, "ses_new_1");
		expect(system).toContain('Primary folder (default working directory): "/projects/app"');
		expect(system).toContain('Additional workspace folder: "/projects/lib"');
		expect(system).toContain("Prefer small diffs.");
		await expect.element(page.getByText("Fix the login form")).toBeVisible();
		// The thread that sent the first message keeps showing its chat.
		expect(page.getByTestId("kilo-chat-thread").element()).toBe(draftThread);
		expect(
			host.server.requestsTo("GET", "/api/session/ses_new_1/message").length,
		).toBeLessThanOrEqual(1);
	});

	// v2 gap (step 22): v2 prompts have no snapshotInitialization; the v2 wire drops it.
	it.skip("asks the first prompt to wait for the workspace snapshot", async () => {
		const host = await renderChat();

		await send("Fix the login form");

		const [prompt] = await promptsTo(host.server, "ses_new_1");
		expect(prompt!.body).toMatchObject({ snapshotInitialization: "wait" });
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
			userMessage("msg_u1", "What does login do?"),
			assistantMessage("msg_a1", [
				reasoningContent("Looking at the form"),
				toolContent("call_1", "read", { path: "/projects/app/login.ts" }, "…"),
				textContent("It posts **credentials**."),
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
		expect(server.requestsTo("GET", "/api/session/ses_a")[0]!.directory).toBe("/projects/app");
	});

	it("starts a new chat in an agent pane naming none, though the session's chat is closed", async () => {
		const server = serverWithChat("ses_a", [userMessage("msg_u1", "The closed chat")]);
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
		const server = serverWithChat("ses_a", [userMessage("msg_u1", "The first chat")]);
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
		const server = serverWithChat("ses_far", [userMessage("msg_u1", "Far away")]);
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

		server.startTurn("ses_a");
		const ids = { sessionID: "ses_a", assistantMessageID: "msg_a1" };
		server.emit("session.step.started", {
			...ids,
			agent: "code",
			model: { providerID: "kilo", id: "test-model" },
			started: Date.now(),
		});
		server.emit("session.text.started", { ...ids, ordinal: 0 });
		server.emit("session.text.delta", { ...ids, ordinal: 0, delta: "Working on" });
		server.emit("session.text.delta", { ...ids, ordinal: 0, delta: " it now" });

		await expect.element(page.getByText("Working on it now")).toBeVisible();
		await expect.element(page.getByTestId("kilo-turn-working")).toBeVisible();
		await expect.element(page.getByTestId("kilo-composer-stop")).toBeVisible();

		server.endTurn("ses_a");
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
		server.startTurn("ses_a");

		await page.getByTestId("kilo-composer-stop").click();

		await vi.waitFor(() =>
			expect(server.requestsTo("POST", "/api/session/ses_a/interrupt")).toHaveLength(1),
		);
		expect(server.requestsTo("POST", "/api/session/ses_a/interrupt")[0]!.directory).toBe(
			"/projects/app",
		);
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
		server.startTurn("ses_a");
		await expect.element(page.getByTestId("kilo-composer-stop")).toBeVisible();

		await userEvent.fill(composerInput(), "Then add tests");
		await page.getByTestId("kilo-composer-queue-submit").click();

		await expect
			.element(page.getByTestId("kilo-composer-queue-toggle"))
			.toHaveTextContent("1 queued");
		await expect
			.element(page.getByTestId("kilo-composer-queue-item").getByText("Then add tests"))
			.toBeVisible();
		expect(server.requestsTo("POST", "/api/session/ses_a/prompt")).toHaveLength(0);

		server.endTurn("ses_a");

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
		const files = (prompt!.body as { files?: Record<string, unknown>[] }).files;
		expect(files).toContainEqual(expect.objectContaining({ name: "notes.md" }));
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

		expect(server.openStreams).toBe(1);
		expect(server.requestsTo("GET", "/api/event")).toHaveLength(1);
	});
});

describe("a turn that ends while its chat opens", () => {
	const working = assistantMessage("msg_a1", [textContent("Working on it")]);
	const { finish: _finish, ...unfinishedReply } = working;
	const unfinished = { ...unfinishedReply, time: { created: Date.now() } };

	function busyChat() {
		const server = serverWithChat("ses_a", [userMessage("msg_u1", "Hello", 1), unfinished]);
		server.addChat({
			id: "ses_b",
			directory: "/projects/app",
			title: "Other",
			messages: [userMessage("msg_b1", "Elsewhere")],
		});
		server.startTurn("ses_a");
		return server;
	}

	/** Waits until the opening chat has read its status, then ends its turn. */
	async function endTurnOnceStatusIsRead(server: FakeKiloServer, statusReadsBefore: number) {
		await expect.element(page.getByText("Working on it")).toBeVisible();
		await vi.waitFor(() =>
			expect(server.requestsTo("GET", "/api/session/active").length).toBeGreaterThan(
				statusReadsBefore,
			),
		);
		await expect.element(page.getByTestId("kilo-composer-stop")).toBeVisible();
		server.chats.get("ses_a")!.messages[1] = working;
		server.emit("message.updated", { info: working.info });
		server.endTurn("ses_a");
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
		const statusReads = server.requestsTo("GET", "/api/session/active").length;

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
			messages: [userMessage("msg_b1", "Elsewhere")],
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
		server.startTurn("ses_a");
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

		server.endTurn("ses_a");

		const [prompt] = await promptsTo(server, "ses_a");
		expect(promptText(prompt!)).toBe("Then add tests");
		expect(prompt!.directory).toBe("/projects/app");
		expect(server.requestsTo("POST", "/api/session/ses_a/agent").at(-1)?.body).toEqual({
			agent: "code",
		});
		expect(server.requestsTo("POST", "/api/session/ses_a/model").at(-1)?.body).toMatchObject({
			model: { providerID: "acme", id: "fast-1" },
		});
		expect(syntheticTo(server, "ses_a")).toContain("/projects/app");
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
		host.server.startTurn("ses_new_1");
		await expect.element(page.getByTestId("kilo-composer-stop")).toBeVisible();

		await expectQueuedOnly("Read this");
	});

	it("carries its attachment, sent as a file part", async () => {
		const { server } = await queueWhileBusy("First");
		await queueWithAttachment("Read this");
		await expect
			.element(page.getByTestId("kilo-composer-queue-toggle"))
			.toHaveTextContent("2 queued");

		server.endTurn("ses_a");
		await promptsTo(server, "ses_a");
		server.startTurn("ses_a");
		server.endTurn("ses_a");

		await vi.waitFor(() =>
			expect(server.requestsTo("POST", "/api/session/ses_a/prompt")).toHaveLength(2),
		);
		const second = server.requestsTo("POST", "/api/session/ses_a/prompt")[1]!;
		expect(promptText(second)).toBe("Read this");
		expect((second.body as { files?: unknown[] }).files).toContainEqual(
			expect.objectContaining({
				name: "notes.md",
				uri: `data:text/plain;base64,${btoa("# Notes")}`,
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
		server.startTurn("ses_a");
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

describe("forking a chat", () => {
	const forkButtons = () => page.getByTestId("kilo-fork-from-here-button");
	const forkButtonOf = (text: string) =>
		[...document.querySelectorAll<HTMLElement>('[data-qa-id="kilo-fork-from-here-button"]')].find(
			(button) =>
				button.closest('[data-slot="aui_user-message-root"]')?.textContent?.includes(text),
		);
	const progress = () => page.getByTestId("kilo-fork-progress");

	function twoTurns() {
		return serverWithChat("ses_a", [
			userMessage("msg_u1", "Fix the login"),
			assistantMessage("msg_a1", [textContent("Fixed login.")]),
			userMessage("msg_u2", "Now the signup"),
			assistantMessage("msg_a2", [textContent("Fixed signup.")]),
		]);
	}

	async function showTwoTurns(server = twoTurns()) {
		const host = await renderChat({
			server,
			workSession: workSession({ chatIds: ["ses_a"] }),
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
		});
		await expect.element(page.getByText("Fixed signup.")).toBeVisible();
		return host;
	}

	async function forkAt(text: string) {
		await vi.waitFor(() => expect(forkButtonOf(text)).toBeDefined());
		forkButtonOf(text)!.click();
	}

	const forkedPane = (host: Awaited<ReturnType<typeof renderChat>>) => {
		const panes = host.sessions.panesOf("wses_1");
		const pane = panes.panes.find((candidate) => candidate.object?.id === "ses_fork_1");
		return pane && { pane, active: panes.activePaneId === pane.id };
	};

	// v2 gap (step 22): v2's /api/event has no fork replay to skip; the v2 wire sends no x-kilo-sse-skip-fork-sync.
	it.skip("asks the window's event stream to leave out the copies a fork replays", async () => {
		const host = await showTwoTurns();

		await vi.waitFor(() => expect(host.server.openStreams).toBe(1));
		const [stream] = host.server.requestsTo("GET", "/api/event");
		expect(stream?.headers.get("x-kilo-sse-skip-fork-sync")).toBe("1");
	});

	it("offers a fork on each of the chat's user messages but the first", async () => {
		await showTwoTurns();

		await vi.waitFor(() => expect(forkButtons().elements()).toHaveLength(1));
		expect(forkButtonOf("Now the signup")).toBeDefined();
		expect(forkButtonOf("Fix the login")).toBeUndefined();
	});

	it("forks a chat started in the pane at a prompt and opens the fork as the active pane", async () => {
		const host = await renderChat();
		await send("Fix the login");
		await expect.element(page.getByText("Fix the login")).toBeVisible();
		const userMessagesOf = (chatId: string) =>
			host.server.chats.get(chatId)?.messages.filter((message) => message.type === "user") ?? [];
		await vi.waitFor(() => expect(userMessagesOf("ses_new_1")).toHaveLength(1));
		host.server.endTurn("ses_new_1");
		await send("Now the signup");
		await vi.waitFor(() => expect(userMessagesOf("ses_new_1")).toHaveLength(2));
		host.server.endTurn("ses_new_1");
		await expect.element(page.getByTestId("kilo-composer-stop")).not.toBeInTheDocument();

		await forkAt("Now the signup");

		await vi.waitFor(() => expect(forkedPane(host)).toMatchObject({ active: true }));
		expect(host.server.requestsTo("POST", "/api/session/ses_new_1/fork")[0]?.body).toEqual({
			before: userMessagesOf("ses_new_1")[1]!.id,
		});
		expect(host.sessions.calls.open).toHaveBeenCalledWith(
			expect.objectContaining({ workSessionId: "wses_1", placement: "tab" }),
		);
		const fork = page.getByTestId(`pane-${forkedPane(host)!.pane.id}`);
		await expect.element(fork.getByText("Fix the login")).toBeVisible();
		expect(fork.getByText("Now the signup").elements()).toHaveLength(0);
		expect(host.telemetry.events("chat-forked")).toEqual([{ success: true, midTurn: false }]);
	});

	it("shows the fork's copied exchange only, not the hidden note it was handed", async () => {
		const host = await showTwoTurns();

		await forkAt("Now the signup");

		await vi.waitFor(() => expect(forkedPane(host)).toMatchObject({ active: true }));
		await vi.waitFor(() =>
			expect(host.server.requestsTo("POST", "/api/session/ses_fork_1/synthetic")).toHaveLength(1),
		);
		const fork = page.getByTestId(`pane-${forkedPane(host)!.pane.id}`);
		await expect.element(fork.getByText("Fixed login.")).toBeVisible();
		await vi.waitFor(() =>
			expect(fork.element().querySelectorAll('[data-slot="aui_user-message-root"]')).toHaveLength(
				1,
			),
		);
		expect(fork.getByText(/forked from an existing session/).elements()).toHaveLength(0);
	});

	it("forks a chat the pane opened with", async () => {
		const host = await showTwoTurns();

		await forkAt("Now the signup");

		await vi.waitFor(() => expect(forkedPane(host)).toMatchObject({ active: true }));
		expect(host.server.requestsTo("POST", "/api/session/ses_a/fork")[0]?.body).toEqual({
			before: "msg_u2",
		});
	});

	it("covers the pane while the fork is made, until the fork opens", async () => {
		const server = twoTurns();
		let release = () => {};
		server.forkGate = new Promise<void>((resolve) => (release = resolve));
		const host = await showTwoTurns(server);

		await forkAt("Now the signup");

		await expect.element(progress()).toHaveTextContent("Forking the chat…");
		const content = page.getByTestId("kilo-agent-pane-content").first();
		await expect.element(content).toHaveAttribute("inert");
		await expect.element(content).toHaveAttribute("aria-busy", "true");
		release();
		await vi.waitFor(() => expect(forkedPane(host)).toMatchObject({ active: true }));
		await expect.element(progress()).not.toBeInTheDocument();
		await expect.element(content).not.toHaveAttribute("inert");
	});

	it("says why the chat couldn't be forked and opens nothing", async () => {
		const server = twoTurns();
		server.failForks = true;
		const host = await showTwoTurns(server);

		await forkAt("Now the signup");

		await expect.element(page.getByText("Could not fork the chat.")).toBeVisible();
		await expect.element(progress()).not.toBeInTheDocument();
		expect(host.sessions.calls.open).not.toHaveBeenCalled();
		expect(host.telemetry.events("chat-forked")).toEqual([{ success: false, midTurn: false }]);
	});

	it("says why the fork couldn't be opened", async () => {
		const host = await showTwoTurns();
		host.sessions.calls.open.mockImplementationOnce(() => {
			throw new KernelError("UNAVAILABLE", "No room.");
		});

		await forkAt("Now the signup");

		await expect.element(page.getByText("Could not open the forked chat.")).toBeVisible();
		await expect.element(progress()).not.toBeInTheDocument();
	});

	it("forks once for a double click", async () => {
		const host = await showTwoTurns();
		await vi.waitFor(() => expect(forkButtonOf("Now the signup")).toBeDefined());

		forkButtonOf("Now the signup")!.click();
		forkButtonOf("Now the signup")!.click();

		await vi.waitFor(() => expect(forkedPane(host)).toMatchObject({ active: true }));
		expect(host.server.requestsTo("POST", "/api/session/ses_a/fork")).toHaveLength(1);
	});

	it("forks while the agent works, noting it was mid-turn", async () => {
		const server = twoTurns();
		const host = await showTwoTurns(server);
		await vi.waitFor(() => expect(server.openStreams).toBe(1));
		server.startTurn("ses_a");
		await expect.element(page.getByTestId("kilo-composer-stop")).toBeVisible();

		await vi.waitFor(() => expect(forkButtonOf("Now the signup")).toBeDefined());
		expect(forkButtonOf("Now the signup")!.hasAttribute("disabled")).toBe(false);
		forkButtonOf("Now the signup")!.click();

		await vi.waitFor(() => expect(forkedPane(host)).toMatchObject({ active: true }));
		expect(host.telemetry.events("chat-forked")).toEqual([{ success: true, midTurn: true }]);
	});
});
