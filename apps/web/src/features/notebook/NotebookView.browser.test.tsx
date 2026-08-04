import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { notebookContract, type NotebookStatus } from "@anaconda-agentic-desktop/contracts";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { AppProviders } from "@/app/AppProviders";
import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { NotebookView } from "./NotebookView";

function renderView(status: () => NotebookStatus | Promise<NotebookStatus>) {
	const sdk = createFakeSdk({
		featureId: "notebook",
		channels: notebookContract,
		handlers: { status },
	});
	const system = createFakeFeatureSystem({ sdks: { notebook: sdk } });
	return render(
		<AppProviders localApi={createBrowserLocalApi()} system={system}>
			<NotebookView />
		</AppProviders>,
	);
}

afterEach(cleanup);

describe("NotebookView", () => {
	it("reports the daemon version and relay port once status resolves", async () => {
		renderView(() => ({
			relayPort: 51234,
			daemon: {
				version: "2.6.3",
				socketPath: "/tmp/runtimed.sock",
				isDevMode: true,
				blobPort: 48637,
			},
		}));

		await expect
			.element(page.getByTestId("notebook-status"))
			.toHaveTextContent("Daemon 2.6.3 · relay port 51234");
	});

	it("distinguishes a missing daemon from an unreachable service", async () => {
		renderView(() => ({ relayPort: 51234, daemon: null }));

		// A null daemon is an expected state — the sidecar may not be running —
		// so it must not read as a service failure.
		await expect
			.element(page.getByTestId("notebook-status"))
			.toHaveTextContent("Daemon not running.");
	});

	it("surfaces an unavailable notebook service", async () => {
		renderView(() => {
			throw new Error("no notebook feature in this mode");
		});

		await expect
			.element(page.getByTestId("notebook-status"))
			.toHaveTextContent("Notebook service unavailable.");
	});

	it("shows a placeholder while nteract's bundle is not served from our protocol", async () => {
		renderView(() => ({ relayPort: 51234, daemon: null }));

		await expect.element(page.getByTestId("notebook-placeholder")).toBeVisible();
		expect(document.querySelector('[data-qa-id="notebook-frame"]')).toBeNull();
	});
});
