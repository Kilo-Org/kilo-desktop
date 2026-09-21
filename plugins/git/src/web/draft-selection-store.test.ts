import { describe, expect, it } from "vitest";

import { createFakeSdk } from "@kilo-desktop/testing";

import {
	GIT_DRAFT_SELECTION_STORE_KEY,
	type GitDraftSelectionStoreValue,
} from "../contracts/schemas.js";
import { peekSelection, setSelection } from "./draft-selection-store.js";
import { webRegister } from "./index.js";

/**
 * Boot-time registration contract for the git plugin's renderer entry
 * (`webRegister`, discovered from the web entry module by the feature
 * system). Registration must happen before any component calls
 * `setSelection` — the deliberate invariant these tests pin at the store
 * module's public seam.
 */
describe("git plugin webRegister (draft-selection store)", () => {
	it("registers the store at boot and setSelection writes through", () => {
		const sdk = createFakeSdk({ featureId: "git" });
		webRegister(sdk);

		expect(sdk.state.has(GIT_DRAFT_SELECTION_STORE_KEY)).toBe(true);
		expect(
			sdk.state.get<GitDraftSelectionStoreValue>(GIT_DRAFT_SELECTION_STORE_KEY).peek(),
		).toEqual({});

		setSelection(sdk, "workspace-1", { mode: "local" });

		expect(peekSelection(sdk, "workspace-1")).toEqual({ mode: "local" });
		expect(
			sdk.state.get<GitDraftSelectionStoreValue>(GIT_DRAFT_SELECTION_STORE_KEY).peek(),
		).toEqual({ "workspace-1": { mode: "local" } });
	});

	it("throws an invariant error when setSelection runs before webRegister", () => {
		const sdk = createFakeSdk({ featureId: "git" });

		expect(() => setSelection(sdk, "workspace-1", { mode: "local" })).toThrow(/webRegister/);
	});

	it("reads null before registration (readers tolerate the pre-boot placeholder)", () => {
		const sdk = createFakeSdk({ featureId: "git" });

		expect(peekSelection(sdk, "workspace-1")).toBeNull();
	});
});
