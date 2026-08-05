import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
	cleanup();
	vi.unstubAllEnvs();
});

describe("NotebookView", () => {
	it("reports the daemon version and relay port once status resolves", async () => {
		renderView(() => ({
			relayPort: 51234,
			process: { status: "running" },
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
		renderView(() => ({ relayPort: 51234, process: { status: "idle" }, daemon: null }));

		// A null daemon is an expected state — the sidecar may not be running —
		// so it must not read as a service failure.
		await expect
			.element(page.getByTestId("notebook-status"))
			.toHaveTextContent("Daemon not running.");
	});

	it("explains why the daemon is absent when the supervisor gave up", async () => {
		// `daemon: null` alone is ambiguous — no bundled sidecar looks identical to
		// a crash loop. The supervisor's reason is what distinguishes them.
		renderView(() => ({
			relayPort: 51234,
			process: { status: "failed", reason: "no daemon binary is bundled with this build" },
			daemon: null,
		}));

		await expect
			.element(page.getByTestId("notebook-status"))
			.toHaveTextContent("Daemon unavailable: no daemon binary is bundled with this build");
	});

	it("names both versions when another app's daemon holds the socket", async () => {
		// This is not a transient state and not something the user can wait out, so
		// the message has to explain the conflict rather than read as "starting".
		renderView(() => ({
			relayPort: 51234,
			process: {
				status: "incompatible",
				runningVersion: "2.6.3+aaaaaaa",
				bundledVersion: "2.6.3+bbbbbbb",
			},
			daemon: null,
		}));

		await expect
			.element(page.getByTestId("notebook-status"))
			.toHaveTextContent(
				"A different notebook daemon is already running (2.6.3+aaaaaaa); this app needs 2.6.3+bbbbbbb.",
			);
	});

	it("reads a restart as progress rather than as an error", async () => {
		renderView(() => ({
			relayPort: 51234,
			process: { status: "restarting" },
			daemon: null,
		}));

		await expect
			.element(page.getByTestId("notebook-status"))
			.toHaveTextContent("Restarting the notebook daemon…");
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
		renderView(() => ({ relayPort: 51234, process: { status: "idle" }, daemon: null }));

		await expect.element(page.getByTestId("notebook-placeholder")).toBeVisible();
		expect(document.querySelector('[data-qa-id="notebook-frame"]')).toBeNull();
	});

	it("frames nteract's dev server when an origin is configured", async () => {
		vi.stubEnv("VITE_NTERACT_ORIGIN", "http://localhost:8737");
		renderView(() => ({ relayPort: 51234, process: { status: "idle" }, daemon: null }));

		const frame = document.querySelector('[data-qa-id="notebook-frame"]');
		// The notebook path travels as a query param, not a route segment.
		expect(frame?.getAttribute("src")).toBe(
			"http://localhost:8737/?path=%2Ftmp%2Fad-nb-python.ipynb",
		);
		expect(document.querySelector('[data-qa-id="notebook-placeholder"]')).toBeNull();
	});
});
