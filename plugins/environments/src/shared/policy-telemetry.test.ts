import { describe, expect, it } from "vitest";

import { KernelError } from "@kilo-desktop/kernel";

import { formatEnvironmentsErrorMessage, type PolicyBlockedPackage } from "../contracts/common";
import { policyBlockedTelemetry } from "./policy-telemetry";

const ID_A = "0b7c3c1e-2f4e-4a5b-9a51-3f6c9e1d2a10";
const ID_B = "5d1f0a2b-7c3e-4f5a-8b6c-9d0e1f2a3b4c";

function blocked(policyId: string | null, name = "pillow"): PolicyBlockedPackage {
	return {
		package: name,
		version: "8.4.0",
		channel: "acme/main",
		org: "acme",
		policy: "No critical CVEs",
		policyId,
		reason: "critical CVE",
	};
}

function error(...args: Parameters<typeof formatEnvironmentsErrorMessage>): KernelError {
	return new KernelError("BUSINESS", formatEnvironmentsErrorMessage(...args));
}

describe("policyBlockedTelemetry", () => {
	it("counts a policy block without naming packages, channels, orgs, policies or reasons", () => {
		const data = policyBlockedTelemetry(
			error("POLICY_BLOCKED", "pillow 8.4.0 is blocked", {
				blocked: [blocked(ID_A), blocked(ID_A, "numpy")],
			}),
			"agent_tool",
		);

		expect(data).toEqual({
			surface: "agent_tool",
			errorCode: "POLICY_BLOCKED",
			blockedCount: 2,
			policyNote: false,
			policyIds: [ID_A],
		});
		expect(JSON.stringify(data)).not.toMatch(/pillow|numpy|acme|CVE/);
	});

	it("keeps at most five distinct policy ids, and only UUIDs", () => {
		const ids = [
			ID_A,
			ID_B,
			"11111111-1111-4111-8111-111111111111",
			"22222222-2222-4222-8222-222222222222",
			"33333333-3333-4333-8333-333333333333",
			"44444444-4444-4444-8444-444444444444",
		];
		const data = policyBlockedTelemetry(
			error("POLICY_BLOCKED", "blocked", {
				blocked: [
					blocked("acme's policy"),
					blocked(null),
					blocked(ID_A),
					...ids.map((id) => blocked(id)),
				],
			}),
			"ui",
		);

		expect(data?.["policyIds"]).toEqual(ids.slice(0, 5));
		expect(data?.["blockedCount"]).toBe(9);
	});

	it("reports Anaconda sign-in refusals and solve failures with a policy note", () => {
		expect(policyBlockedTelemetry(error("NOT_SIGNED_IN", "sign in"), "ui")).toEqual({
			surface: "ui",
			errorCode: "NOT_SIGNED_IN",
			blockedCount: 0,
			policyNote: false,
			policyIds: [],
		});
		expect(
			policyBlockedTelemetry(error("CHANNEL_ACCESS_DENIED", "refused"), "notebook")?.["errorCode"],
		).toBe("CHANNEL_ACCESS_DENIED");
		expect(
			policyBlockedTelemetry(error("SOLVE_FAILED", "conflict", { policyNote: true }), "ui"),
		).toEqual({
			surface: "ui",
			errorCode: "SOLVE_FAILED",
			blockedCount: 0,
			policyNote: true,
			policyIds: [],
		});
	});

	it("reports nothing for other failures", () => {
		expect(policyBlockedTelemetry(error("SOLVE_FAILED", "conflict"), "ui")).toBeUndefined();
		expect(policyBlockedTelemetry(error("ENV_EXISTS", "/envs/dev"), "ui")).toBeUndefined();
		expect(policyBlockedTelemetry(new Error("boom"), "ui")).toBeUndefined();
		expect(policyBlockedTelemetry(undefined, "ui")).toBeUndefined();
	});

	it("reads a bare message string too", () => {
		expect(policyBlockedTelemetry("NOT_SIGNED_IN", "ui")?.["errorCode"]).toBe("NOT_SIGNED_IN");
	});
});
