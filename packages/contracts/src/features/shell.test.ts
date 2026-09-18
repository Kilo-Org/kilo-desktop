import { describe, expect, it } from "vitest";

import { paneWindowEvent, shellEvents, shellMethods, shellNavigationTarget } from "./shell.js";

describe("pane window contracts", () => {
	it("accepts a bounded plugin pane request and rejects shell routes", () => {
		const input = {
			pluginId: "kilo-ui",
			sessionId: "session-1",
			paneId: "file:readme.md",
			title: "readme.md",
			path: "/plugins/chat",
			workspaceId: "workspace-1",
		};

		expect(shellMethods["shell:open-pane-window"].input.parse(input)).toEqual(input);
		expect(() =>
			shellMethods["shell:open-pane-window"].input.parse({ ...input, path: "/settings" }),
		).toThrow();
	});

	it("validates pane lifecycle events", () => {
		const event = {
			type: "opened",
			pluginId: "kilo-ui",
			sessionId: "session-1",
			paneId: "file:readme.md",
		} as const;

		expect(paneWindowEvent.parse(event)).toEqual(event);
		expect(shellEvents["shell:pane-window-changed"].payload.parse(event)).toEqual(event);
		expect(() => paneWindowEvent.parse({ ...event, type: "unknown" })).toThrow();
	});

	it("accepts settings and plugin navigations and rejects other paths", () => {
		const target = {
			path: "/settings/local-model-server",
			search: { catalogModel: "48d448b0-2634-4c32-b3fe-56a26483c904" },
		};

		expect(shellNavigationTarget.parse(target)).toEqual(target);
		expect(shellEvents["shell:navigate"].payload.parse(target)).toEqual(target);
		expect(
			shellNavigationTarget.parse({
				path: "/plugins/chat",
				search: { paneWindow: "true" },
			}),
		).toEqual({
			path: "/plugins/chat",
			search: { paneWindow: "true" },
		});
		expect(() => shellNavigationTarget.parse({ path: "/settings", search: {} })).toThrow();
		expect(() =>
			shellNavigationTarget.parse({ path: "/evil", search: { catalogModel: "x" } }),
		).toThrow();
	});
});
