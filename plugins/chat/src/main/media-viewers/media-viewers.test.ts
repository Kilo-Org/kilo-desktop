import { afterEach, describe, expect, it, vi } from "vitest";

import {
	EMPTY_WORK_SESSION_PANES,
	Panes,
	type Pane,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	HTML_RENDER_MAX_HTML_LENGTH,
	MEDIA_IMAGE_MAX_LENGTH,
	MEDIA_PANE_KIND,
	MEDIA_VIEWER_MAX_ITEMS,
	MEDIA_VIEWER_NEIGHBORS_MAX_LENGTH,
	MediaViewers,
	mediaViewerKey,
	type MediaItem,
} from "../../contracts";
import { bootChatMain, settle } from "../test-boot";
import { MEDIA_VIEWERS_MAX_TOTAL_LENGTH, PENDING_PANE_GRACE_MS } from "./index";

const diagram: MediaItem = {
	kind: "mermaid",
	id: "d1",
	code: "flowchart LR\n A-->B",
	label: "Flowchart",
};
const image: MediaItem = {
	kind: "image",
	id: "i1",
	src: "data:image/png;base64,AAAA",
	alt: "Shot",
};

const pane = (id: string, kind = MEDIA_PANE_KIND): Pane => ({
	id,
	kind,
	title: "Viewer",
	metadata: {},
	ordinal: 1,
});

async function boot(initial: Record<string, readonly Pane[]> = {}) {
	const booted = await bootChatMain({
		workSessions: {
			panes: Object.fromEntries(
				Object.entries(initial).map(([workSessionId, panes]) => [
					workSessionId,
					{ ...EMPTY_WORK_SESSION_PANES, panes: [...panes] },
				]),
			),
		},
	});
	await settle();
	const viewers = booted.chatSdk.domainObjects.get(MediaViewers)!;
	const fake = booted.workSessions!;
	return {
		...booted,
		viewers,
		panes: {
			closed: () =>
				fake.calls.close.mock.calls.map(
					([input]) =>
						`${(input as { workSessionId: string }).workSessionId}/${(input as { paneId: string }).paneId}`,
				),
			open: (workSessionId: string, opened: Pane) =>
				fake.panes().setState({
					byWorkSession: {
						...fake.panes().state.byWorkSession,
						[workSessionId]: {
							...(fake.panes().state.byWorkSession[workSessionId] ?? EMPTY_WORK_SESSION_PANES),
							panes: [...fake.panesOf(workSessionId).panes, opened],
						},
					},
				}),
			removeWorkSession: (workSessionId: string) => {
				const { [workSessionId]: _removed, ...rest } = fake.panes().state.byWorkSession;
				fake.panes().setState({ byWorkSession: rest });
			},
		},
		/** The viewer's items as a window fetches them. */
		items: (workSessionId: string, paneId: string) =>
			viewers.methods.items({ workSessionId, paneId }),
		/** The viewer's entry in the broadcast state. */
		entry: (workSessionId: string, paneId: string) =>
			viewers.getState().viewers[mediaViewerKey(workSessionId, paneId)],
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("media viewers", () => {
	it("keeps a viewer's items while its pane is open and drops them when it closes", async () => {
		const { viewers, items, entry, panes, kernel } = await boot();

		await viewers.methods.show({
			workSessionId: "wses_1",
			paneId: "media:ses_a",
			items: [diagram, image],
		});
		expect(await items("wses_1", "media:ses_a")).toEqual([diagram, image]);

		panes.open("wses_1", pane("media:ses_a"));
		await settle();
		expect(await items("wses_1", "media:ses_a")).toHaveLength(2);

		await kernel.kernelSdk.domainObjects
			.get(Panes)!
			.methods.close({ workSessionId: "wses_1", paneId: "media:ses_a" });
		await settle();
		expect(await items("wses_1", "media:ses_a")).toBeNull();
		expect(entry("wses_1", "media:ses_a")).toBeUndefined();
	});

	it("broadcasts only a revision per viewer, never the items", async () => {
		const { viewers, entry } = await boot();

		await viewers.methods.show({ workSessionId: "wses_1", paneId: "media:a", items: [image] });
		const first = entry("wses_1", "media:a")?.revision;
		await viewers.methods.show({ workSessionId: "wses_1", paneId: "media:a", items: [diagram] });

		expect(entry("wses_1", "media:a")).toEqual({ revision: expect.any(Number) });
		expect(entry("wses_1", "media:a")!.revision).toBeGreaterThan(first!);
		expect(JSON.stringify(viewers.getState())).not.toContain("data:image");
	});

	it("drops a viewer whose work session went away with its panes", async () => {
		const { viewers, items, panes } = await boot();
		await viewers.methods.show({
			workSessionId: "wses_1",
			paneId: "media:ses_a",
			items: [diagram],
		});
		panes.open("wses_1", pane("media:ses_a"));
		await settle();

		panes.removeWorkSession("wses_1");
		await settle();

		expect(await items("wses_1", "media:ses_a")).toBeNull();
	});

	it("drops a viewer whose pane never opens", async () => {
		const { viewers, items } = await boot();
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		await viewers.methods.show({
			workSessionId: "wses_1",
			paneId: "media:ses_a",
			items: [diagram],
		});

		vi.advanceTimersByTime(PENDING_PANE_GRACE_MS - 1);
		expect(await items("wses_1", "media:ses_a")).toEqual([diagram]);
		vi.advanceTimersByTime(1);

		expect(await items("wses_1", "media:ses_a")).toBeNull();
	});

	it("keeps a pending viewer whose pane opened in time", async () => {
		const { viewers, items, panes } = await boot();
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		await viewers.methods.show({
			workSessionId: "wses_1",
			paneId: "media:ses_a",
			items: [diagram],
		});
		panes.open("wses_1", pane("media:ses_a"));

		vi.advanceTimersByTime(PENDING_PANE_GRACE_MS);

		expect(await items("wses_1", "media:ses_a")).toEqual([diagram]);
	});

	it("discards the items of a pane that didn't open, but not of an open one", async () => {
		const { viewers, items, panes } = await boot();
		await viewers.methods.show({ workSessionId: "wses_1", paneId: "media:a", items: [diagram] });
		await viewers.methods.show({ workSessionId: "wses_1", paneId: "media:b", items: [image] });
		panes.open("wses_1", pane("media:b"));
		await settle();

		await viewers.methods.discard({ workSessionId: "wses_1", paneId: "media:a" });
		await viewers.methods.discard({ workSessionId: "wses_1", paneId: "media:b" });

		expect(await items("wses_1", "media:a")).toBeNull();
		expect(await items("wses_1", "media:b")).toEqual([image]);
	});

	it("keeps an agent page, up to the tool's own size limit", async () => {
		const { viewers, items } = await boot();
		const page: MediaItem = { kind: "page", id: "p1", title: "Chart", html: "<p>chart</p>" };

		await viewers.methods.show({ workSessionId: "wses_1", paneId: "media:p", items: [page] });

		expect(await items("wses_1", "media:p")).toEqual([page]);
		await expect(
			viewers.methods.show({
				workSessionId: "wses_1",
				paneId: "media:p",
				items: [{ ...page, html: "x".repeat(HTML_RENDER_MAX_HTML_LENGTH + 1) }],
			}),
		).rejects.toThrow();
	});

	it("takes the opened image up to its own limit, and neighbours within their budget", async () => {
		const { viewers } = await boot();
		const target = { workSessionId: "wses_1", paneId: "media:x" };
		const imageOf = (length: number, id: string): MediaItem => ({
			...image,
			id,
			src: `data:image/png;base64,${"A".repeat(length - 22)}`,
		});
		const largest = imageOf(MEDIA_IMAGE_MAX_LENGTH, "opened");
		const neighbour = imageOf(MEDIA_VIEWER_NEIGHBORS_MAX_LENGTH / 2, "n");

		await expect(
			viewers.methods.show({ ...target, items: [largest, neighbour, { ...neighbour, id: "m" }] }),
		).resolves.toEqual({ revision: expect.any(Number) });
		await expect(
			viewers.methods.show({ ...target, items: [imageOf(MEDIA_IMAGE_MAX_LENGTH + 1, "big")] }),
		).rejects.toThrow();
		await expect(
			viewers.methods.show({
				...target,
				items: [largest, neighbour, { ...neighbour, id: "m" }, { ...neighbour, id: "o" }],
			}),
		).rejects.toThrow();
		await expect(
			viewers.methods.show({
				...target,
				items: Array.from({ length: MEDIA_VIEWER_MAX_ITEMS + 1 }, (_, index) => ({
					...diagram,
					id: `d${String(index)}`,
				})),
			}),
		).rejects.toThrow();
	});

	it("holds a bounded amount across viewers, dropping those used longest ago", async () => {
		const { viewers, items, entry } = await boot();
		const big: MediaItem = {
			...image,
			src: `data:image/png;base64,${"A".repeat(MEDIA_IMAGE_MAX_LENGTH - 22)}`,
		};
		const fit = Math.floor(MEDIA_VIEWERS_MAX_TOTAL_LENGTH / big.src.length);
		const paneId = (index: number) => `media:${String(index)}`;
		for (let index = 0; index < fit; index++) {
			await viewers.methods.show({ workSessionId: "wses_1", paneId: paneId(index), items: [big] });
		}
		// Fetching the first viewer (its pane is showing it) makes it the most recently used.
		expect(await items("wses_1", paneId(0))).toHaveLength(1);

		await viewers.methods.show({ workSessionId: "wses_1", paneId: paneId(fit), items: [big] });

		expect(await items("wses_1", paneId(1))).toBeNull();
		expect(entry("wses_1", paneId(1))).toBeUndefined();
		expect(await items("wses_1", paneId(0))).toHaveLength(1);
		expect(await items("wses_1", paneId(fit))).toHaveLength(1);
	});

	it("closes viewer panes restored at launch, whose items are gone, and only those", async () => {
		const { panes } = await boot({
			wses_1: [pane("media:ses_a"), pane("agent", "kilo.chat/agent")],
			wses_2: [pane("media:ses_b")],
		});

		expect(panes.closed().sort()).toEqual(["wses_1/media:ses_a", "wses_2/media:ses_b"]);
	});

	it("takes items only from kilo.chat, and only what other windows can show", async () => {
		const { viewers, as } = await boot();
		const other = as("kilo.work-sessions").get(MediaViewers)!.methods;
		const target = { workSessionId: "wses_1", paneId: "media:x" };

		await expect(other.show({ ...target, items: [diagram] })).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		await expect(other.items(target)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(other.discard(target)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(
			viewers.methods.show({
				workSessionId: "wses_1",
				paneId: "media:x",
				items: [{ ...image, src: "blob:kilo-desktop://app/123" }],
			}),
		).rejects.toThrow();
	});
});
