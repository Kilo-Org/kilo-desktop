import { describe, expect, it, vi } from "vitest";

import type { PluginEntry } from "@kilo-desktop/kernel";
import { renderShell } from "@kilo-desktop/plugin-shell/testing";

import manifest from "../../plugin.json";
import { EMPTY_WORK_SESSION_PANES, Panes, WorkSessions, SESSIONS_DEFINITIONS } from "../contracts";
import { LEGACY_PANES_STORAGE_KEY, LEGACY_PINS_STORAGE_KEY, sessionsWebEntry } from "./index";

/** Stands in for kilo.sessions' main entry, recording the pin handover. */
function fakeSessionsMain() {
	const importLegacyPins = vi.fn();
	const importLegacyPanes = vi.fn();
	const entry: PluginEntry = {
		activate(sdk) {
			const unused = () => {
				throw new Error("unused");
			};
			sdk.domains.provide(Panes, {
				initialState: { bySession: {} },
				methods: {
					open: unused,
					openObject: unused,
					activate: unused,
					update: unused,
					close: unused,
					setLayout: unused,
					setArrangement: unused,
					importLegacy: ({ state }) => importLegacyPanes(state),
				},
			});
			sdk.domains.provide(WorkSessions, {
				initialState: { sessions: [] },
				methods: {
					create: () => {
						throw new Error("unused");
					},
					rename: () => {
						throw new Error("unused");
					},
					setPinned: () => {
						throw new Error("unused");
					},
					setArchived: () => {
						throw new Error("unused");
					},
					setWorktreeBranch: () => {
						throw new Error("unused");
					},
					remove: () => ({ deleted: false }),
					isolationOptions: () => null,
					importLegacyPins: ({ ids }) => importLegacyPins(ids),
				},
			});
		},
	};
	return { entry, importLegacyPins, importLegacyPanes };
}

async function render(saved?: string, savedPanes?: string) {
	const fake = fakeSessionsMain();
	await renderShell(
		[{ manifest, definitions: SESSIONS_DEFINITIONS, main: fake.entry, web: sessionsWebEntry }],
		{
			localAppearance: {
				...(saved === undefined ? {} : { [LEGACY_PINS_STORAGE_KEY]: saved }),
				...(savedPanes === undefined ? {} : { [LEGACY_PANES_STORAGE_KEY]: savedPanes }),
			},
		},
	);
	return fake;
}

describe("handing over origin's pins", () => {
	it("sends the pins origin saved in this window to kilo.sessions", async () => {
		const { importLegacyPins } = await render(JSON.stringify(["wses_1", "ses_a", 7]));

		await vi.waitFor(() => expect(importLegacyPins).toHaveBeenCalledWith(["wses_1", "ses_a"]));
	});

	it("sends nothing when origin saved no pins or saved something unreadable", async () => {
		const missing = await render();
		const unreadable = await render("{not json");
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(missing.importLegacyPins).not.toHaveBeenCalled();
		expect(unreadable.importLegacyPins).not.toHaveBeenCalled();
	});
});

describe("handing over origin's panes", () => {
	it("sends the pane state origin saved in this window to kilo.sessions", async () => {
		const saved = { state: { bySessionId: { wses_1: EMPTY_WORK_SESSION_PANES } }, version: 1 };
		const { importLegacyPanes } = await render(undefined, JSON.stringify(saved));

		await vi.waitFor(() => expect(importLegacyPanes).toHaveBeenCalledWith(saved));
	});

	it("still hands over when origin saved no panes or saved something unreadable", async () => {
		const missing = await render();
		const unreadable = await render(undefined, "{not json");

		await vi.waitFor(() => expect(missing.importLegacyPanes).toHaveBeenCalledWith(null));
		await vi.waitFor(() => expect(unreadable.importLegacyPanes).toHaveBeenCalledWith(null));
	});
});
