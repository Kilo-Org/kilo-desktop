import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { NOTEBOOK_COMMANDS, NOTEBOOK_PANE_KIND } from "../contracts/index.js";
import { bootNotebookHost } from "../test/notebook-host.js";

describe("kilo.notebook in the window", () => {
	it("contributes the Notebook pane kind, gated on sign-in like origin's tab", async () => {
		const host = await bootNotebookHost();

		expect(host.paneKind().metadata).toMatchObject({
			title: "Notebook",
			keepAlive: true,
			layoutKind: "notebook",
			launch: { newSession: true, inSession: true },
			availableWhen: { all: ["kilo.core/signedIn"] },
			unavailableHint: "Sign in to Kilo to use embedded notebooks.",
		});
	});

	it("renders without kilo.core's account, as when nothing gates notebooks", async () => {
		const host = await bootNotebookHost({ account: null });
		host.renderPane();

		await expect.element(page.getByTestId("notebook-view")).toBeVisible();
	});

	it("opens a Notebook pane the way a person does from its command", async () => {
		const host = await bootNotebookHost();

		await host.renderer.commands.execute(NOTEBOOK_COMMANDS.open);

		expect(host.openedPanes).toEqual([{ kind: NOTEBOOK_PANE_KIND }]);
	});
});
