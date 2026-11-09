import { describe, expect, it } from "vitest";

import {
	DEFAULT_RELEASE_TRACK,
	getArtifactKey,
	getPreviewBuildTime,
	getNativeAppVersion,
	getPublishAppVersion,
	getReleaseTrack,
	getReleaseNotesUrl,
	getUpdateFeedUrl,
	getUpdatePublishUrl,
	getUpdatePublishUrls,
	isStableReleaseVersion,
	validatePublishEnvironment,
} from "./release.js";

describe("release configuration", () => {
	it("uses a stable default track and trims the public URL", () => {
		expect(getReleaseTrack()).toBe(DEFAULT_RELEASE_TRACK);
		expect(getUpdatePublishUrl({ UPDATE_PUBLISH_URL: "https://updates.example.com///" })).toBe(
			"https://updates.example.com",
		);
	});

	it("resolves a separate update host for each track", () => {
		expect(
			getUpdatePublishUrls(
				{
					UPDATE_PUBLISH_URL: "https://preview.example.com",
					UPDATE_PUBLISH_URL_PREVIEW: "https://preview.example.com/",
					UPDATE_PUBLISH_URL_STABLE: " https://stable.example.com// ",
				},
				"preview",
			),
		).toEqual({
			preview: "https://preview.example.com",
			stable: "https://stable.example.com",
		});
	});

	it("falls back to the build track's publish URL when per-track hosts are unset", () => {
		expect(
			getUpdatePublishUrls({ UPDATE_PUBLISH_URL: "https://preview.example.com" }, "preview"),
		).toEqual({ preview: "https://preview.example.com", stable: "" });
		expect(
			getUpdatePublishUrls({ UPDATE_PUBLISH_URL: "https://stable.example.com" }, "stable"),
		).toEqual({ preview: "", stable: "https://stable.example.com" });
	});

	it("keeps publisher keys and update feed URLs aligned", () => {
		const artifactKey = getArtifactKey({
			track: "preview",
			platform: "darwin",
			arch: "arm64",
			fileName: "Kilo.zip",
		});
		const feedUrl = getUpdateFeedUrl({
			publishUrl: "https://cdn.example.com",
			track: "preview",
			platform: "darwin",
			arch: "arm64",
		});

		expect(artifactKey).toBe("kilo-desktop-ci-test/preview/darwin/arm64/Kilo.zip");
		expect(feedUrl).toBe("https://cdn.example.com/kilo-desktop-ci-test/preview/darwin/arm64");
		expect(getReleaseNotesUrl({ publishUrl: "https://cdn.example.com", track: "preview" })).toBe(
			"https://cdn.example.com/kilo-desktop-ci-test/preview/release-notes/latest.json",
		);
		expect(
			getReleaseNotesUrl({
				publishUrl: "https://cdn.example.com",
				track: "preview",
				version: "1.2.3-preview.1",
			}),
		).toBe(
			"https://cdn.example.com/kilo-desktop-ci-test/preview/release-notes/1.2.3-preview.1.json",
		);
	});

	it("rejects unknown tracks and non-HTTPS feeds", () => {
		expect(() => getReleaseTrack({ RELEASE_TRACK: "../stable" })).toThrow("Invalid release track");
		expect(() => getReleaseTrack({ RELEASE_TRACK: "beta" })).toThrow("Invalid release track");
		expect(() =>
			getUpdateFeedUrl({
				publishUrl: "http://updates.example.com",
				track: "stable",
				platform: "win32",
				arch: "x64",
			}),
		).toThrow("must use HTTPS");
	});

	it("requires storage and signed-track credentials before publishing", () => {
		expect(() => validatePublishEnvironment({}, "linux")).toThrow("UPDATE_S3_BUCKET");
		expect(() =>
			validatePublishEnvironment(
				{ RELEASE_TRACK: "preview", UPDATE_S3_BUCKET: "releases" },
				"darwin",
			),
		).toThrow("signing identity and notarization");
		expect(() =>
			validatePublishEnvironment(
				{
					RELEASE_TRACK: "stable",
					UPDATE_S3_BUCKET: "releases",
					APPLE_SIGNING_IDENTITY: "Developer ID Application: Example",
					APPLE_API_KEY: "/tmp/key.p8",
					APPLE_API_KEY_ID: "KEYID",
					APPLE_API_ISSUER: "issuer-uuid",
				},
				"darwin",
			),
		).not.toThrow();
		expect(() =>
			validatePublishEnvironment(
				{
					RELEASE_TRACK: "stable",
					UPDATE_S3_BUCKET: "releases",
					WINDOWS_CERTIFICATE_FILE: "certificate.pfx",
					WINDOWS_CERTIFICATE_PASSWORD: "secret",
				},
				"win32",
			),
		).not.toThrow();
		expect(() =>
			validatePublishEnvironment(
				{
					RELEASE_TRACK: "preview",
					UPDATE_S3_BUCKET: "releases",
					AZURE_KEY_VAULT_URI: "https://example.vault.azure.net/",
					AZURE_CERT_NAME: "codesign",
				},
				"win32",
			),
		).not.toThrow();
		expect(() =>
			validatePublishEnvironment(
				{ RELEASE_TRACK: "stable", UPDATE_S3_BUCKET: "releases" },
				"win32",
			),
		).toThrow("Azure Key Vault signing credentials or a certificate file");
		expect(() =>
			validatePublishEnvironment(
				{
					RELEASE_TRACK: "preview",
					UPDATE_S3_BUCKET: "releases",
					APPLE_SIGNING_IDENTITY: "Developer ID Application: Example",
					APPLE_API_KEY: "/tmp/key.p8",
					APPLE_API_KEY_ID: "KEYID",
					APPLE_API_ISSUER: "issuer-uuid",
				},
				"linux",
			),
		).not.toThrow();
		expect(
			getUpdateFeedUrl({ publishUrl: "", track: "preview", platform: "darwin", arch: "arm64" }),
		).toBeUndefined();
	});

	it("stamps preview with a NuGet-compatible fixed-width UTC timestamp", () => {
		const version = getPublishAppVersion({
			version: "0.1.0",
			track: "preview",
			now: new Date("2026-08-18T14:30:52.000Z"),
		});
		expect(version).toBe("0.1.1-preview-260818-14305");
		expect(version.slice(version.indexOf("-") + 1)).toHaveLength(20);
		expect(
			getPublishAppVersion({
				version: "0.1.0",
				track: "preview",
				now: new Date("2026-08-18T00:05:03.000Z"),
			}),
		).toBe("0.1.1-preview-260818-00050");
	});

	it("uses an explicit Stable version and recognizes plain releases", () => {
		expect(
			getPublishAppVersion({
				version: "0.1.0",
				track: "stable",
				releaseVersion: "1.2.3-alpha.1",
			}),
		).toBe("1.2.3-alpha.1");
		expect(isStableReleaseVersion("1.2.3")).toBe(true);
		expect(isStableReleaseVersion("1.2.3-alpha.1")).toBe(true);
		expect(isStableReleaseVersion("1.2")).toBe(false);
		expect(() => getPublishAppVersion({ version: "0.1.0", track: "stable" })).toThrow(
			"RELEASE_VERSION is required for Stable builds",
		);
	});

	it("maps Stable publishing to the latest update namespace", () => {
		expect(
			getArtifactKey({
				track: "stable",
				platform: "darwin",
				arch: "arm64",
				fileName: "Kilo.zip",
			}),
		).toBe("kilo-desktop-ci-test/latest/darwin/arm64/Kilo.zip");
		expect(
			getUpdateFeedUrl({
				publishUrl: "https://cdn.example.com",
				track: "stable",
				platform: "darwin",
				arch: "arm64",
			}),
		).toBe("https://cdn.example.com/kilo-desktop-ci-test/latest/darwin/arm64");
	});

	it("does not restamp an already-stamped preview version", () => {
		expect(
			getPublishAppVersion({
				version: "0.1.1-preview-260818-14305",
				track: "preview",
				now: new Date("2026-08-18T15:00:00.000Z"),
			}),
		).toBe("0.1.1-preview-260818-14305");
	});

	it("reads a shared preview build time so matrix legs publish the same version", () => {
		expect(getPreviewBuildTime({ PREVIEW_BUILD_TIME: "2026-08-18T14:30:52.000Z" })).toEqual(
			new Date("2026-08-18T14:30:52.000Z"),
		);
		expect(() => getPreviewBuildTime({ PREVIEW_BUILD_TIME: "not-a-date" })).toThrow(
			"Invalid PREVIEW_BUILD_TIME",
		);
		expect(() =>
			getPublishAppVersion({
				version: "latest",
				track: "preview",
				now: new Date("2026-08-18T14:30:52.000Z"),
			}),
		).toThrow("Invalid app version");
	});

	it("strips prerelease so Windows PE file versions stay at most four numeric components", () => {
		expect(getNativeAppVersion("0.1.1-preview-260818-14305")).toBe("0.1.1");
		expect(getNativeAppVersion("0.1.0")).toBe("0.1.0");
		expect(() => getNativeAppVersion("latest")).toThrow("Invalid app version");
	});
});
