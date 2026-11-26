import { describe, expect, it } from "vitest";

import type { MarketplaceItem } from "../contracts/schemas";
import { filterMarketplaceItems } from "./marketplace-filter";

const base = { registry: "kilo", tags: [], prerequisites: [], parameters: [], options: [] };
const items: MarketplaceItem[] = [
	{
		...base,
		kind: "agent",
		id: "reviewer",
		name: "Reviewer",
		description: "Reviews pull requests",
		category: "engineering",
	},
	{
		...base,
		kind: "skill",
		id: "notebooks",
		name: "Notebooks",
		description: "Builds data science notebooks",
		category: "data",
	},
];

describe("filterMarketplaceItems", () => {
	it("combines text, category, and installation filters", () => {
		const visible = filterMarketplaceItems(
			items,
			[{ registry: "kilo", kind: "agent", id: "reviewer", scope: "global" }],
			{
				search: "pull",
				category: ["engineering"],
				status: "installed",
			},
		);

		expect(visible.map((item) => item.id)).toEqual(["reviewer"]);
	});

	it("combines multiple categories", () => {
		const input = { search: "", status: "all" as const };

		expect(
			filterMarketplaceItems(items, [], { ...input, category: ["engineering", "data"] }).map(
				(item) => item.id,
			),
		).toEqual(["reviewer", "notebooks"]);
		expect(
			filterMarketplaceItems(items, [], { ...input, category: ["data"] }).map((item) => item.id),
		).toEqual(["notebooks"]);
	});

	it("keeps catalog items discoverable even when every destination is installed", () => {
		const installedEverywhere = [
			{ registry: "kilo", kind: "agent" as const, id: "reviewer", scope: "global" as const },
			{
				registry: "kilo",
				kind: "agent" as const,
				id: "reviewer",
				scope: "project" as const,
				workspaceId: "workspace-a",
			},
		];
		const input = { search: "", category: [] };

		expect(
			filterMarketplaceItems(items, installedEverywhere, { ...input, status: "all" }).map(
				(item) => item.id,
			),
		).toEqual(["reviewer", "notebooks"]);
		expect(
			filterMarketplaceItems(items, installedEverywhere, { ...input, status: "installed" }).map(
				(item) => item.id,
			),
		).toEqual(["reviewer"]);
	});
});
