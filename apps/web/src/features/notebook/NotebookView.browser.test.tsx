import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { notebookContract, type NotebookStatus } from "@anaconda-agentic-desktop/contracts";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { AppProviders } from "@/app/AppProviders";
import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { NotebookView, notebookOriginFrom } from "./NotebookView";

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

afterEach(() => {
	cleanup();
	vi.unstubAllEnvs();
});

describe("NotebookView", () => {
	it("reports the daemon version and relay port once status resolves", async () => {
		renderView(() => ({
			relayPort: 51234,
			availability: { status: "available" },
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

	it("explains the external runtime prerequisite when the daemon is absent", async () => {
		renderView(() => ({
			relayPort: 51234,
			availability: {
				status: "unavailable",
				reason: "The nteract runtime service is not running. Install or start nteract, then retry.",
			},
			daemon: null,
		}));

		await expect
			.element(page.getByTestId("notebook-status"))
			.toHaveTextContent(
				"The nteract runtime service is not running. Install or start nteract, then retry.",
			);
	});

	it("surfaces an unavailable notebook service", async () => {
		renderView(() => {
			throw new Error("no notebook feature in this mode");
		});

		await expect
			.element(page.getByTestId("notebook-status"))
			.toHaveTextContent("Notebook service unavailable.");
	});

	it("derives the notebook origin by substituting the host on our own", () => {
		// The renderer cannot read app.isPackaged, so the scheme has to come from its
		// own origin — otherwise a dev build would frame the production host.
		expect(notebookOriginFrom("anaconda-agentic-desktop://app")).toBe(
			"anaconda-agentic-desktop://notebook",
		);
		expect(notebookOriginFrom("anaconda-agentic-desktop-dev://app")).toBe(
			"anaconda-agentic-desktop-dev://notebook",
		);
	});

	it("has no notebook origin in browser mode, where the protocol does not exist", () => {
		expect(notebookOriginFrom("http://localhost:5173")).toBeUndefined();
		expect(notebookOriginFrom("https://anaconda.com")).toBeUndefined();
		expect(notebookOriginFrom("not a url")).toBeUndefined();
	});

	it("shows a placeholder while nteract's bundle is not served from our protocol", async () => {
		renderView(() => ({
			relayPort: 51234,
			availability: { status: "unavailable" },
			daemon: null,
		}));

		await expect.element(page.getByTestId("notebook-placeholder")).toBeVisible();
		expect(document.querySelector('[data-qa-id="notebook-frame"]')).toBeNull();
	});

	it("frames nteract's dev server when an origin is configured", async () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", "http://localhost:8737");
		renderView(() => ({
			relayPort: 51234,
			availability: { status: "unavailable" },
			daemon: null,
		}));

		const frame = document.querySelector('[data-qa-id="notebook-frame"]');
		// The notebook path travels as a query param, not a route segment.
		expect(frame?.getAttribute("src")).toBe(
			"http://localhost:8737/?path=%2Ftmp%2Fad-nb-python.ipynb",
		);
		expect(document.querySelector('[data-qa-id="notebook-placeholder"]')).toBeNull();
	});
});
