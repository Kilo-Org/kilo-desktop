import {
	click,
	expectElementToBeVisible,
	fill,
	getLocatorByTestId,
	getLocatorByText,
} from "@anaconda/playwright-utils";

export class NotesPage {
	private readonly input = () => getLocatorByTestId("note-input");
	private readonly addButton = () => getLocatorByTestId("note-add");

	async addNote(text: string): Promise<void> {
		await fill(this.input(), text);
		await click(this.addButton());
	}

	async verifyNoteIsListed(text: string): Promise<void> {
		await expectElementToBeVisible(
			getLocatorByText(text, { exact: true }),
			`Note "${text}" should appear in the list`,
		);
		await expectElementToBeVisible(
			getLocatorByTestId("note-item"),
			"Note row should expose data-qa-id=note-item",
		);
	}
}
