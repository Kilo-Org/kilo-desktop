import type {
	SessionMessageAssistant,
	SessionMessageAssistantTool,
	SessionMessageInfo,
} from "@kilocode/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { chatPaneObject, HTML_RENDER_TOOL_NAME, MEDIA_PANE_KIND } from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import { FakeKilo2Server } from "../../test/kilo2/fake-kilo2-server";
import {
	assistantMessage,
	idleMessage,
	session,
	text,
	tool,
	userMessage,
} from "../../test/kilo2/fixtures";
import { button, expandAll, expandUntil } from "../../test/transcript";
import { renderChat } from "../../test/render-chat";

afterEach(() => {
	vi.unstubAllGlobals();
});

function pngDataUrl(width: number, height: number): string {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (context) {
		context.fillStyle = "teal";
		context.fillRect(0, 0, width, height);
	}
	return canvas.toDataURL("image/png");
}

/** A completed call of `name` that returned the image `uri` as `filename`. */
function imageTool(name: string, uri: string, filename: string): SessionMessageAssistantTool {
	const call = tool(name, {});
	return {
		...call,
		state: {
			status: "completed",
			input: {},
			content: [{ type: "file", uri, mime: "image/png", name: filename }],
			metadata: {},
		},
	};
}

/** A completed call of `name` that reports `metadata`. */
function toolWith(
	name: string,
	input: Record<string, unknown>,
	metadata: Record<string, unknown>,
): SessionMessageAssistantTool {
	const call = tool(name, input, "Done");
	return { ...call, state: { ...call.state, metadata } as SessionMessageAssistantTool["state"] };
}

async function showReply(
	content: SessionMessageAssistant["content"],
	server = new FakeKilo2Server(),
) {
	const messages: SessionMessageInfo[] = [
		userMessage("Make me a chart"),
		assistantMessage(content, { finish: "stop", rawFinish: "stop" }),
		idleMessage(),
	];
	server.addChat(session("ses_a", { title: "Chat" }), messages);
	const host = await renderChat({
		server,
		pane: agentPane({ object: chatPaneObject("ses_a") }),
		chats: [chatSummary("ses_a")],
	});
	return { host, server };
}

const viewer = () => page.getByTestId("chat-media-pane");

describe("images in a reply", () => {
	it("shows the images a tool returned under its row while the turn runs", async () => {
		const server = new FakeKilo2Server();
		const {
			finish: _finish,
			rawFinish: _rawFinish,
			time: { completed: _completed, ...time },
			...step
		} = assistantMessage([imageTool("screenshot", pngDataUrl(10, 10), "live.png")]);
		// Not finished: no completion time or finish reason yet.
		server.addChat(session("ses_a", { title: "Chat" }), [userMessage("Look"), { ...step, time }]);
		server.startTurn("ses_a");
		await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
		});

		await expandUntil([button(/Used 1 tool/)], () =>
			expect(
				page
					.getByTestId("chat-tool-images")
					.getByRole("button", { name: "Open live.png in viewer" })
					.element(),
			).toBeVisible(),
		);
	});

	it("shows the images a tool returned below a settled turn's fold, and opens them in the viewer", async () => {
		await showReply([
			imageTool("screenshot", pngDataUrl(30, 30), "screen.png"),
			text("That's the page."),
		]);

		const images = page.getByTestId("chat-tool-images");
		await expect
			.element(images.getByRole("button", { name: "Open screen.png in viewer" }))
			.toBeVisible();
		// Shown once, below the fold: opened, the fold renders nothing for it.
		await expandAll();
		await expect.element(page.getByText("screenshot", { exact: false })).toBeVisible();
		expect(document.querySelectorAll('[data-qa-id="chat-tool-images"]')).toHaveLength(1);

		await images.getByRole("button", { name: "Open screen.png in viewer" }).click();

		await expect.element(viewer().getByRole("heading", { name: "screen.png" })).toBeVisible();
	});

	it("reads an image file the turn saved and opens it in the viewer", async () => {
		const server = new FakeKilo2Server();
		server.files["out/plot.png"] = Uint8Array.from(
			atob(pngDataUrl(40, 20).split(",")[1]!),
			(char) => char.charCodeAt(0),
		);
		await showReply(
			[
				tool("shell", { command: "python plot.py -o out/plot.png" }, "Saved"),
				tool("write", { path: "/projects/app/out/plot.png", content: "" }),
				toolWith(
					"patch",
					{ patchText: "*** Begin Patch\n*** Add File: gone.png\n*** End Patch" },
					{
						files: [
							{
								file: "/projects/app/gone.png",
								patch: "",
								additions: 0,
								deletions: 0,
								status: "added",
							},
						],
					},
				),
				text("Saved the plot."),
			],
			server,
		);

		const saved = page.getByRole("group", { name: "Images saved in this turn" });
		await saved.getByRole("button", { name: "Open plot.png in viewer" }).click();

		await expect.element(viewer().getByRole("heading", { name: "plot.png" })).toBeVisible();
		// A file that can't be read (deleted since) is left out.
		expect(document.querySelectorAll('[data-qa-id="chat-saved-images"] img')).toHaveLength(1);
		expect(document.querySelector('[data-qa-id="chat-image-unavailable"]')).toBeNull();
	});

	it("says when an image a tool returned can't be shown", async () => {
		await showReply([
			imageTool("screenshot", "https://example.com/a.png", "remote.png"),
			text("Done."),
		]);

		await expect
			.element(page.getByTestId("chat-image-unavailable"))
			.toHaveTextContent("Couldn't show remote.png");
	});
});

describe("pages in the viewer", () => {
	it("opens the agent's page in the Viewer pane, alongside the reply's images", async () => {
		const { host } = await showReply([
			tool(HTML_RENDER_TOOL_NAME, { title: "Sales chart", html: "<p>chart</p>" }),
			imageTool("screenshot", pngDataUrl(20, 20), "logo.png"),
			text("Here it is."),
		]);

		await page.getByRole("button", { name: "Open Sales chart in viewer" }).click();

		await expect.element(viewer().getByRole("heading", { name: "Sales chart" })).toBeVisible();
		await expect.element(viewer().getByTitle("Sales chart")).toBeInTheDocument();
		await expect.element(viewer().getByTestId("media-lightbox-counter")).toHaveTextContent("1 / 2");
		expect(
			document.querySelector(
				'[data-qa-id="chat-media-pane"] [data-qa-id="media-lightbox-zoom-in"]',
			),
		).toBeNull();
		expect(host.sessions.calls.open).toHaveBeenLastCalledWith(
			expect.objectContaining({ kind: MEDIA_PANE_KIND, title: "Sales chart", iconKey: "page" }),
		);

		await userEvent.keyboard("{ArrowRight}");
		await expect.element(viewer().getByRole("heading", { name: "logo.png" })).toBeVisible();
	});
});
