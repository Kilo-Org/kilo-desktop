import { ListTodoIcon } from "lucide-react";
import { describe, expect, it } from "vitest";

import { FALLBACK_PLUGIN_NAV_ICON, resolvePluginNavIcon } from "./plugin-icons";

describe("resolvePluginNavIcon", () => {
	it("resolves registered bundled-plugin icon names", () => {
		expect(resolvePluginNavIcon("list-todo")).toBe(ListTodoIcon);
	});

	it("falls back to the generic plugin icon for unknown or missing names", () => {
		expect(resolvePluginNavIcon("not-a-registered-icon")).toBe(FALLBACK_PLUGIN_NAV_ICON);
		expect(resolvePluginNavIcon(undefined)).toBe(FALLBACK_PLUGIN_NAV_ICON);
	});
});
