import { test } from "../../fixtures/domain-map.js";

test.describe("Domain Map @smoke", () => {
	test("draws the app's domain objects in the right sidebar", async ({
		appShellPage,
		domainMapPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await domainMapPage.open();
		await domainMapPage.verifyMapDrawn();
	});
});
