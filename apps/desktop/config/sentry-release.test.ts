import { describe, expect, it } from "vitest";

import { sentryReleaseName } from "./sentry-release.js";

describe("sentryReleaseName", () => {
	it("names the release after the app version, the same on every track", () => {
		expect(sentryReleaseName("1.0.0")).toBe("kilo-desktop@1.0.0");
		expect(sentryReleaseName("1.0.1-preview-261120-21051")).toBe(
			"kilo-desktop@1.0.1-preview-261120-21051",
		);
	});

	it.each(["1.0.0/x", "1.0.0\\x", "1.0.0\nx", "1.0.0\tx", "", " ", "x".repeat(200)])(
		"rejects a version Sentry would refuse as a release name: %j",
		(version) => {
			expect(() => sentryReleaseName(version)).toThrow(/Sentry release name/);
		},
	);
});
