import { describe, expect, it } from "vitest";

import {
	createViteEnvironmentDefinitions,
	getBuildEnvironment,
	requireViteEnvironmentVariable,
} from "./build-environment.js";

describe("build environment", () => {
	it("uses development configuration while serving", () => {
		expect(getBuildEnvironment("serve", "canary")).toBe("development");
	});

	it.each(["canary", "staging", "prod"] as const)(
		"uses %s configuration while building that channel",
		(channel) => {
			expect(getBuildEnvironment("build", channel)).toBe(channel);
		},
	);

	it("requires non-blank environment variables", () => {
		expect(
			requireViteEnvironmentVariable(
				"prod",
				{ VITE_AUTH_CLIENT_ID: " client " },
				"VITE_AUTH_CLIENT_ID",
			),
		).toBe("client");
		expect(() =>
			requireViteEnvironmentVariable("prod", { VITE_AUTH_CLIENT_ID: " " }, "VITE_AUTH_CLIENT_ID"),
		).toThrow("VITE_AUTH_CLIENT_ID must be configured in apps/desktop/.env.prod");
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
