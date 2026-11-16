import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { chatPaneObject, HTML_RENDER_TOOL_NAME, MEDIA_PANE_KIND } from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import {
	assistantMessage,
	FakeKiloServer,
	userMessage,
	type FakeMessage,
} from "../../test/fake-kilo-server";
import { expandAll, toolPart } from "../../test/transcript";
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

async function showReply(parts: Record<string, unknown>[], server = new FakeKiloServer()) {
	const messages: FakeMessage[] = [
		userMessage("ses_a", "msg_1", "Make me a chart"),
		assistantMessage("ses_a", "msg_2", "msg_1", parts),
	];
	server.addChat({ id: "ses_a", directory: "/projects/app", title: "Chat", messages });
	const host = await renderChat({
		server,
		pane: agentPane({ object: chatPaneObject("ses_a") }),
		chats: [chatSummary("ses_a")],
	});
	return { host, server };
}

const answer = (text: string) => ({ type: "text", text, time: { start: 1, end: 2 } });
const viewer = () => page.getByTestId("chat-media-pane");

describe("images in a reply", () => {
	it("shows an image the assistant attached and opens it in the viewer", async () => {
		await showReply([
			{ type: "file", mime: "image/png", filename: "chart.png", url: pngDataUrl(40, 20) },
			answer("Here is the chart."),
		]);

		await page.getByRole("button", { name: "Open chart.png in viewer" }).click();

		await expect.element(viewer().getByRole("heading", { name: "chart.png" })).toBeVisible();
	});

	it("shows the images a tool returned under its row while the turn runs", async () => {
		const server = new FakeKiloServer();
		const reply = assistantMessage("ses_a", "msg_2", "msg_1", [
			toolPart("screenshot", {
				attachments: [
					{ type: "file", mime: "image/png", url: pngDataUrl(10, 10), filename: "live.png" },
				],
			}),
		]);
		// Not finished: no completion time or finish reason yet.
		const { finish: _finish, ...running } = reply.info;
		server.addChat({
			id: "ses_a",
			directory: "/projects/app",
			title: "Chat",
			messages: [
				userMessage("ses_a", "msg_1", "Look"),
				{ ...reply, info: { ...running, time: { created: Date.now() } } },
			],
		});
		await renderChat({
			server,
			pane: agentPane({ object: chatPaneObject("ses_a") }),
			chats: [chatSummary("ses_a")],
		});

		await expandAll();

		await expect
			.element(
				page
					.getByTestId("chat-tool-images")
					.getByRole("button", { name: "Open live.png in viewer" }),
			)
			.toBeVisible();
	});

	it("shows the images a tool returned below a settled turn's fold", async () => {
		const shot = pngDataUrl(30, 30);
		await showReply([
			toolPart("screenshot", {
				input: {},
				attachments: [
					{
						id: "att_1",
						sessionID: "ses_a",
						messageID: "msg_2",
						type: "file",
						mime: "image/png",
						filename: "screen.png",
						url: shot,
					},
				],
			}),
			answer("That's the page."),
		]);

		const images = page.getByTestId("chat-tool-images");
		await expect
			.element(images.getByRole("button", { name: "Open screen.png in viewer" }))
			.toBeVisible();
		// Shown once, below the fold: opened, the fold renders nothing for it.
		await expandAll();
		await expect.element(page.getByText("screenshot", { exact: false })).toBeVisible();
		expect(document.querySelectorAll('[data-qa-id="chat-tool-images"]')).toHaveLength(1);
	});

	it("reads an image file the turn saved and opens it in the viewer", async () => {
		const server = new FakeKiloServer();
		server.files["out/plot.png"] = {
			type: "text",
			content: pngDataUrl(40, 20).split(",")[1]!,
			encoding: "base64",
			mimeType: "image/png",
		};
		await showReply(
			[
				toolPart("bash", { input: { command: "python plot.py -o out/plot.png && rm gone.png" } }),
				{
					type: "patch",
					hash: "h1",
					files: ["/projects/app/out/plot.png", "/projects/app/gone.png"],
				},
				answer("Saved the plot."),
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

	it("says when an image it was given can't be shown", async () => {
		await showReply([
			{ type: "file", mime: "image/png", filename: "remote.png", url: "https://example.com/a.png" },
			answer("Done."),
		]);

		await expect
			.element(page.getByTestId("chat-image-unavailable"))
			.toHaveTextContent("Couldn't show remote.png");
	});
});

describe("pages in the viewer", () => {
	it("opens the agent's page in the Viewer pane, alongside the reply's images", async () => {
		const { host } = await showReply([
			toolPart(HTML_RENDER_TOOL_NAME, {
				input: { title: "Sales chart", html: "<p>chart</p>" },
			}),
			{ type: "file", mime: "image/png", filename: "logo.png", url: pngDataUrl(20, 20) },
			answer("Here it is."),
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
