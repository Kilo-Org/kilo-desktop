import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { AccountState } from "@kilo-desktop/plugin-core/contracts";

import { chatPaneObject, MEDIA_PANE_KIND, mediaPaneId } from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import { renderChat } from "../../test/render-chat";
import { SIGNED_OUT } from "../../test/kernel-harness";
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

async function showChat(messages: FakeMessage[], options: { identity?: AccountState } = {}) {
	const server = new FakeKiloServer();
	server.addChat({ id: "ses_a", directory: "/projects/app", title: "Chat", messages });
	return renderChat({
		server,
		pane: agentPane({ object: chatPaneObject("ses_a") }),
		chats: [chatSummary("ses_a")],
		...options,
	});
}

function pngDataUrl(width: number, height: number): string {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	return canvas.toDataURL("image/png");
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
		await showChat(
			[
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
			],
			{ identity: SIGNED_OUT },
		);

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

	it("opens a sent image and the reply's diagram in one viewer", async () => {
		const sent = userMessage("ses_a", "msg_1", "Draw this");
		const host = await showChat([
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
						url: pngDataUrl(40, 20),
					},
				],
			},
			assistantMessage("ses_a", "msg_2", "msg_1", [
				{
					type: "text",
					text: "```mermaid\nflowchart TD\n  A --> B\n```\n",
					time: { start: 1, end: 2 },
				},
			]),
		]);
		await expect.element(page.getByTestId("chat-mermaid-expand")).toBeVisible();

		await page.getByRole("button", { name: "Image attachment" }).click();

		const viewer = page.getByTestId("chat-media-pane");
		await expect.element(viewer.getByRole("heading", { name: "shot.png" })).toBeVisible();
		await expect.element(viewer.getByTestId("media-lightbox-counter")).toHaveTextContent("1 / 2");
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(host.sessions.calls.open).toHaveBeenLastCalledWith(
			expect.objectContaining({
				kind: MEDIA_PANE_KIND,
				paneId: mediaPaneId("ses_a"),
				title: "shot.png",
				iconKey: "image",
			}),
		);

		await userEvent.keyboard("{ArrowRight}");
		await expect.element(viewer.getByRole("heading", { name: "Flowchart" })).toBeVisible();
		await expect.element(viewer.getByTestId("media-lightbox-counter")).toHaveTextContent("2 / 2");
		await viewer.getByTestId("chat-lightbox-copy-source").click();
		await vi.waitFor(() => expect(host.copied.at(-1)).toContain("flowchart TD"));

		// Opening another item from the chat reuses its viewer pane.
		await page.getByTestId("chat-mermaid-expand").click();
		await expect.element(viewer.getByRole("heading", { name: "Flowchart" })).toBeVisible();
		expect(host.panes().panes.filter((pane) => pane.kind === MEDIA_PANE_KIND)).toHaveLength(1);
	});

	it("opens an unsent image on its own", async () => {
		await renderChat();
		const image = await (await fetch(pngDataUrl(40, 20))).blob();
		const transfer = new DataTransfer();
		transfer.items.add(new File([image], "draft.png", { type: "image/png" }));
		const dropzone = document.querySelector('[data-slot="aui_composer-shell"]')!;
		for (const type of ["dragenter", "dragover", "drop"]) {
			dropzone.dispatchEvent(
				new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }),
			);
		}

		// Away from the tile's Remove button in its top corner.
		await page
			.getByRole("button", { name: "Image attachment" })
			.click({ position: { x: 8, y: 48 } });

		const viewer = page.getByTestId("chat-media-pane");
		await expect.element(viewer.getByRole("heading", { name: "draft.png" })).toBeVisible();
		expect(document.querySelector('[data-qa-id="media-lightbox-counter"]')).toBeNull();
		// The draft's blob URL is only this window's; the pane shows the file's own data.
		expect(
			document
				.querySelector('[data-qa-id="chat-media-pane"] [data-qa-id="media-lightbox-content"] img')
				?.getAttribute("src"),
		).toMatch(/^data:image\/png;base64,/u);
	});

	it("doesn't scroll a new chat, whose docked composer fits the pane", async () => {
		await renderChat();
		await expect.element(page.getByTestId("kilo-composer-dock")).toBeVisible();

		const viewport = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]')!;
		expect(viewport.scrollHeight).toBe(viewport.clientHeight);
	});

	it("leaves the transcript's scrollbar gutters beside the docked composer to the scrollbar", async () => {
		// Classic scrollbars, as on Windows and Linux; headless Chromium's overlay ones take no gutter.
		const classicScrollbars = document.createElement("style");
		classicScrollbars.textContent = "::-webkit-scrollbar { width: 12px; }";
		document.head.append(classicScrollbars);
		onTestFinished(() => classicScrollbars.remove());
		await renderChat();
		await expect.element(page.getByTestId("kilo-composer-dock")).toBeVisible();
		const viewport = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]')!;
		const gutter = (viewport.offsetWidth - viewport.clientWidth) / 2;
		expect(gutter).toBeGreaterThan(0);
		viewport.scrollIntoView();

		const view = viewport.getBoundingClientRect();
		const composer = page.getByTestId("kilo-composer-dock").element().getBoundingClientRect();
		const midline = composer.top + composer.height / 2;
		await vi.waitFor(() => {
			expect(document.elementFromPoint(view.left + gutter / 2, midline)).toBe(viewport);
			expect(document.elementFromPoint(view.right - gutter / 2, midline)).toBe(viewport);
		});
	});

	it("removes an attachment before sending", async () => {
		await renderChat();
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

describe("the conversation map", () => {
	const reply = (id: string, parentId: string, text: string) =>
		assistantMessage("ses_a", id, parentId, [{ type: "text", text, time: { start: 1, end: 2 } }]);
	const twoTurns = () => [
		userMessage("ses_a", "msg_1", "First prompt"),
		reply("msg_2", "msg_1", "First answer"),
		userMessage("ses_a", "msg_3", "Second prompt"),
		reply("msg_4", "msg_3", "Second answer"),
	];
	const rail = () => document.querySelector<HTMLElement>('[data-slot="conversation-map-rail"]');

	async function showWideChat(messages: FakeMessage[]) {
		await page.viewport(1200, 800);
		onTestFinished(() => page.viewport(414, 896));
		return showChat(messages);
	}

	it("stays hidden for one user turn", async () => {
		await showWideChat([
			userMessage("ses_a", "msg_1", "First prompt"),
			reply("msg_2", "msg_1", "First answer"),
		]);
		await expect.element(page.getByText("First answer")).toBeVisible();

		expect(rail()).toBeNull();
	});

	it("marks each user turn from the second one on", async () => {
		await showWideChat(twoTurns());

		const map = page.getByRole("navigation", { name: "Conversation map" });
		await expect.element(map.getByRole("button", { name: "First prompt" })).toBeVisible();
		await expect.element(map.getByRole("button", { name: "Second prompt" })).toBeVisible();
	});

	it("spans the viewport edge to edge whatever width the OS scrollbar gutter has", async () => {
		await showWideChat(twoTurns());
		await vi.waitFor(() => expect(rail()).not.toBeNull());

		const viewport = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]')!;
		await vi.waitFor(() => {
			const view = viewport.getBoundingClientRect();
			const box = rail()!.getBoundingClientRect();
			expect(box.left).toBeCloseTo(view.left, 0);
			expect(box.right).toBeCloseTo(view.right, 0);
		});
	});

	it("scrolls the viewport to the clicked turn", async () => {
		const long = "A long answer line.\n\n".repeat(80);
		await showWideChat([
			userMessage("ses_a", "msg_1", "First prompt"),
			reply("msg_2", "msg_1", long),
			userMessage("ses_a", "msg_3", "Second prompt"),
			reply("msg_4", "msg_3", long),
		]);
		const viewport = document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]')!;
		const first = () => viewport.querySelector<HTMLElement>('[data-message-id="msg_1"]')!;
		await vi.waitFor(() =>
			expect(first().getBoundingClientRect().bottom).toBeLessThan(
				viewport.getBoundingClientRect().top,
			),
		);

		await page
			.getByRole("navigation", { name: "Conversation map" })
			.getByRole("button", { name: "First prompt" })
			.click();
		await vi.waitFor(
			() =>
				expect(first().getBoundingClientRect().top).toBeCloseTo(
					viewport.getBoundingClientRect().top,
					-1,
				),
			{ timeout: 3_000 },
		);
	});
});

describe("a turn Kilo couldn't run", () => {
	const noModel = {
		name: "UnknownError",
		data: { message: "ProviderNoProvidersError: No providers are available\n    at defaultModel" },
	};

	async function send(text: string) {
		await userEvent.fill(page.getByTestId("kilo-composer-input"), text);
		await page.getByTestId("kilo-composer-send").click();
	}

	it("says why instead of working forever", async () => {
		const host = await showChat([]);
		host.server.promptSessionError = noModel;

		await send("Fix the login form");

		await expect
			.element(page.getByTestId("chat-message-error"))
			.toHaveTextContent("No model is available. Connect a provider in Settings to send messages.");
		await expect.element(page.getByTestId("kilo-turn-working")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("kilo-composer-send")).toBeVisible();
		await expect.element(page.getByText("Fix the login form")).toBeVisible();
	});

	it("explains a reply's error once, on the reply", async () => {
		const failed = assistantMessage("ses_a", "msg_2", "msg_1", []);
		const error = { name: "APIError", data: { message: "Rate limited" } };
		const host = await showChat([
			userMessage("ses_a", "msg_1", "Go"),
			{ ...failed, info: { ...failed.info, error } },
		]);
		await expect.element(page.getByTestId("chat-message-error")).toBeVisible();

		host.server.emit("session.error", { sessionID: "ses_a", error });
		host.server.emit("session.idle", { sessionID: "ses_a" });

		await vi.waitFor(() =>
			expect(document.querySelectorAll('[data-qa-id="chat-message-error"]')).toHaveLength(1),
		);
	});
});
