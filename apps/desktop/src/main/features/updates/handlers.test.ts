import { describe, expect, it, vi } from "vitest";

import type { DesktopUpdateState } from "@kilo-desktop/contracts";

import { createUpdateHandlers } from "./handlers.js";

const state: DesktopUpdateState = {
	enabled: true,
	status: "idle",
	track: "stable",
	currentVersion: "1.2.3",
	availableVersion: null,
	downloadedVersion: null,
	releaseNotes: [],
	checkedAt: null,
	message: null,
};

function createUpdates() {
	return {
		state,
		check: vi.fn(async () => ({ accepted: true, state })),
		setTrack: vi.fn(async () => ({
			accepted: true,
			state: { ...state, track: "preview" as const },
		})),
		install: vi.fn(() => ({ accepted: true, state })),
	};
}

describe("update handlers", () => {
	it("switches tracks when the switcher flag is enabled", async () => {
		const updates = createUpdates();
		const handlers = createUpdateHandlers(updates, { isTrackSwitchingEnabled: () => true });

		const result = await handlers["updates:set-track"]("preview");

		expect(updates.setTrack).toHaveBeenCalledWith("preview");
		expect(result).toMatchObject({ accepted: true, state: { track: "preview" } });
	});

	it("rejects track changes when the switcher flag is disabled", async () => {
		const updates = createUpdates();
		const handlers = createUpdateHandlers(updates, { isTrackSwitchingEnabled: () => false });

		const result = await handlers["updates:set-track"]("preview");

		expect(updates.setTrack).not.toHaveBeenCalled();
		expect(result).toEqual({
			accepted: false,
			state: { ...state, message: "Switching update tracks is not enabled." },
		});
	});
});
