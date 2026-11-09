import { describe, expect, it } from "vitest";

import type { MediaItem } from "../../contracts";
import { dropViewerHandoff, handOffViewerItems, takeViewerItems } from "./viewer-handoff";

const items = (id: string): MediaItem[] => [
	{ kind: "mermaid", id, code: "flowchart LR\n  A --> B", label: "Flowchart" },
];

describe("viewer hand-off", () => {
	it("hands over the items once, at exactly their revision", () => {
		handOffViewerItems("s/a", 3, items("a"));

		expect(takeViewerItems("s/a", 3)).toEqual(items("a"));
		expect(takeViewerItems("s/a", 3)).toBeNull();
	});

	it("keeps a newer hand-off for the pane to reach, and drops an older one", () => {
		handOffViewerItems("s/b", 5, items("b"));

		expect(takeViewerItems("s/b", 4)).toBeNull();
		expect(takeViewerItems("s/b", 6)).toBeNull();
		expect(takeViewerItems("s/b", 5)).toBeNull();
	});

	it("keeps only the latest hand-off per viewer, and a few viewers' in all", () => {
		handOffViewerItems("s/c", 1, items("old"));
		handOffViewerItems("s/c", 2, items("new"));
		expect(takeViewerItems("s/c", 2)).toEqual(items("new"));

		for (const key of ["s/1", "s/2", "s/3", "s/4", "s/5"]) handOffViewerItems(key, 9, items(key));
		expect(takeViewerItems("s/1", 9)).toBeNull();
		expect(takeViewerItems("s/5", 9)).toEqual(items("s/5"));
	});

	it("forgets a hand-off whose pane didn't open", () => {
		handOffViewerItems("s/d", 7, items("d"));
		dropViewerHandoff("s/d");

		expect(takeViewerItems("s/d", 7)).toBeNull();
	});
});
