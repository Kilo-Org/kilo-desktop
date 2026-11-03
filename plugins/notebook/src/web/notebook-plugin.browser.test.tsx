import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { bootNotebookHost } from "../test/notebook-host.js";

describe("kilo.notebook in the window", () => {
	it("contributes the Notebook pane kind, gated on sign-in like origin's tab", async () => {
		const host = await bootNotebookHost();

		expect(host.paneKind().metadata).toMatchObject({
			title: "Notebook",
			keepAlive: true,
			layoutKind: "notebook",
			launch: { newSession: true, inSession: true },
			availableWhen: { all: ["kilo.account/signedIn"] },
			unavailableHint: "Sign in to Kilo to use embedded notebooks.",
		});
	});

	it("renders without kilo.account, as when nothing gates notebooks", async () => {
		const host = await bootNotebookHost({ identity: null });
		host.renderPane();

		await expect.element(page.getByTestId("notebook-view")).toBeVisible();
	});
});
