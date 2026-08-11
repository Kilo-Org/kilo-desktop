import { describe, expect, it } from "vitest";

import {
	ADDABLE_RIGHT_PANEL_TABS,
	createRightPanelTab,
	getRightPanelTabDefinition,
	isRightPanelTabKind,
	RIGHT_PANEL_TAB_KINDS,
	RIGHT_PANEL_TAB_REGISTRY,
} from "./right-panel-tab-registry.js";

describe("right-panel-tab-registry", () => {
	it("derives kinds from the registry keys", () => {
		expect([...RIGHT_PANEL_TAB_KINDS].sort()).toEqual(Object.keys(RIGHT_PANEL_TAB_REGISTRY).sort());
		for (const kind of RIGHT_PANEL_TAB_KINDS) {
			expect(getRightPanelTabDefinition(kind).kind).toBe(kind);
			expect(createRightPanelTab(kind)).toEqual({ id: kind, kind });
		}
	});

	it("exposes only addable tabs in the add menus", () => {
		expect(ADDABLE_RIGHT_PANEL_TABS.every((definition) => definition.addable)).toBe(true);
		expect(ADDABLE_RIGHT_PANEL_TABS.map((definition) => definition.kind)).toEqual(["placeholder"]);
		expect(isRightPanelTabKind("placeholder")).toBe(true);
		expect(isRightPanelTabKind("terminal")).toBe(false);
	});
});
