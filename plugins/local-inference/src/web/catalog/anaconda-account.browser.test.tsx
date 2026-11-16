import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelError } from "@kilo-desktop/kernel";
import { Toaster } from "@kilo-desktop/ui/components/sonner";

import type { ModelCatalogState } from "../../contracts/index";
import {
	bootLocalInferenceHost,
	usageSnapshot,
	type LocalInferenceHost,
} from "../../test/local-inference-host";
import { LocalModelServerSettings } from "../settings/LocalModelServerSettings";
import { LocalModelCatalog } from "./ModelCatalog";

const WAIT = { timeout: 10_000 };
const SIGNED_OUT: ModelCatalogState = { title: "Anaconda", access: { status: "signed-out" } };
const signedIn = (accountKey: string): ModelCatalogState => ({
	title: "Anaconda",
	access: { status: "signed-in", accountKey },
});

afterEach(() => {
	cleanup();
});

/**
 * A stand-in `model-catalog` contribution titled "Anaconda", as `model-server`
 * reports it: signing in through `signInToCatalog` changes its access.
 */
function anacondaCatalog() {
	let host: LocalInferenceHost | undefined;
	let signedInAs: string | null = null;
	const signIn = vi.fn(async () => {
		signedInAs = "u1";
		host!.modelServer.update((state) => ({ ...state, catalog: signedIn("u1") }));
		return { ok: true as const };
	});
	return {
		signIn,
		attach: (next: LocalInferenceHost) => {
			host = next;
		},
		isSignedIn: () => signedInAs !== null,
		/** The account's key changed (another account, or a rotated key). */
		rotateKey: () => host!.setCatalog(signedIn("u2")),
	};
}

async function openCatalog(anaconda: ReturnType<typeof anacondaCatalog>) {
	const listCatalog = vi.fn(async () => {
		if (!anaconda.isSignedIn()) {
			throw new KernelError(
				"BUSINESS",
				"Sign in to your Anaconda account to view the model catalog.",
			);
		}
		return { models: [], total: 0 };
	});
	const host = await bootLocalInferenceHost({
		handlers: {
			listCatalog,
			signInToCatalog: anaconda.signIn,
			status: async () => ({ status: "ready", loadedModelIds: [] }),
			usage: async () => usageSnapshot,
			hardwareProfile: async () => ({
				name: "Test machine",
				kind: "unified-memory",
				accelerator: "metal",
				memoryTotalBytes: 16 * 1024 ** 3,
				systemMemoryTotalBytes: 16 * 1024 ** 3,
				memoryBandwidthGBps: 100,
			}),
		},
		initialState: { catalog: SIGNED_OUT },
	});
	anaconda.attach(host);
	host.render(<LocalModelServerSettings />);
	await page.getByRole("button", { name: "Add model" }).click();
	await page.getByRole("menuitem", { name: "From catalog" }).click();
	return { host, listCatalog };
}

describe("the model catalog and its model-catalog contribution", () => {
	it("asks to sign in to Anaconda, signs in through the catalog and shows it", async () => {
		const anaconda = anacondaCatalog();
		const { listCatalog } = await openCatalog(anaconda);
		const dialog = page.getByRole("dialog", { name: "Local Model Catalog" });

		await expect
			.element(
				dialog.getByText("Browse models from Anaconda and add them to your local model server."),
			)
			.toBeVisible();
		await expect.element(dialog.getByTestId("model-catalog-sign-in"), WAIT).toBeVisible();
		await expect
			.element(dialog.getByText("Sign in to Anaconda", { exact: true }).first())
			.toBeVisible();
		await dialog.getByTestId("model-catalog-sign-in-button").click();

		await vi.waitFor(() => expect(anaconda.signIn).toHaveBeenCalledTimes(1), WAIT);
		await expect.element(dialog.getByText("No models available"), WAIT).toBeVisible();
		await expect
			.element(dialog.getByText("Your Anaconda account has no models available."))
			.toBeVisible();
		expect(listCatalog.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it("refetches the catalog when the account's key changes", async () => {
		const anaconda = anacondaCatalog();
		const { listCatalog } = await openCatalog(anaconda);
		const dialog = page.getByRole("dialog", { name: "Local Model Catalog" });
		await dialog.getByTestId("model-catalog-sign-in-button").click();
		await expect.element(dialog.getByText("No models available"), WAIT).toBeVisible();
		const calls = listCatalog.mock.calls.length;

		await anaconda.rotateKey();

		await vi.waitFor(() => expect(listCatalog.mock.calls.length).toBeGreaterThan(calls), WAIT);
	});

	it("falls back to generic copy and the generic error without a catalog", async () => {
		const host = await bootLocalInferenceHost({
			handlers: {
				listCatalog: async () => {
					throw new KernelError("UNAVAILABLE", "No model catalog is available.");
				},
				status: async () => ({ status: "ready", loadedModelIds: [] }),
				usage: async () => usageSnapshot,
				hardwareProfile: async () => ({
					name: "Test machine",
					kind: "unified-memory",
					accelerator: "metal",
					memoryTotalBytes: 16 * 1024 ** 3,
					systemMemoryTotalBytes: 16 * 1024 ** 3,
					memoryBandwidthGBps: 100,
				}),
			},
			initialState: { catalog: null },
		});
		host.render(<LocalModelServerSettings />);
		await page.getByRole("button", { name: "Add model" }).click();
		await page.getByRole("menuitem", { name: "From catalog" }).click();
		const dialog = page.getByRole("dialog", { name: "Local Model Catalog" });

		await expect
			.element(dialog.getByText("Browse models and add them to your local model server."))
			.toBeVisible();
		await expect.element(dialog.getByTestId("model-catalog-error"), WAIT).toBeVisible();
		await expect.element(dialog.getByText("No model catalog is available.")).toBeVisible();
		expect(dialog.getByTestId("model-catalog-sign-in").query()).toBeNull();
	});

	it("reports a failed sign-in and keeps the prompt", async () => {
		const host = await bootLocalInferenceHost({
			handlers: {
				listCatalog: async () => {
					throw new KernelError("BUSINESS", "Sign in first.");
				},
				signInToCatalog: async () => {
					throw new Error("The browser could not be opened.");
				},
				cancelCatalogSignIn: async () => {
					throw new Error("ignored");
				},
				hardwareProfile: async () => ({
					name: "Test machine",
					kind: "unified-memory",
					accelerator: "metal",
					memoryTotalBytes: 16 * 1024 ** 3,
					systemMemoryTotalBytes: 16 * 1024 ** 3,
					memoryBandwidthGBps: 100,
				}),
			},
			initialState: { catalog: SIGNED_OUT },
		});
		host.render(
			<>
				<Toaster />
				<LocalModelCatalog onSelectModel={() => undefined} />
			</>,
		);

		await page.getByTestId("model-catalog-sign-in-button").click();

		await expect.element(page.getByText("Could not sign in to Anaconda"), WAIT).toBeVisible();
		await expect.element(page.getByText("The browser could not be opened.")).toBeVisible();
		await expect.element(page.getByTestId("model-catalog-sign-in")).toBeVisible();
	});
});
