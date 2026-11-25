import { describe, expect, it } from "vitest";

import {
	projectOpenCodePermissionApproval,
	projectResolvedOpenCodePermissionApproval,
	toOpenCodePermissionResponse,
} from "./openCodePermissionApproval";
import { permissionRequest } from "./testUtils";

const request = permissionRequest("per_1", {
	action: "shell",
	resources: ["git status"],
	save: ["git *"],
	source: { type: "tool", messageID: "msg_1", id: "call_1" },
});

describe("OpenCode permission approvals", () => {
	it("offers once, always (granting the request's save patterns) and reject", () => {
		expect(projectOpenCodePermissionApproval(request)).toEqual({
			id: "per_1",
			options: [
				{ id: "once", kind: "allow-once" },
				{
					id: "always",
					kind: "allow-always",
					description: "Allow these patterns from now on.",
					grants: ["git *"],
					confirm: true,
				},
				{ id: "reject", kind: "reject-once" },
			],
		});
	});

	it("omits always when the request saves nothing", () => {
		const once = [
			{ id: "once", kind: "allow-once" },
			{ id: "reject", kind: "reject-once" },
		];
		expect(projectOpenCodePermissionApproval({ ...request, save: [] }).options).toEqual(once);
		const { save: _save, ...unsaved } = request;
		expect(projectOpenCodePermissionApproval(unsaved).options).toEqual(once);
	});

	it("projects resolved replies with the recorded decision", () => {
		expect(projectResolvedOpenCodePermissionApproval({ request, reply: "always" })).toEqual({
			id: "per_1",
			approved: true,
			optionId: "always",
		});
		expect(projectResolvedOpenCodePermissionApproval({ request, reply: "reject" })).toEqual({
			id: "per_1",
			approved: false,
			optionId: "reject",
		});
	});

	it.each([
		[{ approvalId: "p", approved: true }, "once"],
		[{ approvalId: "p", approved: false }, "reject"],
		[{ approvalId: "p", approved: true, optionId: "once" }, "once"],
		[{ approvalId: "p", approved: true, optionId: "always" }, "always"],
		[{ approvalId: "p", approved: false, optionId: "reject" }, "reject"],
	] as const)("maps the standard decision %o to %s", (response, expected) => {
		expect(toOpenCodePermissionResponse(response)).toBe(expected);
	});

	it.each([
		{ approvalId: "p", approved: false, optionId: "once" },
		{ approvalId: "p", approved: false, optionId: "always" },
		{ approvalId: "p", approved: true, optionId: "reject" },
		{ approvalId: "p", approved: true, optionId: "unknown" },
	])("rejects an invalid standard decision %o", (response) => {
		expect(() => toOpenCodePermissionResponse(response)).toThrow();
	});
});
