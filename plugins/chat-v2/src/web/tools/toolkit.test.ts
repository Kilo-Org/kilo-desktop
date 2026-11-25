import { describe, expect, it } from "vitest";

import type { Contribution, QualifiedId } from "@kilo-desktop/kernel";

import { McpApp, ToolRenderer } from "../../contracts";
import { buildToolkit, hostableMcpApps, toolNameOf } from "./toolkit";

const NOTHING = { component: () => null };

function renderer(
	key: QualifiedId,
	metadata: { tools: string[]; standalone?: boolean; category?: "terminal" },
): Contribution<typeof ToolRenderer> {
	return {
		key,
		pointId: ToolRenderer.id,
		pluginId: key.slice(0, key.indexOf("/")),
		id: key.slice(key.indexOf("/") + 1),
		priority: 0,
		metadata: { standalone: false, ...metadata },
		implementation: NOTHING,
		implementedRemotely: false,
		source: "manifest",
	};
}

describe("toolNameOf", () => {
	it("names a desktop tool's contribution key by its wire name, and Kilo's tools as they are", () => {
		expect(toolNameOf("kilo.terminal/open_terminal")).toBe("desktop_terminal_open_terminal");
		expect(toolNameOf("kilo.chat/html_render")).toBe("desktop_chat_html_render");
		expect(toolNameOf("shell")).toBe("shell");
	});
});

describe("buildToolkit", () => {
	it("renders desktop tools under the names Kilo calls them by", () => {
		const { toolkit, categories } = buildToolkit([
			renderer("kilo.terminal/terminal", {
				tools: ["kilo.terminal/open_terminal"],
				category: "terminal",
			}),
			renderer("kilo.chat/shell", { tools: ["shell"] }),
		]);

		expect(Object.keys(toolkit).sort()).toEqual(["desktop_terminal_open_terminal", "shell"]);
		expect(categories.get("desktop_terminal_open_terminal")).toBe("terminal");
		expect(categories.has("shell")).toBe(false);
	});

	it("shows standalone tools outside activity groups, as their first renderer says", () => {
		const { toolkit } = buildToolkit([
			renderer("kilo.chat/plan-exit", { tools: ["plan_exit"], standalone: true }),
			renderer("kilo.other/plan-exit", { tools: ["plan_exit"] }),
		]);

		expect(toolkit.plan_exit).toMatchObject({ type: "backend", display: "standalone" });
	});

	it("leaves out contributions bound in another process", () => {
		const { implementation: _bound, ...remote } = renderer("kilo.other/x", { tools: ["x"] });

		expect(buildToolkit([{ ...remote, implementedRemotely: true }]).toolkit).toEqual({});
	});
});

describe("hostableMcpApps", () => {
	it("keys widgets by wire name, the first contribution for a tool winning", () => {
		const app = (key: QualifiedId, resourceUri: string): Contribution<typeof McpApp> => ({
			key,
			pointId: McpApp.id,
			pluginId: "kilo.notebooks",
			id: key.slice(key.indexOf("/") + 1),
			priority: 0,
			metadata: { tools: ["kilo.notebooks/show_chart"], resourceUri, serverId: "desktop" },
			implementedRemotely: false,
			source: "manifest",
		});

		const apps = hostableMcpApps([
			app("kilo.notebooks/chart", "ui://chart"),
			app("kilo.notebooks/other", "ui://other"),
		]);

		expect([...apps.keys()]).toEqual(["desktop_notebooks_show_chart"]);
		expect(apps.get("desktop_notebooks_show_chart")?.resourceUri).toBe("ui://chart");
	});
});
