import { describe, expect, it } from "vitest";

import { trackReleaseManifestSchema } from "./release-manifest.js";

const deb = {
	platform: "linux",
	arch: "x64",
	type: "deb",
	fileName: "kilo-desktop.deb",
	url: "https://downloads.example.test/kilo-desktop/latest/linux/x64/kilo-desktop_1.2.3_amd64.deb",
	size: 1024,
	sha256: "abc123",
};
const rpm = {
	...deb,
	type: "rpm",
	fileName: "kilo-desktop.rpm",
	url: "https://downloads.example.test/kilo-desktop/latest/linux/x64/kilo-desktop-1.2.3-1.x86_64.rpm",
};
const appImage = { ...deb, type: "appimage", fileName: "Kilo.AppImage" };
const freebsd = { ...deb, platform: "freebsd", type: "pkg", fileName: "kilo-desktop.pkg" };

function manifest(downloads: unknown[], additionalDownloads?: unknown[]) {
	return {
		schemaVersion: 1,
		track: "stable",
		version: "1.2.3",
		publishedAt: "2026-08-26T12:00:00.000Z",
		releaseNotesUrl: "https://downloads.example.test/kilo-desktop/latest/release-notes/1.2.3.json",
		downloads,
		...(additionalDownloads && { additionalDownloads }),
	};
}

describe("track release manifest", () => {
	it("skips downloads of a type or platform this client doesn't know instead of rejecting the manifest", () => {
		const parsed = trackReleaseManifestSchema.parse(
			manifest([deb, appImage, freebsd], [appImage, rpm, freebsd]),
		);

		expect(parsed.downloads).toEqual([deb]);
		expect(parsed.additionalDownloads).toEqual([rpm]);
	});

	it("reads an RPM listed in downloads", () => {
		expect(trackReleaseManifestSchema.parse(manifest([rpm])).downloads).toEqual([rpm]);
	});

	it("treats a manifest without additional downloads as having none", () => {
		expect(trackReleaseManifestSchema.parse(manifest([deb])).additionalDownloads).toEqual([]);
	});

	it.each([
		["a known type with a missing URL", { ...deb, url: undefined }],
		["an entry without a type", { ...deb, type: undefined }],
		["an entry without a platform", { ...appImage, platform: undefined }],
	])("still rejects %s", (_, entry) => {
		expect(trackReleaseManifestSchema.safeParse(manifest([deb, entry])).success).toBe(false);
	});
});
