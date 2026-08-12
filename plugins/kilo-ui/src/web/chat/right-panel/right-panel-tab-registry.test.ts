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

const Notebook = () => null;

const contribution: Contribution = {
	featureId: "notebook",
	id: "notebook",
	zone: CHAT_RIGHT_PANEL_TAB_EXTENSION,
	label: "Notebook",
	description: "Scratch notebook",
	component: Notebook,
	priority: 50,
};

describe("right-panel-tab-registry", () => {
	it("builds stable definitions from SDK contributions", () => {
		expect(contributionDefinitionId(contribution)).toBe("notebook.notebook");
		expect(buildContributedTabDefinitions([contribution])).toMatchObject([
			{
				id: "notebook.notebook",
				title: "Notebook",
				description: "Scratch notebook",
				addable: true,
				Content: Notebook,
			},
		]);
	});

	it("creates unique, numbered instances for the same definition", () => {
		const [definition] = buildContributedTabDefinitions([contribution]);
		expect(definition).toBeDefined();
		const first = createContributedTab([], definition!, () => "one");
		const second = createContributedTab([first], definition!, () => "two");

		expect(first).toEqual({
			instanceId: "notebook.notebook:one",
			definitionId: "notebook.notebook",
			title: "Notebook 1",
			ordinal: 1,
		});
		expect(second).toEqual({
			instanceId: "notebook.notebook:two",
			definitionId: "notebook.notebook",
			title: "Notebook 2",
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
