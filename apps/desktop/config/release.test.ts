import { describe, expect, it } from "vitest";

import {
	DEFAULT_RELEASE_CHANNEL,
	getArtifactKey,
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

	it("rejects unsafe channels and non-HTTPS feeds", () => {
		expect(() => getReleaseChannel({ RELEASE_CHANNEL: "../prod" })).toThrow(
			"Invalid release channel",
		);
		expect(() =>
			getUpdateFeedUrl({
				publishUrl: "http://updates.example.com",
				channel: "prod",
				platform: "win32",
				arch: "x64",
			}),
		).toThrow("must use HTTPS");
	});

	it("requires storage and production signing credentials before publishing", () => {
		expect(() => validatePublishEnvironment({}, "linux")).toThrow("UPDATE_S3_BUCKET");
		expect(() =>
			validatePublishEnvironment(
				{ RELEASE_CHANNEL: "prod", UPDATE_S3_BUCKET: "releases" },
				"darwin",
			),
		).toThrow("signing and notarization");
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
	});
});
