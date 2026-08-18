import { describe, expect, it } from "vitest";

import {
	DEFAULT_RELEASE_CHANNEL,
	getArtifactKey,
	getCanaryBuildTime,
	getNativeAppVersion,
	getPublishAppVersion,
	getReleaseChannel,
	getUpdateFeedUrl,
	getUpdatePublishUrl,
	validatePublishEnvironment,
} from "./release.js";

describe("release configuration", () => {
	it("uses a stable default channel and trims the public URL", () => {
		expect(getReleaseChannel()).toBe(DEFAULT_RELEASE_CHANNEL);
		expect(getUpdatePublishUrl({ UPDATE_PUBLISH_URL: "https://updates.example.com///" })).toBe(
			"https://updates.example.com",
		);
	});

	it("keeps publisher keys and update feed URLs aligned", () => {
		const artifactKey = getArtifactKey({
			channel: "staging",
			platform: "darwin",
			arch: "arm64",
			fileName: "Anaconda.zip",
		});
		const feedUrl = getUpdateFeedUrl({
			publishUrl: "https://cdn.example.com",
			channel: "staging",
			platform: "darwin",
			arch: "arm64",
		});

		expect(artifactKey).toBe("anaconda-agentic-desktop/staging/darwin/arm64/Anaconda.zip");
		expect(feedUrl).toBe("https://cdn.example.com/anaconda-agentic-desktop/staging/darwin/arm64");
	});

	it("rejects unknown channels and non-HTTPS feeds", () => {
		expect(() => getReleaseChannel({ RELEASE_CHANNEL: "../prod" })).toThrow(
			"Invalid release channel",
		);
		expect(() => getReleaseChannel({ RELEASE_CHANNEL: "beta" })).toThrow("Invalid release channel");
		expect(() =>
			getUpdateFeedUrl({
				publishUrl: "http://updates.example.com",
				channel: "prod",
				platform: "win32",
				arch: "x64",
			}),
		).toThrow("must use HTTPS");
	});

	it("requires storage and signed-channel credentials before publishing", () => {
		expect(() => validatePublishEnvironment({}, "linux")).toThrow("UPDATE_S3_BUCKET");
		expect(() =>
			validatePublishEnvironment(
				{ RELEASE_CHANNEL: "canary", UPDATE_S3_BUCKET: "releases" },
				"darwin",
			),
		).not.toThrow();
		expect(() =>
			validatePublishEnvironment(
				{ RELEASE_CHANNEL: "staging", UPDATE_S3_BUCKET: "releases" },
				"darwin",
			),
		).toThrow("signing identity and notarization");
		expect(() =>
			validatePublishEnvironment(
				{
					RELEASE_CHANNEL: "prod",
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
					RELEASE_CHANNEL: "prod",
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
					RELEASE_CHANNEL: "staging",
					UPDATE_S3_BUCKET: "releases",
					AZURE_KEY_VAULT_URI: "https://example.vault.azure.net/",
					AZURE_CERT_NAME: "codesign",
				},
				"win32",
			),
		).not.toThrow();
		expect(() =>
			validatePublishEnvironment(
				{ RELEASE_CHANNEL: "prod", UPDATE_S3_BUCKET: "releases" },
				"win32",
			),
		).toThrow("Azure Key Vault signing credentials or a certificate file");
		expect(() =>
			validatePublishEnvironment(
				{
					RELEASE_CHANNEL: "staging",
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
			getUpdateFeedUrl({ publishUrl: "", channel: "canary", platform: "darwin", arch: "arm64" }),
		).toBeUndefined();
	});

	it("stamps canary as the next patch plus a UTC timestamp so each publish is newer", () => {
		expect(
			getPublishAppVersion({
				version: "0.1.0",
				channel: "canary",
				now: new Date("2026-08-18T14:30:52.000Z"),
			}),
		).toBe("0.1.1-canary.20260818.143052");
		expect(
			getPublishAppVersion({
				version: "0.1.0",
				channel: "canary",
				now: new Date("2026-08-18T00:05:03.000Z"),
			}),
		).toBe("0.1.1-canary.20260818.503");
		expect(
			getPublishAppVersion({
				version: "0.1.0",
				channel: "staging",
				now: new Date("2026-08-18T14:30:52.000Z"),
			}),
		).toBe("0.1.0");
		expect(
			getPublishAppVersion({
				version: "0.1.0",
				channel: "prod",
				now: new Date("2026-08-18T14:30:52.000Z"),
			}),
		).toBe("0.1.0");
	});

	it("reads a shared canary build time so matrix legs publish the same version", () => {
		expect(getCanaryBuildTime({ CANARY_BUILD_TIME: "2026-08-18T14:30:52.000Z" })).toEqual(
			new Date("2026-08-18T14:30:52.000Z"),
		);
		expect(() => getCanaryBuildTime({ CANARY_BUILD_TIME: "not-a-date" })).toThrow(
			"Invalid CANARY_BUILD_TIME",
		);
		expect(() =>
			getPublishAppVersion({
				version: "latest",
				channel: "canary",
				now: new Date("2026-08-18T14:30:52.000Z"),
			}),
		).toThrow("Invalid app version");
	});

	it("strips prerelease so Windows PE file versions stay at most four numeric components", () => {
		expect(getNativeAppVersion("0.1.1-canary.20260818.143052")).toBe("0.1.1");
		expect(getNativeAppVersion("0.1.0")).toBe("0.1.0");
		expect(() => getNativeAppVersion("latest")).toThrow("Invalid app version");
	});
});
