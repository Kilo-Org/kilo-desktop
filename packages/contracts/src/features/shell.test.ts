import { describe, expect, it } from "vitest";

import { paneWindowEvent, shellEvents, shellMethods } from "./shell.js";

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
});
