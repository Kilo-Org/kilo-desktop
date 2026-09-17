import { describe, expect, it } from "vitest";

import {
	createViteEnvironmentDefinitions,
	getBuildEnvironment,
	requireViteEnvironmentVariable,
	shouldUploadSentrySourceMaps,
} from "./build-environment.js";

describe("build environment", () => {
	it("uses development configuration while serving", () => {
		expect(getBuildEnvironment("serve", "preview")).toBe("development");
	});

	it.each(["preview", "stable"] as const)(
		"uses %s configuration while building that track",
		(track) => {
			expect(getBuildEnvironment("build", track)).toBe(track);
		},
	);

	it("uploads Sentry source maps only for Stable builds with credentials", () => {
		expect(shouldUploadSentrySourceMaps("stable", "token")).toBe(true);
		expect(shouldUploadSentrySourceMaps("stable", undefined)).toBe(false);
		expect(shouldUploadSentrySourceMaps("preview", "token")).toBe(false);
	});

	it("requires non-blank environment variables", () => {
		expect(
			requireViteEnvironmentVariable(
				"stable",
				{ VITE_AUTH_CLIENT_ID: " client " },
				"VITE_AUTH_CLIENT_ID",
			),
		).toBe("client");
		expect(() =>
			requireViteEnvironmentVariable("stable", { VITE_AUTH_CLIENT_ID: " " }, "VITE_AUTH_CLIENT_ID"),
		).toThrow("VITE_AUTH_CLIENT_ID must be configured in apps/desktop/.env.stable");
	});

	it("creates import.meta.env definitions for Vite", () => {
		expect(
			createViteEnvironmentDefinitions({
				VITE_AUTH_CLIENT_ID: "client",
				VITE_EXAMPLE: "value",
			}),
		).toEqual({
			"import.meta.env.VITE_AUTH_CLIENT_ID": '"client"',
			"import.meta.env.VITE_EXAMPLE": '"value"',
		});
	});
});
