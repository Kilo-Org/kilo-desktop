import { NotesPage } from "../../pages/features/sdk-producer/notes-page.js";
import { test as shellTest } from "../shell.js";

export const test = shellTest.extend<{ notesPage: NotesPage }>({
	// oxlint-disable-next-line no-empty-pattern -- Playwright requires `{}` destructuring
	notesPage: async ({}, use) => {
		await use(new NotesPage());
	},
});

export const { expect } = test;
