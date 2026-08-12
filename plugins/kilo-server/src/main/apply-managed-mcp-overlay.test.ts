import { describe, expect, it } from "vitest";

import { applyManagedMcpOverlayEntry } from "./index.js";

const ENTRY = {
	type: "local" as const,
	command: ["/bin/runt", "mcp"] as [string, string],
	enabled: true as const,
};

describe("applyManagedMcpOverlayEntry", () => {
	it("creates an overlay mcp entry", () => {
		expect(applyManagedMcpOverlayEntry(undefined, { name: "runt", entry: ENTRY })).toEqual({
			overlay: { mcp: { runt: ENTRY } },
			outcome: { kind: "written", reason: "created", entry: ENTRY },
		});
	});

	it("merges beside an existing relay entry", () => {
		const relay = {
			type: "local" as const,
			command: ["/exe", "/relay"] as [string, string],
			enabled: true as const,
		};
		const result = applyManagedMcpOverlayEntry(
			{ mcp: { "anaconda-desktop-relay": relay } },
			{ name: "runt", entry: ENTRY },
		);
		expect(result.overlay).toEqual({
			mcp: {
				"anaconda-desktop-relay": relay,
				runt: ENTRY,
			},
		});
		expect(result.outcome.kind).toBe("written");
	});

	it("removes a single entry without dropping siblings", () => {
		const relay = {
			type: "local" as const,
			command: ["/exe"] as [string],
			enabled: true as const,
		};
		expect(
			applyManagedMcpOverlayEntry(
				{ mcp: { "anaconda-desktop-relay": relay, runt: ENTRY } },
				{ name: "runt", enabled: false },
			),
		).toEqual({
			overlay: { mcp: { "anaconda-desktop-relay": relay } },
			outcome: { kind: "removed", reason: "explicit" },
		});
	});

	it("clears the overlay when the last mcp entry is removed", () => {
		expect(
			applyManagedMcpOverlayEntry({ mcp: { runt: ENTRY } }, { name: "runt", enabled: false }),
		).toEqual({
			overlay: undefined,
			outcome: { kind: "removed", reason: "explicit" },
		});
	});
});
