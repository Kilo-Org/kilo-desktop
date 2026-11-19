import { describe, expect, it } from "vitest";

import { formatEnvironmentsErrorMessage, type PolicyNotice } from "../../contracts/common";
import { condaPolicyFailure } from "./conda-policy-failure";

const BLOCKED: PolicyNotice = {
	blocked: [
		{
			package: "pillow",
			version: "8.4.0",
			channel: "defaults",
			org: "acme",
			policy: "organization_policy",
			policyId: "0b0f8f8e-1111-4222-8333-444455556666",
			reason: "Known vulnerabilities",
		},
	],
};

const blockedMessage = formatEnvironmentsErrorMessage(
	"POLICY_BLOCKED",
	"pillow 8.4.0 is blocked by organization_policy in acme: Known vulnerabilities\n\nsolver output",
	BLOCKED,
);

const failed = (result: unknown) => ({ isError: true, result });

describe("condaPolicyFailure", () => {
	it("recognises a package-policy block, keeping the bridge's summary and the blocked packages", () => {
		expect(condaPolicyFailure(failed(blockedMessage))).toEqual({
			code: "POLICY_BLOCKED",
			message: "pillow 8.4.0 is blocked by organization_policy in acme: Known vulnerabilities",
			detail: "solver output",
			policy: BLOCKED,
		});
	});

	it("recognises a solve failure the policy may explain, and Anaconda sign-in refusals", () => {
		const note = formatEnvironmentsErrorMessage("SOLVE_FAILED", "nothing provides holoviews", {
			policyNote: true,
		});
		expect(condaPolicyFailure(failed(note))?.code).toBe("SOLVE_FAILED");
		expect(condaPolicyFailure(failed("NOT_SIGNED_IN"))?.code).toBe("NOT_SIGNED_IN");
		const refused = formatEnvironmentsErrorMessage("CHANNEL_ACCESS_DENIED", "403", {
			refused: { org: "acme", channel: "acme/main" },
		});
		expect(condaPolicyFailure(failed(refused))?.message).toContain("acme/main");
	});

	it("reads the message from an MCP result and past an error-name prefix", () => {
		expect(
			condaPolicyFailure(failed({ content: [{ type: "text", text: blockedMessage }] }))?.code,
		).toBe("POLICY_BLOCKED");
		expect(condaPolicyFailure(failed(`Error: ${blockedMessage}\n`))?.code).toBe("POLICY_BLOCKED");
	});

	it("leaves successes, other failures and unrelated text to the default renderer", () => {
		expect(condaPolicyFailure({ isError: false, result: blockedMessage })).toBeNull();
		expect(condaPolicyFailure({ result: blockedMessage })).toBeNull();
		expect(condaPolicyFailure(failed("SOLVE_FAILED: nothing provides holoviews"))).toBeNull();
		expect(condaPolicyFailure(failed("PACKAGE_NOT_FOUND: nope"))).toBeNull();
		expect(condaPolicyFailure(failed("Something broke"))).toBeNull();
		expect(condaPolicyFailure(failed(undefined))).toBeNull();
	});
});
