import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { GraphMember, GraphPost } from "./swarm-graph";
import { SwarmGraph } from "./SwarmGraph";

const start = Date.UTC(2026, 10, 23, 12, 0);
const minute = 60_000;

const members: GraphMember[] = [
	{ id: "main", name: "Main agent", color: "#64748B", done: false },
	{ id: "ses_a", name: "Researcher", color: "#6366F1", done: false },
	{ id: "ses_b", name: "Builder", color: "#10B981", done: true },
	{ id: "ses_c", name: "Reviewer", color: "#F59E0B", done: false },
];

const post = (
	seq: number,
	from: string,
	to: string,
	type: GraphPost["type"] = "INFO",
): GraphPost => ({
	id: `post_${seq}`,
	seq,
	from,
	to,
	type,
	timestamp: start + (seq - 1) * minute,
});

/** Six posts a minute apart, from 12:00 to 12:05. */
const posts: GraphPost[] = [
	post(1, "main", "ses_a", "ASK"),
	post(2, "ses_a", "main", "RESULT"),
	post(3, "ses_a", "main"),
	post(4, "ses_c", "ses_b", "HOLD"),
	post(5, "main", "ses_a"),
	post(6, "main", "ses_a"),
];

const renderGraph = (overrides: Partial<Parameters<typeof SwarmGraph>[0]> = {}) => {
	const onFilter = vi.fn();
	const onOpen = vi.fn();
	render(
		<SwarmGraph
			members={members}
			posts={posts}
			onFilter={onFilter}
			onOpen={onOpen}
			{...overrides}
		/>,
	);
	return { onFilter, onOpen };
};

/** Moves a window handle as dragging it would: through the input's own value. */
const slide = (label: string, value: number) => {
	const input = page.getByRole("slider", { name: label }).element() as HTMLInputElement;
	Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
		input,
		String(value),
	);
	input.dispatchEvent(new Event("input", { bubbles: true }));
};

afterEach(cleanup);

describe("SwarmGraph", () => {
	it("draws a node per agent and a line per pair that talked, labelled with post numbers", async () => {
		renderGraph();
		await expect.poll(() => page.getByTestId("swarm-graph-node").all().length).toBe(4);
		await expect
			.element(page.getByRole("button", { name: "Filter the board to Researcher" }))
			.toBeVisible();
		await expect.element(page.getByText("6 posts between 4 agents")).toBeVisible();

		const edges = page.getByTestId("swarm-graph-edge");
		await expect.poll(() => edges.all().length).toBe(2);
		const busy = edges
			.all()
			.find((edge) => edge.element().getAttribute("data-edge") === "main:ses_a");
		expect(busy?.element().textContent).toBe("#1 #2 #3 +2");
		expect(busy?.element().getAttribute("data-blocking")).toBe("false");
		const held = edges
			.all()
			.find((edge) => edge.element().getAttribute("data-edge") === "ses_b:ses_c");
		expect(held?.element().textContent).toBe("#4 · Asked to wait");
		expect(held?.element().getAttribute("data-blocking")).toBe("true");
		await expect
			.element(page.getByTestId("swarm-graph-node").nth(2))
			.toHaveAttribute("data-done", "true");
	});

	it("filters on click and Enter, and opens the agent on double-click", async () => {
		const { onFilter, onOpen } = renderGraph();
		const researcher = page.getByRole("button", { name: "Filter the board to Researcher" });
		await researcher.click();
		expect(onFilter).toHaveBeenLastCalledWith("ses_a");

		const reviewer = page.getByRole("button", { name: "Filter the board to Reviewer" });
		(reviewer.element() as HTMLElement).focus();
		await userEvent.keyboard("{Enter}");
		expect(onFilter).toHaveBeenLastCalledWith("ses_c");

		await researcher.dblClick();
		expect(onOpen).toHaveBeenCalledExactlyOnceWith("ses_a");
		await expect.element(researcher).toHaveAttribute("data-member-id", "ses_a");
	});

	it("dims posts and lines outside the time window, and Reset restores it", async () => {
		renderGraph();
		const edges = page.getByTestId("swarm-graph-edge");
		await expect.poll(() => edges.all().length).toBe(2);
		const status = page.getByTestId("swarm-graph-window");
		await expect.poll(() => status.element().textContent).toContain("6 of 6 posts");
		const reset = page.getByTestId("swarm-graph-reset");
		await expect.element(reset).toBeDisabled();

		// Halfway along 12:00–12:05 is 12:02:30: posts #4–#6 remain.
		slide("Window start", 100);
		await expect.poll(() => status.element().textContent).toContain("3 of 6 posts");
		const dots = page.getByTestId("swarm-graph-dot");
		expect(dots.all().map((dot) => dot.element().getAttribute("data-in-window"))).toEqual([
			"false",
			"false",
			"false",
			"true",
			"true",
			"true",
		]);
		expect(edges.all().map((edge) => edge.element().getAttribute("data-dimmed"))).toEqual([
			"false",
			"false",
		]);

		// From 12:03:30 only #5 and #6 remain, so the hold's line dims.
		slide("Window start", 140);
		await expect.poll(() => status.element().textContent).toContain("2 of 6 posts");
		expect(edges.all().map((edge) => edge.element().getAttribute("data-dimmed"))).toEqual([
			"false",
			"true",
		]);

		await reset.click();
		await expect.poll(() => status.element().textContent).toContain("6 of 6 posts");
		expect(dots.all().every((dot) => dot.element().getAttribute("data-in-window") === "true")).toBe(
			true,
		);
		await expect.element(reset).toBeDisabled();
	});

	it("keeps the window's start from passing its end", async () => {
		renderGraph();
		slide("Window end", 50);
		slide("Window start", 150);
		await expect.element(page.getByRole("slider", { name: "Window start" })).toHaveValue("50");
	});

	it("shows the agents and an empty note before anyone posts", async () => {
		renderGraph({ posts: [] });
		await expect.poll(() => page.getByTestId("swarm-graph-node").all().length).toBe(4);
		await expect
			.element(page.getByText("No posts yet — lines appear as agents talk."))
			.toBeVisible();
		expect(page.getByTestId("swarm-graph-edge").query()).toBeNull();
		expect(page.getByTestId("swarm-graph-timing").query()).toBeNull();
	});
});
