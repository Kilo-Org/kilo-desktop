import { describe, expect, it } from "vitest";

import type { MarketplaceItem } from "../contracts/schemas.js";
import { filterMarketplaceItems } from "./marketplace-filter.js";

const items: MarketplaceItem[] = [
	{
		type: "agent",
		id: "reviewer",
		name: "Reviewer",
		description: "Reviews pull requests",
		category: "engineering",
		content: {
			mode: "subagent",
			description: "Reviews code",
			prompt: "Review.",
		},
	},
	{
		type: "skill",
		id: "notebooks",
		name: "Notebooks",
		description: "Builds data science notebooks",
		category: "data",
		content: "https://example.com/notebooks.tar.gz",
		githubUrl: "https://github.com/example/notebooks",
	},
];

describe("filterMarketplaceItems", () => {
	it("combines text, category, and installation filters", () => {
		const visible = filterMarketplaceItems(
			items,
			[{ type: "agent", id: "reviewer", scope: "global" }],
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
			{ type: "agent" as const, id: "reviewer", scope: "global" as const },
			{
				type: "agent" as const,
				id: "reviewer",
				scope: "workspace" as const,
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
