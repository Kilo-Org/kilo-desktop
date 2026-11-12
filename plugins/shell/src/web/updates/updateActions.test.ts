import { describe, expect, it } from "vitest";

import {
	getInstallConfirmationMessage,
	updateAvailableLabel,
	updateReadyLabel,
} from "./updateActions";

const state = { downloadedVersion: "1.2.3", availableVersion: "1.2.3" };

describe("update wording", () => {
	it("warns Windows users that the installer runs silently", () => {
		expect(getInstallConfirmationMessage(state, "Win32")).toContain(
			"no installer window may appear",
		);
		expect(getInstallConfirmationMessage(state, "MacIntel")).not.toContain("Windows");
	});

	it("reads naturally when the version is unknown", () => {
		const unknown = { downloadedVersion: null, availableVersion: null };

		expect(getInstallConfirmationMessage(unknown, "MacIntel")).not.toContain("undefined");
		expect(updateReadyLabel({ ...state, downloadedVersion: null } as never)).toBe(
			"Update ready to install",
		);
		expect(updateAvailableLabel(unknown)).toBe("An update is available to download");
	});
});
