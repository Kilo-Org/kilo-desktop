import { describe, expect, it } from "vitest";

import {
	addPane,
	createLayout,
	descriptor,
	flattenPanes,
	serializeLayout,
} from "@kilo-desktop/pane-layout";
import { EMPTY_WORK_SESSION_PANES, type Pane, type WorkSessionPanes } from "../../contracts";

import { sessionLayout } from "./session-layout";

const pane = (id: string, title = id): Pane => ({
	id,
	kind: id === "doc" ? "test/editor" : "test/terminal",
	title,
	metadata: {},
	ordinal: 1,
});

const kindOf = (kind: string) => (kind === "test/editor" ? "document" : "tool");

describe("session layout", () => {
	it("lays out a session's panes when nothing is saved", () => {
		const state: WorkSessionPanes = {
			...EMPTY_WORK_SESSION_PANES,
			panes: [pane("a"), pane("doc")],
			activePaneId: "a",
		};

		const layout = sessionLayout(state, kindOf);

		expect(flattenPanes(layout).map(({ id, kind }) => [id, kind])).toEqual([
			["a", "tool"],
			["doc", "document"],
		]);
		expect(layout.activePaneId).toBe("a");
	});

	it("keeps the saved arrangement, adding new panes, dropping closed ones and retitling", () => {
		let saved = createLayout([descriptor({ id: "a", kind: "tool", title: "a" })]);
		saved = addPane(saved, descriptor({ id: "gone", kind: "tool", title: "gone" }));
		const state: WorkSessionPanes = {
			...EMPTY_WORK_SESSION_PANES,
			panes: [pane("a", "Server"), pane("b")],
			activePaneId: "b",
			layout: serializeLayout(saved),
		};

		const layout = sessionLayout(state, kindOf);

		expect(flattenPanes(layout).map(({ id, title }) => [id, title])).toEqual([
			["a", "Server"],
			["b", "b"],
		]);
		expect(layout.activePaneId).toBe("b");
	});

	it("ignores an unreadable saved layout", () => {
		const layout = sessionLayout(
			{
				...EMPTY_WORK_SESSION_PANES,
				panes: [pane("a")],
				layout: "{not json",
				activePaneId: "gone",
			},
			kindOf,
		);

		expect(flattenPanes(layout).map(({ id }) => id)).toEqual(["a"]);
	});
});
