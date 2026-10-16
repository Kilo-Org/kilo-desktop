import path from "node:path";

import { test } from "../fixtures.js";

test.use({ appIsolationKey: "files" });

test.describe("Files table viewer @packaged", () => {
	test("shows a Parquet file as a read-only Sift table @smoke", async ({
		appShellPage,
		filesPage,
		tableViewerPage,
		tableWorkspace,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await filesPage.createAndSelectWorkspace(tableWorkspace.path, tableWorkspace.name);
		await filesPage.openFilesPane();
		await filesPage.clickFileInTree(tableWorkspace.parquetFileName);

		await tableViewerPage.verifyTableIsLoaded(tableWorkspace.parquetFileName);
		await tableViewerPage.verifyCellIsShown(tableWorkspace.parquetFileName, "Lima");
		await tableViewerPage.verifyTableIsReadOnly(tableWorkspace.parquetFileName);
	});

	test("saves the CSV draft shown in the table view", async ({
		appShellPage,
		filesPage,
		tableViewerPage,
		tableWorkspace,
	}) => {
		const { csvFileName } = tableWorkspace;
		const draft = "city,score\nLima,7\n";
		await appShellPage.verifyShellIsLoaded();
		await filesPage.createAndSelectWorkspace(tableWorkspace.path, tableWorkspace.name);
		await filesPage.openFilesPane();
		await filesPage.clickFileInTree(csvFileName);
		await tableViewerPage.verifyTableIsLoaded(csvFileName);
		await tableViewerPage.verifyCellIsShown(csvFileName, "Åre");

		await tableViewerPage.replaceSourceAndShowTable(csvFileName, draft);
		await tableViewerPage.verifyTableIsLoaded(csvFileName);
		await tableViewerPage.verifyCellIsShown(csvFileName, "Lima");
		await tableViewerPage.saveFile(csvFileName);

		await tableViewerPage.verifyFileContents(path.join(tableWorkspace.path, csvFileName), draft);
	});
});
