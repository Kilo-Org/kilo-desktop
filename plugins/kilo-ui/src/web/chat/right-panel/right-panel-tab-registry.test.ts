import { describe, expect, it } from "vitest";

import type { Contribution } from "@anaconda-agentic-desktop/feature-sdk";

import {
	buildContributedTabDefinitions,
	contributionDefinitionId,
	createContributedTab,
	createPlanTab,
	CHAT_RIGHT_PANEL_TAB_EXTENSION,
	isRightPanelTab,
	PLAN_TAB_DEFINITION_ID,
} from "./right-panel-tab-registry.js";

const Canvas = () => null;

const contribution: Contribution = {
	featureId: "canvas",
	id: "canvas",
	zone: CHAT_RIGHT_PANEL_TAB_EXTENSION,
	label: "Canvas",
	description: "Scratch canvas",
	component: Canvas,
	priority: 50,
};

describe("right-panel-tab-registry", () => {
	it("builds stable definitions from SDK contributions", () => {
		expect(contributionDefinitionId(contribution)).toBe("canvas.canvas");
		expect(buildContributedTabDefinitions([contribution])).toMatchObject([
			{
				id: "canvas.canvas",
				title: "Canvas",
				description: "Scratch canvas",
				addable: true,
				Content: Canvas,
			},
		]);
	});

	it("creates unique, numbered instances for the same definition", () => {
		const [definition] = buildContributedTabDefinitions([contribution]);
		expect(definition).toBeDefined();
		const first = createContributedTab([], definition!, () => "one");
		const second = createContributedTab([first], definition!, () => "two");

		expect(first).toEqual({
			instanceId: "one",
			definitionId: "canvas.canvas",
			title: "Canvas 1",
			ordinal: 1,
		});
		expect(second).toEqual({
			instanceId: "two",
			definitionId: "canvas.canvas",
			title: "Canvas 2",
			ordinal: 2,
		});
	});

	it("keeps Plan as a stable singleton definition", () => {
		expect(createPlanTab()).toEqual({
			instanceId: "plan",
			definitionId: PLAN_TAB_DEFINITION_ID,
			title: "Plan",
			ordinal: null,
		});
		expect(isRightPanelTab(createPlanTab())).toBe(true);
	});
});
