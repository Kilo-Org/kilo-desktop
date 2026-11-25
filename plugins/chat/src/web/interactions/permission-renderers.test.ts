import { describe, expect, it } from "vitest";

import {
	findPermissionToolArgs,
	permissionRenderers,
	presentPermission,
	questionOptionWarnings,
	toolKeyOf,
	type PermissionRendererContribution,
} from "./permission-renderers";

function contribution(
	key: string,
	implementation: PermissionRendererContribution["implementation"],
	tools?: string[],
	actions?: string[],
): PermissionRendererContribution {
	return {
		key,
		pluginId: key.split("/")[0]!,
		pointId: "kilo.chat/permission-renderer",
		metadata: { ...(tools ? { tools } : {}), ...(actions ? { actions } : {}) },
		implementation,
		priority: 0,
	} as unknown as PermissionRendererContribution;
}

const request = {
	action: "desktop_acme_install",
	toolKey: "acme.a/install",
	resources: [],
	metadata: {},
	args: { packages: ["x"] },
};

describe("finding a permission request's tool arguments", () => {
	it("reads the arguments of the call the request names", () => {
		const messages = [
			{ content: [{ type: "text", text: "hi" }] },
			{ content: [{ type: "tool-call", toolCallId: "call_1", args: { a: 1 } }] },
		];
		expect(findPermissionToolArgs(messages, { messageID: "m", id: "call_1" })).toEqual({
			a: 1,
		});
		expect(findPermissionToolArgs(messages, { messageID: "m", id: "call_2" })).toBeUndefined();
		expect(findPermissionToolArgs(messages, undefined)).toBeUndefined();
		expect(findPermissionToolArgs([null, { content: "x" }], { messageID: "m", id: "c" })).toBe(
			undefined,
		);
	});
});

describe("presenting a permission request", () => {
	it("applies contributions for the request's tool (by contribution key), or for every tool", () => {
		const scoped = contribution("acme.a/x", {}, ["acme.a/install"]);
		const wireName = contribution("acme.a/v", {}, ["desktop_acme_install"]);
		const other = contribution("acme.a/y", {}, ["acme.a/other"]);
		const all = contribution("acme.a/z", {});
		const empty = contribution("acme.a/w", undefined);
		const contributions = [scoped, wireName, other, all, empty];
		expect(permissionRenderers(contributions, request).map((c) => c.key)).toEqual([
			"acme.a/x",
			"acme.a/z",
		]);
		expect(permissionRenderers(contributions, {}).map((c) => c.key)).toEqual(["acme.a/z"]);
	});

	it("applies contributions for a Kilo action no desktop tool raises", () => {
		const execute = contribution("acme.a/x", {}, undefined, ["acme_execute"]);
		const either = contribution("acme.a/y", {}, ["acme.a/install"], ["acme_execute"]);
		const other = contribution("acme.a/z", {}, undefined, ["shell"]);
		const contributions = [execute, either, other];
		expect(
			permissionRenderers(contributions, { action: "acme_execute" }).map((c) => c.key),
		).toEqual(["acme.a/x", "acme.a/y"]);
		expect(permissionRenderers(contributions, request).map((c) => c.key)).toEqual(["acme.a/y"]);
	});

	it("finds the tool contribution a permission names by its wire name", () => {
		const tools = [{ key: "kilo.terminal/open_terminal" }, { key: "acme.a/install" }];
		expect(toolKeyOf(tools, "desktop_terminal_open_terminal")).toBe("kilo.terminal/open_terminal");
		expect(toolKeyOf(tools, "desktop_acme_a_install")).toBe("acme.a/install");
		expect(toolKeyOf(tools, "shell")).toBeUndefined();
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

	it("hides the request's resources if any contribution does", () => {
		const presentation = presentPermission(
			[
				contribution("acme.a/x", { showResources: () => true }),
				contribution("acme.a/y", { showResources: () => false }),
			],
			request,
		);
		expect(presentation.showResources).toBe(false);
	});

	it("keeps the card's defaults without contributions", () => {
		expect(presentPermission([], request)).toEqual({
			title: undefined,
			allowAlways: true,
			showResources: true,
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
