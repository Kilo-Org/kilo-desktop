import { describe, expect, it } from "vitest";

import { formatEnvironmentsErrorMessage } from "../../../contracts/common";
import {
	errorCardTitle,
	friendlyEnvironmentsError,
	isProviderNotReadyError,
	keyedBlockedPackages,
} from "./environments-error-message";

describe("friendlyEnvironmentsError", () => {
	it("maps the CODE: detail form to friendly copy", () => {
		const message = "ENV_EXISTS: prefix already exists: /Users/me/.conda/envs/faker";
		const result = friendlyEnvironmentsError(new Error(message), "fallback").message;
		expect(result).toContain("already exists");
		expect(result).not.toContain("CondaValueError");
		expect(result).not.toContain("ENV_EXISTS");
	});

	it("names the occupied prefix when ENV_EXISTS carries a path", () => {
		expect(
			friendlyEnvironmentsError(new Error("ENV_EXISTS: /Users/me/.conda/envs/alpha-bet"), "x")
				.message,
		).toBe(
			"An environment already exists at /Users/me/.conda/envs/alpha-bet. It may have been created by an earlier or concurrent request — check the environments list, or choose a different name or location.",
		);
		expect(
			friendlyEnvironmentsError(new Error("ENV_EXISTS: C:\\Users\\me\\envs\\alpha-bet"), "x")
				.message,
		).toContain("at C:\\Users\\me\\envs\\alpha-bet.");
	});

	it("keeps the generic ENV_EXISTS copy when the detail is not a path", () => {
		expect(
			friendlyEnvironmentsError(new Error("ENV_EXISTS: Environment 'dev' already exists"), "x")
				.message,
		).toBe("An environment already exists at that location. Choose a different name or location.");
	});

	it("maps SOLVE_FAILED to a resolution-focused message", () => {
		const result = friendlyEnvironmentsError(
			new Error("SOLVE_FAILED: found conflicts"),
			"fallback",
		).message;
		expect(result.toLowerCase()).toContain("resolve");
	});

	it("maps NO_CHANNELS_CONFIGURED to channel-setup copy", () => {
		const result = friendlyEnvironmentsError(
			new Error("NO_CHANNELS_CONFIGURED"),
			"fallback",
		).message;
		expect(result.toLowerCase()).toContain("no conda channels are configured");
	});

	it("accepts a bare string reason", () => {
		expect(friendlyEnvironmentsError("ENV_NOT_FOUND", "fallback").message).toContain(
			"could not be found",
		);
	});

	it("returns the fallback for unrecognised errors", () => {
		expect(
			friendlyEnvironmentsError(new Error("boom"), "Could not create environment.").message,
		).toBe("Could not create environment.");
		expect(friendlyEnvironmentsError(undefined, "Could not create environment.").message).toBe(
			"Could not create environment.",
		);
	});

	it("appends the bridge detail to PROVIDER_NOT_READY when it carries actionable information", () => {
		const message = "PROVIDER_NOT_READY: anaconda-bridge-sidecar error: could not parse .condarc";
		const result = friendlyEnvironmentsError(new Error(message), "fallback").message;
		expect(result).toContain("backend is not ready");
		expect(result).toContain("could not parse .condarc");
		// The bridge-prefix noise is stripped from the surfaced detail.
		expect(result).not.toContain("anaconda-bridge-sidecar error:");
	});

	it("omits an opaque 'bridge failed to start' PROVIDER_NOT_READY detail to keep the toast copy short", () => {
		const message = "PROVIDER_NOT_READY: anaconda-bridge-sidecar error: bridge failed to start";
		const result = friendlyEnvironmentsError(new Error(message), "fallback").message;
		expect(result).toContain("backend is not ready");
		expect(result).not.toContain("bridge failed to start");
	});

	it("suppresses the transient 'connection got disposed' plumbing detail", () => {
		// The originally reported leak: a mid-restart JSON-RPC teardown.
		const message =
			"PROVIDER_NOT_READY: anaconda-bridge-sidecar error: Pending response rejected since connection got disposed";
		const result = friendlyEnvironmentsError(new Error(message), "fallback").message;
		expect(result).toContain("backend is not ready");
		expect(result).not.toContain("connection got disposed");
		expect(result).not.toContain("Pending response rejected");
	});
});

const BLOCKED = {
	package: "pillow",
	version: "8.4.0",
	channel: "https://repo.anaconda.cloud/repo/acme/main",
	org: "acme",
	policy: "No critical CVEs",
	policyId: null,
	reason: "CVE-2022-22817 (critical)",
};

function failure(...args: Parameters<typeof formatEnvironmentsErrorMessage>): Error {
	return new Error(formatEnvironmentsErrorMessage(...args));
}

describe("friendlyEnvironmentsError for policy and Anaconda sign-in failures", () => {
	it("uses the bridge's summary as the message for a policy block, keeping the rest as detail", () => {
		const summary =
			"pillow 8.4.0 is blocked by your organization's policy 'No critical CVEs': CVE-2022-22817 (critical)";
		const error = failure("POLICY_BLOCKED", `${summary}\n\nCould not solve for environment specs`, {
			blocked: [BLOCKED],
		});

		expect(friendlyEnvironmentsError(error, "fallback")).toEqual({
			code: "POLICY_BLOCKED",
			message: summary,
			detail: "Could not solve for environment specs",
			policy: { blocked: [BLOCKED] },
		});
	});

	it("keeps a multi-line summary whole and falls back to curated copy without one", () => {
		const summary = "pillow 8.4.0 is blocked\nnumpy 1.0 is blocked";
		expect(friendlyEnvironmentsError(failure("POLICY_BLOCKED", summary), "x")).toEqual({
			code: "POLICY_BLOCKED",
			message: summary,
		});
		expect(friendlyEnvironmentsError(failure("POLICY_BLOCKED"), "x").message).toMatch(
			/blocked by your organization's package policy/,
		);
	});

	it("asks to sign in to Anaconda, naming the refused channel when known", () => {
		expect(
			friendlyEnvironmentsError(
				failure("NOT_SIGNED_IN", "not signed in", {
					refused: { org: "acme", channel: "acme/main" },
				}),
				"x",
			),
		).toEqual({
			code: "NOT_SIGNED_IN",
			message: "acme/main needs an Anaconda account. Sign in to Anaconda, then try again.",
			detail: "not signed in",
			policy: { refused: { org: "acme", channel: "acme/main" } },
		});
		expect(friendlyEnvironmentsError(failure("NOT_SIGNED_IN"), "x").message).toBe(
			"This channel needs an Anaconda account. Sign in to Anaconda, then try again.",
		);
		expect(
			friendlyEnvironmentsError(
				failure("CHANNEL_ACCESS_DENIED", "403", { refused: { org: null, channel: "acme/main" } }),
				"x",
			).message,
		).toMatch(/^Anaconda refused access to acme\/main\. .*Sign in to Anaconda again/);
	});

	it("keeps the conflict copy and the solver report for a solve failure with a policy note", () => {
		const error = friendlyEnvironmentsError(
			failure("SOLVE_FAILED", "Could not solve.", { policyNote: true }),
			"x",
		);
		expect(error).toMatchObject({
			code: "SOLVE_FAILED",
			detail: "Could not solve.",
			policy: { policyNote: true },
		});
		expect(error.message.toLowerCase()).toContain("resolve");
	});

	it("reports no code for an error outside the convention", () => {
		expect(friendlyEnvironmentsError(new Error("boom"), "fallback")).toEqual({
			code: null,
			message: "fallback",
		});
	});
});

describe("errorCardTitle", () => {
	const title = (...args: Parameters<typeof formatEnvironmentsErrorMessage>) =>
		errorCardTitle(friendlyEnvironmentsError(failure(...args), "x"));

	it("names a policy block and an Anaconda sign-in refusal as such", () => {
		expect(title("POLICY_BLOCKED", "blocked")).toBe("Blocked by your organization's policy");
		expect(title("NOT_SIGNED_IN")).toBe("Sign in to Anaconda");
		expect(title("CHANNEL_ACCESS_DENIED")).toBe("Sign in to Anaconda");
	});

	it("calls a solve failure a dependency conflict, unless the policy may be involved", () => {
		expect(title("SOLVE_FAILED", "conflict")).toBe("Dependency conflict");
		expect(title("SOLVE_FAILED", "conflict", { policyNote: true })).toBe(
			"Dependency conflict under your organization's policy",
		);
	});

	it("gives other failures their own title rather than claiming a conflict", () => {
		expect(title("PACKAGE_NOT_FOUND")).toBe("Package not found");
		expect(title("CHANNEL_NOT_FOUND")).toBe("Channel not found");
		expect(title("NO_CHANNELS_CONFIGURED")).toBe("No channels configured");
		expect(title("PROVIDER_NOT_READY")).toBe("Couldn't complete the change");
		expect(errorCardTitle(friendlyEnvironmentsError(new Error("boom"), "x"))).toBe(
			"Couldn't complete the change",
		);
	});
});

describe("isProviderNotReadyError", () => {
	it("is true for a PROVIDER_NOT_READY KernelError (with or without detail)", () => {
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

describe("keyedBlockedPackages", () => {
	const pillow = {
		package: "pillow",
		version: "8.4.0",
		channel: "https://repo.anaconda.cloud/repo/acme/main",
		org: "acme",
		policy: "strict",
		policyId: "p-1",
		reason: "CVE score of 9.1",
	};

	it("keys each entry by its content, so the key survives reordering", () => {
		const numpy = { ...pillow, package: "numpy", version: null };
		const forward = keyedBlockedPackages([pillow, numpy]).map(({ key }) => key);
		const backward = keyedBlockedPackages([numpy, pillow]).map(({ key }) => key);
		expect(new Set(forward).size).toBe(2);
		expect(backward).toEqual([forward[1], forward[0]]);
	});

	it("keeps entries that differ in any field apart", () => {
		const keys = keyedBlockedPackages([
			pillow,
			{ ...pillow, channel: "https://repo.anaconda.cloud/repo/acme/extra" },
			{ ...pillow, reason: "Not on the allow list" },
		]).map(({ key }) => key);
		expect(new Set(keys).size).toBe(3);
	});

	it("drops exact duplicates, which would only repeat a row", () => {
		const entries = keyedBlockedPackages([pillow, { ...pillow }]);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.entry).toEqual(pillow);
	});
});
