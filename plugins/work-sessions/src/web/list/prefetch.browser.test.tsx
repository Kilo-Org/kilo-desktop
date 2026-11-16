import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { PanePrefetchInput } from "../../contracts";
import { pane, paneKindPlugin, panesOf, renderWorkSessions, workSession } from "../../testing";
import { PREFETCH_HOVER_DELAY_MS } from "./use-prefetch-work-session";

const row = (title: string) =>
	page
		.getByTestId("session-list-item")
		.filter({ hasText: title })
		.getByTestId("session-list-item-trigger");

async function renderSessions() {
	const prefetch = vi.fn<(input: PanePrefetchInput) => void>();
	const plugin = paneKindPlugin("acme.prefetch", [
		{ id: "agent", component: () => <div>agent</div>, prefetch },
		{ id: "plain", component: () => <div>plain</div> },
	]);
	const rendered = await renderWorkSessions({
		workSessions: [
			workSession("a", { title: "Open one" }),
			workSession("b", { title: "Other one" }),
		],
		panes: {
			a: panesOf([pane("pa", "acme.prefetch/agent")]),
			b: panesOf([pane("pb1", "acme.prefetch/agent"), pane("pb2", "acme.prefetch/plain")]),
		},
		open: "a",
		guests: [plugin],
	});
	return { ...rendered, prefetch };
}

describe("prefetching a work session on hover", () => {
	it("asks each pane's kind to load ahead once the pointer rests on the row", async () => {
		const { prefetch } = await renderSessions();

		await row("Other one").hover();

		await vi.waitFor(() => expect(prefetch).toHaveBeenCalledOnce());
		const [input] = prefetch.mock.calls[0]!;
		expect(input.workSession.id).toBe("b");
		expect(input.pane.id).toBe("pb1");
		expect(input.panes.map((candidate) => candidate.id)).toEqual(["pb1", "pb2"]);
		// The real pointer would stay where this row was, over the next test's same row.
		await row("Other one").unhover();
	});

	it("loads nothing for a pointer that leaves before resting", async () => {
		const { prefetch } = await renderSessions();
		await expect.element(row("Other one")).toBeVisible();
		const item = row("Other one").element().closest('[data-qa-id="session-list-item"]')!;

		item.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
		item.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, PREFETCH_HOVER_DELAY_MS * 3));

		expect(prefetch).not.toHaveBeenCalled();
	});

	it("doesn't prefetch the session already open", async () => {
		const { prefetch } = await renderSessions();

		await row("Open one").hover();
		await new Promise((resolve) => setTimeout(resolve, PREFETCH_HOVER_DELAY_MS * 3));

		const prefetched = prefetch.mock.calls.map(([input]) => input.workSession.id);
		expect(prefetched).not.toContain("a");
	});
});
