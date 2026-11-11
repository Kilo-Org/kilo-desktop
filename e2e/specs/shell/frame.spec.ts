import { test } from "../../fixtures/shell.js";

test.describe("Shell frame @smoke @packaged", () => {
	test("shrinks an empty top bar while the sidebar is docked", async ({ appShellPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.verifyEmptyTopBarShrinksWhileDocked();
	});
});
