import { describe, expect, it } from "vitest";

import {
	friendlyEnvironmentsError,
	isProviderNotReadyError,
} from "./environments-error-message.js";

describe("friendlyEnvironmentsError", () => {
	it("maps the CODE: detail form to friendly copy", () => {
		const message = "ENV_EXISTS: prefix already exists: /Users/romulo/.conda/envs/faker";
		const result = friendlyEnvironmentsError(new Error(message), "fallback");
		expect(result).toContain("already exists");
		expect(result).not.toContain("CondaValueError");
		expect(result).not.toContain("ENV_EXISTS");
	});

	it("names the occupied prefix when ENV_EXISTS carries a path", () => {
		expect(
			friendlyEnvironmentsError(new Error("ENV_EXISTS: /Users/me/.conda/envs/alpha-bet"), "x"),
		).toBe(
			"An environment already exists at /Users/me/.conda/envs/alpha-bet. It may have been created by an earlier or concurrent request — check the environments list, or choose a different name or location.",
		);
		expect(
			friendlyEnvironmentsError(new Error("ENV_EXISTS: C:\\Users\\me\\envs\\alpha-bet"), "x"),
		).toContain("at C:\\Users\\me\\envs\\alpha-bet.");
	});

	it("keeps the generic ENV_EXISTS copy when the detail is not a path", () => {
		expect(
			friendlyEnvironmentsError(new Error("ENV_EXISTS: Environment 'dev' already exists"), "x"),
		).toBe("An environment already exists at that location. Choose a different name or location.");
	});

	it("maps SOLVE_FAILED to a resolution-focused message", () => {
		const result = friendlyEnvironmentsError(
			new Error("SOLVE_FAILED: found conflicts"),
			"fallback",
		);
		expect(result.toLowerCase()).toContain("resolve");
	});

	it("maps NO_CHANNELS_CONFIGURED to channel-setup copy", () => {
		const result = friendlyEnvironmentsError(new Error("NO_CHANNELS_CONFIGURED"), "fallback");
		expect(result.toLowerCase()).toContain("no conda channels are configured");
	});

	it("accepts a bare string reason", () => {
		expect(friendlyEnvironmentsError("ENV_NOT_FOUND", "fallback")).toContain("could not be found");
	});

	it("returns the fallback for unrecognised errors", () => {
		expect(friendlyEnvironmentsError(new Error("boom"), "Could not create environment.")).toBe(
			"Could not create environment.",
		);
		expect(friendlyEnvironmentsError(undefined, "Could not create environment.")).toBe(
			"Could not create environment.",
		);
	});

	it("appends the bridge detail to PROVIDER_NOT_READY when it carries actionable information", () => {
		const message = "PROVIDER_NOT_READY: anaconda-bridge-sidecar error: could not parse .condarc";
		const result = friendlyEnvironmentsError(new Error(message), "fallback");
		expect(result).toContain("backend is not ready");
		expect(result).toContain("could not parse .condarc");
		// The bridge-prefix noise is stripped from the surfaced detail.
		expect(result).not.toContain("anaconda-bridge-sidecar error:");
	});

	it("omits an opaque 'bridge failed to start' PROVIDER_NOT_READY detail to keep the toast copy short", () => {
		const message = "PROVIDER_NOT_READY: anaconda-bridge-sidecar error: bridge failed to start";
		const result = friendlyEnvironmentsError(new Error(message), "fallback");
		expect(result).toContain("backend is not ready");
		expect(result).not.toContain("bridge failed to start");
	});

	it("suppresses the transient 'connection got disposed' plumbing detail", () => {
		// The originally reported leak: a mid-restart JSON-RPC teardown.
		const message =
			"PROVIDER_NOT_READY: anaconda-bridge-sidecar error: Pending response rejected since connection got disposed";
		const result = friendlyEnvironmentsError(new Error(message), "fallback");
		expect(result).toContain("backend is not ready");
		expect(result).not.toContain("connection got disposed");
		expect(result).not.toContain("Pending response rejected");
	});
});

describe("isProviderNotReadyError", () => {
	it("is true for a PROVIDER_NOT_READY FeatureError (with or without detail)", () => {
		expect(isProviderNotReadyError(new Error("PROVIDER_NOT_READY"))).toBe(true);
		expect(
			isProviderNotReadyError(
				new Error("PROVIDER_NOT_READY: anaconda-bridge-sidecar error: still starting"),
			),
		).toBe(true);
		expect(isProviderNotReadyError("PROVIDER_NOT_READY")).toBe(true);
	});

	it("is false for other environments codes and for non-plugin errors", () => {
		expect(isProviderNotReadyError(new Error("SOLVE_FAILED: conflicts"))).toBe(false);
		expect(isProviderNotReadyError(new Error("boom"))).toBe(false);
		expect(isProviderNotReadyError(undefined)).toBe(false);
		expect(isProviderNotReadyError(null)).toBe(false);
	});
});
