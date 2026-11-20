import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { renameSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PREVIEW_PROFILE_NAME, resolveSharedProfile } from "./sharedProfile.js";

const SHARED = "Kilo Desktop";

let appData: string;
beforeEach(() => {
	appData = mkdtempSync(path.join(tmpdir(), "kilo-profiles-"));
});
afterEach(() => {
	rmSync(appData, { recursive: true, force: true });
});

const preview = () => path.join(appData, PREVIEW_PROFILE_NAME);
const shared = () => path.join(appData, SHARED);

function profile(dir: string, preferences?: Record<string, unknown>): void {
	mkdirSync(path.join(dir, "plugins"), { recursive: true });
	if (preferences) writeFileSync(path.join(dir, "preferences.json"), JSON.stringify(preferences));
}

const preferencesOf = (dir: string) =>
	JSON.parse(readFileSync(path.join(dir, "preferences.json"), "utf8")) as Record<string, unknown>;

describe("resolveSharedProfile", () => {
	it("leaves development builds in their own profile", () => {
		profile(preview());

		expect(resolveSharedProfile(appData, "development", "Kilo Desktop Dev")).toEqual({
			userData: path.join(appData, "Kilo Desktop Dev"),
			formerRoots: [],
		});
	});

	it("moves a lone Preview profile into the shared one and keeps its old path working", () => {
		profile(preview(), { themeSource: "dark" });
		writeFileSync(path.join(preview(), "plugins", "marker"), "kept");

		expect(resolveSharedProfile(appData, "preview", SHARED)).toEqual({
			userData: shared(),
			formerRoots: [],
		});
		expect(preferencesOf(shared())).toEqual({ themeSource: "dark" });
		// Chats started without a workspace keep absolute folders inside the old profile.
		expect(lstatSync(preview()).isSymbolicLink()).toBe(true);
		expect(readFileSync(path.join(preview(), "plugins", "marker"), "utf8")).toBe("kept");
		expect(realpathSync(preview())).toBe(realpathSync(shared()));
	});

	it("keeps using the Preview profile for this launch when it cannot be moved", () => {
		profile(preview());

		const resolved = resolveSharedProfile(appData, "preview", SHARED, {
			rename: () => {
				throw new Error("EBUSY");
			},
			symlink: symlinkSync,
		});

		expect(resolved).toEqual({ userData: preview(), formerRoots: [] });
	});

	it("merges a Preview profile into an existing shared one, Stable's preferences winning", () => {
		profile(shared(), {
			themeSource: "light",
			installationId: "stable-id",
			allowDataCollection: true,
			releaseTrack: "preview",
		});
		profile(preview(), {
			themeSource: "dark",
			installationId: "preview-id",
			allowDataCollection: false,
			releaseTrack: "stable",
			logLevel: "debug",
		});

		expect(resolveSharedProfile(appData, "preview", SHARED)).toEqual({
			userData: shared(),
			formerRoots: [preview()],
		});
		expect(preferencesOf(shared())).toEqual({
			themeSource: "light",
			installationId: "stable-id",
			// An opt-out on either track is kept.
			allowDataCollection: false,
			// The choice made on the running build is the latest one, which ends a Preview/Stable loop.
			releaseTrack: "stable",
			logLevel: "debug",
		});
		expect(lstatSync(preview()).isDirectory()).toBe(true);
	});

	it.each([
		["stable", { releaseTrack: "preview" }, { releaseTrack: "stable" }, "preview"],
		["preview", { releaseTrack: "stable" }, {}, undefined],
	] as const)(
		"on %s, takes the update track from the running build's own profile",
		(environment, sharedPreferences, previewPreferences, expected) => {
			profile(shared(), sharedPreferences);
			profile(preview(), previewPreferences);

			resolveSharedProfile(appData, environment, SHARED);

			expect(preferencesOf(shared()).releaseTrack).toBe(expected);
		},
	);

	it("merges preferences only once", () => {
		profile(shared(), {});
		profile(preview(), { themeSource: "dark" });
		resolveSharedProfile(appData, "stable", SHARED);
		writeFileSync(
			path.join(shared(), "preferences.json"),
			JSON.stringify({ themeSource: "light" }),
		);

		expect(resolveSharedProfile(appData, "stable", SHARED).formerRoots).toEqual([preview()]);
		expect(preferencesOf(shared())).toEqual({ themeSource: "light" });
	});

	it("reports nothing to merge once the Preview profile is a link to the shared one", () => {
		profile(preview());
		resolveSharedProfile(appData, "preview", SHARED, { rename: renameSync, symlink: symlinkSync });

		expect(resolveSharedProfile(appData, "stable", SHARED)).toEqual({
			userData: shared(),
			formerRoots: [],
		});
	});
});
