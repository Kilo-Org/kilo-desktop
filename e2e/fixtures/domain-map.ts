import { DomainMapPage } from "../pages/domain-map/domain-map-page.js";
import { test as shellTest } from "./shell.js";

/** kilo.domain-map, in the shared app (the e2e build forces the `developer` flag on). */
export const test = shellTest.extend<{ domainMapPage: DomainMapPage }>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	domainMapPage: async ({}, use) => {
		await use(new DomainMapPage());
	},
});

export const { expect } = test;
