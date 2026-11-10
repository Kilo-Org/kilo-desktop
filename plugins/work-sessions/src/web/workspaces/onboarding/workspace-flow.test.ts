import { describe, expect, it } from "vitest";

import { FLOW, workspaceFlow } from "./workspace-flow";

describe("workspaceFlow", () => {
	it("shows a single placeholder when no folders are chosen", () => {
		const flow = workspaceFlow([]);
		expect(flow.pills).toEqual([
			expect.objectContaining({ label: "Add a folder", placeholder: true }),
		]);
		expect(flow.pending).toBe(true);
	});

	it("keeps up to four folders and summarises the rest", () => {
		const flow = workspaceFlow(["a", "b", "c", "d", "e", "f"]);
		expect(flow.pills.map((pill) => pill.label)).toEqual(["a", "b", "c", "+3 more"]);
		expect(flow.pending).toBe(false);
	});

	it("centres the workspace tile horizontally, with matching wires on both sides", () => {
		expect(FLOW.tileX + FLOW.tileWidth / 2).toBe(FLOW.width / 2);
		expect(FLOW.tileX - FLOW.pillWidth).toBe(FLOW.kiloX - (FLOW.tileX + FLOW.tileWidth));
		expect(FLOW.kiloX + FLOW.pillWidth).toBe(FLOW.width);
	});

	it("centres the pill column on the workspace tile", () => {
		for (const count of [1, 2, 3, 4]) {
			const { pills } = workspaceFlow(Array.from({ length: count }, (_, index) => `f${index}`));
			const top = pills[0]!.y;
			const bottom = pills.at(-1)!.y + FLOW.pillHeight;
			expect((top + bottom) / 2).toBeCloseTo(FLOW.height / 2);
		}
	});

	it("wires every pill into the tile's left edge at its vertical centre", () => {
		const { pills } = workspaceFlow(["a", "b"]);
		for (const pill of pills) {
			expect(pill.connector.startsWith(`M ${FLOW.pillWidth} ${pill.y + FLOW.pillHeight / 2}`)).toBe(
				true,
			);
			expect(pill.connector.endsWith(`${FLOW.tileX} ${FLOW.height / 2}`)).toBe(true);
		}
	});
});
