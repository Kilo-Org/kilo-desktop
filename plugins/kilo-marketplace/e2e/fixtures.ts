import { test as shellTest } from "@kilo-desktop/e2e/fixtures";

import { MarketplacePage } from "./pages/marketplace-page.js";

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
