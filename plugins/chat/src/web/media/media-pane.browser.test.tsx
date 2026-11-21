import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { definePlugin } from "@kilo-desktop/kernel";

import {
	chatPaneObject,
	MEDIA_ITEM_METADATA_KEY,
	MEDIA_PANE_KIND,
	MEDIA_IMAGE_MAX_LENGTH,
	MEDIA_VIEWER_MAX_ITEMS,
	mediaPaneId,
	MediaViewers,
	type MediaItem,
} from "../../contracts";
import { agentPane, chatSummary } from "../../test/chat-host";
import { assistantMessage, FakeKiloServer, userMessage } from "../../test/fake-kilo-server";
import { renderInKernel } from "../../test/kernel-harness";
import { renderChat } from "../../test/render-chat";
import { MediaPane } from "./MediaPane";
import {
	prepareViewerItems,
	toMediaItem,
	viewerItemsAround,
	type ViewerItem,
} from "./open-media-pane";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const DIAGRAM_CODE = "flowchart LR\n  A --> B";
const diagram = (id: string): MediaItem => ({
	kind: "mermaid",
	id,
	code: DIAGRAM_CODE,
	label: "Flowchart",
});

async function showDiagrams() {
	const server = new FakeKiloServer();
	server.addChat({
		id: "ses_a",
		directory: "/projects/app",
		title: "Chat",
		messages: [
			userMessage("ses_a", "msg_1", "Draw"),
			assistantMessage("ses_a", "msg_2", "msg_1", [
				{
					type: "text",
					text: "```mermaid\nflowchart LR\n  A --> B\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n",
					time: { start: 1, end: 2 },
				},
			]),
		],
	});
	const host = await renderChat({
		server,
		pane: agentPane({ object: chatPaneObject("ses_a") }),
		chats: [chatSummary("ses_a")],
	});
	// Pele loads lazily, so the first diagrams can take a while on a cold runner.
	await expect
		.poll(() => document.querySelectorAll('[data-qa-id="markdown-mermaid-expand"]').length, {
			timeout: 15_000,
		})
		.toBe(2);
	return host;
}

describe("the media viewer pane", () => {
	it("records the item shown as the person moves between them", async () => {
		const host = await showDiagrams();

		document.querySelectorAll<HTMLElement>('[data-qa-id="markdown-mermaid-expand"]')[1]?.click();
		const viewer = page.getByTestId("chat-media-pane");
		await expect.element(viewer.getByRole("heading", { name: "Sequence diagram" })).toBeVisible();

		await viewer.getByTestId("media-lightbox-prev").click();

		await expect.element(viewer.getByRole("heading", { name: "Flowchart" })).toBeVisible();
		const pane = host.panes().panes.find((candidate) => candidate.kind === MEDIA_PANE_KIND);
		expect(pane?.id).toBe(mediaPaneId("ses_a"));
		expect(host.sessions.calls.update).toHaveBeenLastCalledWith(
			expect.objectContaining({
				paneId: mediaPaneId("ses_a"),
				metadata: { [MEDIA_ITEM_METADATA_KEY]: expect.any(String) },
			}),
		);
		await expect
			.poll(() => document.querySelector('[data-qa-id="media-lightbox-zoom-level"]')?.textContent)
			.toMatch(/%$/u);
		// Stepping remounts the view, and it takes focus back in an effect. Wait
		// for that, or the key lands on the body and never reaches the lightbox.
		await expect
			.poll(() =>
				document.querySelector('[data-qa-id="chat-media-pane"]')?.contains(document.activeElement),
			)
			.toBe(true);
		// A further remount can still swallow one key on a slow runner, so zoom
		// until the view leaves fit-to-window rather than trusting a single press.
		const fit = () =>
			document.querySelector<HTMLButtonElement>('[data-qa-id="media-lightbox-fit"]');
		await expect
			.poll(async () => {
				if (fit()?.disabled) await userEvent.keyboard("+");
				return fit()?.disabled;
			})
			.toBe(false);
		await expect.element(viewer.getByTestId("media-lightbox-fit")).toBeEnabled();
	});

	it("shows the item in a dialog when the pane can't be opened", async () => {
		const host = await showDiagrams();
		host.sessions.calls.open.mockImplementationOnce(() => {
			throw new Error("No room for another pane.");
		});

		document.querySelector<HTMLElement>('[data-qa-id="markdown-mermaid-expand"]')?.click();

		await expect.element(page.getByRole("dialog", { name: "Flowchart" })).toBeVisible();
		expect(document.querySelector('[data-qa-id="chat-media-pane"]')).toBeNull();
	});

	it("shows the items in a popped-out window, as main keeps them", async () => {
		const host = await showDiagrams();
		document.querySelector<HTMLElement>('[data-qa-id="markdown-mermaid-expand"]')?.click();
		await expect
			.element(page.getByTestId("chat-media-pane").getByRole("heading", { name: "Flowchart" }))
			.toBeVisible();

		await host.popOut();

		await expect
			.element(page.getByTestId("chat-media-pane").getByRole("heading", { name: "Flowchart" }))
			.toBeVisible();
		await expect
			.element(page.getByTestId("chat-media-pane").getByTestId("media-lightbox-counter"))
			.toHaveTextContent("1 / 2");
	});

	it("says there's nothing to show when its items are gone", async () => {
		const pane = {
			id: mediaPaneId("ses_gone"),
			kind: MEDIA_PANE_KIND,
			title: "Flowchart",
			metadata: { [MEDIA_ITEM_METADATA_KEY]: "missing" },
			ordinal: 1,
		};
		const viewers = definePlugin({
			activate(sdk) {
				sdk.domainObjects.provide(MediaViewers, {
					initialState: { viewers: {} },
					methods: { show: () => ({ revision: 0 }), items: () => null, discard: () => undefined },
				});
			},
		});

		await renderInKernel(
			<MediaPane workSessionId="wses_1" pane={pane} workspaceId={null} directory={null} visible />,
			{ chatMain: viewers },
		);

		await expect
			.element(page.getByTestId("chat-media-pane-empty").getByText("Nothing to show"))
			.toBeVisible();
	});
});

describe("viewer items", () => {
	it("inlines an unsent file and drops window-local fields", async () => {
		const file = new File([new Uint8Array([1, 2, 3])], "draft.png", { type: "image/png" });

		const item = await toMediaItem({
			kind: "image",
			id: "a",
			src: "blob:kilo/1",
			file,
			alt: "draft.png",
		});

		expect(item).toEqual({
			kind: "image",
			id: "a",
			src: "data:image/png;base64,AQID",
			alt: "draft.png",
		});
		expect(await toMediaItem(diagram("d"))).toEqual(diagram("d"));
	});

	it("keeps the items around the opened one, and none when it can't be shown", () => {
		const items = Array.from({ length: 10 }, (_, index) => diagram(`d${String(index)}`));
		const ids = (list: readonly MediaItem[]) => list.map((item) => item.id);

		expect(ids(viewerItemsAround(items, "d1", 4))).toEqual(["d0", "d1", "d2", "d3"]);
		expect(ids(viewerItemsAround(items, "d6", 4))).toEqual(["d4", "d5", "d6", "d7"]);
		expect(ids(viewerItemsAround(items, "d9", 4))).toEqual(["d6", "d7", "d8", "d9"]);
		expect(
			viewerItemsAround([{ kind: "image", id: "r", src: "https://example.com/a.png" }], "r"),
		).toEqual([]);
	});

	it("always keeps the opened item, and only neighbours within their budget", () => {
		const items = Array.from({ length: 6 }, (_, index) => diagram(`d${String(index)}`));
		const each = DIAGRAM_CODE.length;
		const ids = (list: readonly MediaItem[]) => list.map((item) => item.id);

		expect(ids(viewerItemsAround(items, "d3", 10, each * 2))).toEqual(["d2", "d3", "d4"]);
		expect(ids(viewerItemsAround(items, "d3", 10, each - 1))).toEqual(["d3"]);
	});

	it("carries on along one side when the other side's next item doesn't fit", () => {
		const large: MediaItem = {
			kind: "mermaid",
			id: "big",
			code: "x".repeat(DIAGRAM_CODE.length * 5),
			label: "Large",
		};
		const items = [diagram("a"), large, diagram("opened"), diagram("b"), diagram("c")];

		const kept = viewerItemsAround(items, "opened", 10, DIAGRAM_CODE.length * 2);

		expect(kept.map((item) => item.id)).toEqual(["opened", "b", "c"]);
	});

	it("leaves out a file too large for the viewer without reading it", async () => {
		const readAsDataURL = vi.spyOn(FileReader.prototype, "readAsDataURL");
		const huge = new File([new Uint8Array(1)], "huge.png", { type: "image/png" });
		Object.defineProperty(huge, "size", { value: (MEDIA_IMAGE_MAX_LENGTH / 4) * 3 + 1 });

		const items = await prepareViewerItems(
			[{ kind: "image", id: "huge", src: "blob:kilo/huge", file: huge }, diagram("d")],
			"huge",
		);

		expect(items).toEqual([]);
		expect(readAsDataURL).not.toHaveBeenCalled();
	});

	it("reads only the files it keeps, and leaves out unreadable ones", async () => {
		const readAsDataURL = vi.spyOn(FileReader.prototype, "readAsDataURL");
		const file = (name: string) =>
			new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
		const draft = (id: string, blob: Blob): ViewerItem => ({
			kind: "image",
			id,
			src: `blob:kilo/${id}`,
			file: blob,
		});
		const broken = file("broken.png");
		readAsDataURL.mockImplementation(function (this: FileReader, blob: Blob) {
			if (blob === broken) {
				queueMicrotask(() =>
					this.onerror?.(new ProgressEvent("error") as ProgressEvent<FileReader>),
				);
				return;
			}
			queueMicrotask(() => {
				Object.defineProperty(this, "result", { value: "data:image/png;base64,AQID" });
				this.onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
			});
		});
		const transcript = [
			draft("far", file("far.png")),
			...Array.from({ length: MEDIA_VIEWER_MAX_ITEMS - 1 }, (_, index) =>
				diagram(`d${String(index)}`),
			),
			draft("broken", broken),
			draft("opened", file("opened.png")),
		];

		const items = await prepareViewerItems(transcript, "opened");

		expect(readAsDataURL).toHaveBeenCalledTimes(2);
		expect(items.map((item) => item.id)).not.toContain("broken");
		expect(items.map((item) => item.id)).not.toContain("far");
		expect(items.at(-1)).toMatchObject({ id: "opened", src: "data:image/png;base64,AQID" });
		expect(await prepareViewerItems(transcript, "broken")).toEqual([]);
	});
});
