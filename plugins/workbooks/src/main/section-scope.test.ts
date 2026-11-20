import { describe, expect, it } from "vitest";

import { sectionMarkdown, sectionScope } from "./section-scope";

const page =
	"Intro.\n\n## Steps\n\n- [ ] **1. One**\n\n## Tasks\n\n_Chores._\n\n### Detail\n\nMore.\n\n## Follow-ups";

describe("sectionScope", () => {
	it("is the part under the heading, up to the next heading of its level", () => {
		expect(sectionMarkdown(page, "tasks")).toBe("_Chores._\n\n### Detail\n\nMore.");
		expect(sectionMarkdown(page, "Steps")).toBe("- [ ] **1. One**");
		expect(sectionMarkdown(page, "Follow-ups")).toBe("");
		expect(sectionMarkdown(page)).toBe(page);
	});

	it("finds a section split across blocks, ending at its last filled line or its heading", () => {
		const blocks = [
			{ node_id: "h1", markdown: "## Steps" },
			{ node_id: "l1", markdown: "- [ ] **1. One**" },
			{ node_id: "h2", markdown: "## Tasks" },
		];

		const steps = sectionScope(blocks, "Steps");
		expect(steps.lines.map((line) => line.text)).toEqual(["- [ ] **1. One**"]);
		expect(steps.end).toMatchObject({ block: { node_id: "l1" }, index: 0 });
		expect(sectionScope(blocks, "Tasks").end).toMatchObject({ block: { node_id: "h2" } });
	});

	it("says when the page has no such heading", () => {
		expect(sectionScope([{ node_id: "b", markdown: "## Steps" }], "Tasks")).toEqual({
			found: false,
			lines: [],
		});
		expect(sectionScope([], undefined)).toEqual({ found: true, lines: [] });
	});
});
