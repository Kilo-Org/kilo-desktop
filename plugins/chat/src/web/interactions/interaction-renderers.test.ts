import { describe, expect, it } from "vitest";

import {
	findPermissionToolArgs,
	permissionRenderers,
	presentPermission,
	questionOptionWarnings,
	type InteractionRendererContribution,
} from "./interaction-renderers";

function contribution(
	key: string,
	implementation: InteractionRendererContribution["implementation"],
	permissions?: string[],
): InteractionRendererContribution {
	return {
		key,
		pluginId: key.split("/")[0]!,
		pointId: "kilo.chat/interaction-renderer",
		metadata: permissions ? { permissions } : {},
		implementation,
		priority: 0,
	} as unknown as InteractionRendererContribution;
}

const request = { permission: "desktop_acme_install", patterns: [], args: { packages: ["x"] } };

describe("finding a permission request's tool arguments", () => {
	it("reads the arguments of the call the request names", () => {
		const messages = [
			{ content: [{ type: "text", text: "hi" }] },
			{ content: [{ type: "tool-call", toolCallId: "call_1", args: { a: 1 } }] },
		];
		expect(findPermissionToolArgs(messages, { messageID: "m", callID: "call_1" })).toEqual({
			a: 1,
		});
		expect(findPermissionToolArgs(messages, { messageID: "m", callID: "call_2" })).toBeUndefined();
		expect(findPermissionToolArgs(messages, undefined)).toBeUndefined();
		expect(findPermissionToolArgs([null, { content: "x" }], { messageID: "m", callID: "c" })).toBe(
			undefined,
		);
	});
});

describe("presenting a permission request", () => {
	it("applies contributions for the request's tool, or for every tool", () => {
		const scoped = contribution("acme.a/x", {}, ["desktop_acme_install"]);
		const other = contribution("acme.a/y", {}, ["bash"]);
		const all = contribution("acme.a/z", {});
		const empty = contribution("acme.a/w", undefined);
		expect(
			permissionRenderers([scoped, other, all, empty], "desktop_acme_install").map((c) => c.key),
		).toEqual(["acme.a/x", "acme.a/z"]);
	});

	it("takes the first title, withholds Always allow if any contribution does, and lists details", () => {
		const Detail = () => null;
		const presentation = presentPermission(
			[
				contribution("acme.a/x", { allowAlways: () => true }),
				contribution("acme.a/y", { permissionTitle: () => "installing", PermissionDetail: Detail }),
				contribution("acme.a/z", { permissionTitle: () => "later", allowAlways: () => false }),
			],
			request,
		);
		expect(presentation.title).toBe("installing");
		expect(presentation.allowAlways).toBe(false);
		expect(presentation.details.map((c) => c.key)).toEqual(["acme.a/y"]);
	});

	it("keeps the card's defaults without contributions", () => {
		expect(presentPermission([], request)).toEqual({
			title: undefined,
			allowAlways: true,
			details: [],
		});
	});
});

describe("question option warnings", () => {
	it("collects each distinct warning", () => {
		const warn = () => "Risky.";
		expect(
			questionOptionWarnings(
				[
					contribution("acme.a/x", { optionWarning: warn }),
					contribution("acme.a/y", { optionWarning: warn }),
					contribution("acme.a/z", { optionWarning: () => undefined }),
				],
				{ label: "Install" },
			),
		).toEqual(["Risky."]);
	});
});
