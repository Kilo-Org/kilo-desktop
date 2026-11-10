import { MarketplacePage } from "../pages/marketplace/marketplace-page.js";
import { test as shellTest } from "./shell.js";

type MarketplaceFixtures = {
	marketplacePage: MarketplacePage;
};

export const test = shellTest.extend<MarketplaceFixtures>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	marketplacePage: async ({}, use) => {
		await use(new MarketplacePage());
	},
});

export const { expect } = test;
