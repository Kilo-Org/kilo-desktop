import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { AuthSession } from "@kilo-desktop/feature-sdk";

import type {
	LocalInferenceHardwareProfile,
	LocalInferenceStatus,
	LocalModel,
	ModelCatalogEntry,
	ModelDownload,
} from "../../contracts/schemas.js";
import { renderSettings, usageSnapshot } from "../../test/render-local-model-server-settings.js";

afterEach(() => {
	cleanup();
});

const catalogModel: ModelCatalogEntry = {
	id: "catalog-model",
	name: "Catalog Model",
	description: "A catalog model.",
	numParameters: 1_000_000_000,
	modelType: "Text Generation",
	publisher: "google",
	libraryName: "transformers",
	license: "apache-2.0",
	contextWindowSize: 8_192,
	publishedAt: "2026-01-01T00:00:00Z",
	tags: [],
	quantizations: [
		{
			id: "catalog-model-q8",
			method: "Q8_0",
			sizeBytes: 8 * 1024 ** 3,
			sha256: "8".repeat(64),
		},
		{
			id: "catalog-model-q4",
			method: "Q4_K_M",
			sizeBytes: 4 * 1024 ** 3,
			sha256: "4".repeat(64),
		},
	],
	capabilities: {
		chat: true,
		embedding: false,
		vision: false,
		toolCalling: false,
	},
};

const hardwareProfile: LocalInferenceHardwareProfile = {
	name: "Apple M4 Pro",
	kind: "unified-memory",
	accelerator: "metal",
	memoryTotalBytes: 24 * 1024 ** 3,
	systemMemoryTotalBytes: 24 * 1024 ** 3,
	memoryBandwidthGBps: 273,
};

const constrainedHardwareProfile: LocalInferenceHardwareProfile = {
	...hardwareProfile,
	name: "Low-memory machine",
	memoryTotalBytes: 1024 ** 3,
	systemMemoryTotalBytes: 1024 ** 3,
};

describe("LocalModelServerSettings", () => {
	it("imports a selected GGUF model", async () => {
		const addModel = vi.fn(async ({ path }: { path: string }) => ({
			id: "tiny-a1b2c3d4",
			name: "Tiny",
			path,
			available: true,
			addedAt: 1,
		}));
		const { baseElement } = renderSettings(
			{
				"models.add": addModel,
				"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
				"usage.get": async () => usageSnapshot,
			},
			{ getPathForFile: (file) => `/models/${file.name}` },
		);
		const screen = page.elementLocator(baseElement);
		const picker = baseElement.querySelector<HTMLInputElement>(
			"[data-qa-id='local-model-server-file']",
		);
		expect(picker).not.toBeNull();
		const click = vi.spyOn(picker!, "click");

		await screen.getByRole("button", { name: "Add model" }).click();
		await page.getByRole("menuitem", { name: "Import GGUF" }).click();
		expect(click).toHaveBeenCalledOnce();

		Object.defineProperty(picker, "files", {
			configurable: true,
			value: [new File([], "tiny.gguf")],
		});
		picker!.dispatchEvent(new Event("change", { bubbles: true }));

		await expect.poll(() => addModel).toHaveBeenCalledWith({ path: "/models/tiny.gguf" });
	});

	it("opens the local model catalog from the add model menu", async () => {
		const { baseElement } = renderSettings({
			"catalog.list": async () => ({ models: [], total: 0 }),
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByText("No models added", { exact: true })).toBeVisible();

		await screen.getByRole("button", { name: "Add model" }).click();
		await page.getByRole("menuitem", { name: "From catalog" }).click();

		const dialog = page.getByRole("dialog", { name: "Local Model Catalog" });
		await expect.element(dialog).toBeVisible();
		await expect.element(dialog.getByText("No models available")).toBeVisible();
		const dialogBounds = dialog.element().getBoundingClientRect();
		expect(dialogBounds.top).toBeGreaterThanOrEqual(48);
		const bottomMargin = window.innerHeight - dialogBounds.bottom;
		expect(Math.abs(dialogBounds.top - bottomMargin)).toBeLessThanOrEqual(1);
		expect(dialogBounds.left).toBeGreaterThanOrEqual(16);
		expect(window.innerWidth - dialogBounds.right).toBeGreaterThanOrEqual(16);
		expect(dialogBounds.width).toBeLessThanOrEqual(80 * 16 + 1);

		await dialog.getByRole("button", { name: "Close" }).click();
		await expect.element(dialog).not.toBeInTheDocument();
	});

	it("prompts for Anaconda sign-in when opening the catalog while signed out", async () => {
		let session: AuthSession = { status: "anonymous" };
		const listeners = new Set<(next: AuthSession) => void>();
		const listCatalog = vi.fn(async () => ({ models: [], total: 0 }));
		const getHardware = vi.fn(async () => hardwareProfile);
		const login = vi.fn(async (): Promise<AuthSession> => {
			session = {
				status: "authenticated",
				user: { email: "test@example.com" },
			};
			for (const listener of listeners) listener(session);
			return session;
		});
		const { baseElement } = renderSettings(
			{
				"catalog.list": listCatalog,
				"hardware.profile": getHardware,
				"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
				"usage.get": async () => usageSnapshot,
			},
			{},
			{
				subscribe(listener) {
					listeners.add(listener);
					listener(session);
					return () => listeners.delete(listener);
				},
				peek: () => session,
				login,
			},
		);
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Add model" }).click();
		await page.getByRole("menuitem", { name: "From catalog" }).click();

		const modal = page.getByTestId("anaconda-sign-in-dialog");
		await expect.element(modal).toBeVisible();
		expect(listCatalog).not.toHaveBeenCalled();
		expect(getHardware).not.toHaveBeenCalled();

		await modal.getByTestId("anaconda-sign-in-submit").click();

		expect(login).toHaveBeenCalledOnce();
		await expect.element(modal).not.toBeInTheDocument();
		const dialog = page.getByRole("dialog", { name: "Local Model Catalog" });
		await expect.element(dialog).toBeVisible();
		await expect.element(dialog.getByText("No models available")).toBeVisible();
		expect(listCatalog).toHaveBeenCalledOnce();
		expect(getHardware).toHaveBeenCalledOnce();
	});

	it("closes the catalog when the session is lost while browsing", async () => {
		let session: AuthSession = {
			status: "authenticated",
			user: { email: "test@example.com" },
		};
		const listeners = new Set<(next: AuthSession) => void>();
		const { baseElement } = renderSettings(
			{
				"catalog.list": async () => ({ models: [], total: 0 }),
				"hardware.profile": async () => hardwareProfile,
				"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
				"usage.get": async () => usageSnapshot,
			},
			{},
			{
				subscribe(listener) {
					listeners.add(listener);
					listener(session);
					return () => listeners.delete(listener);
				},
				peek: () => session,
			},
		);
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Add model" }).click();
		await page.getByRole("menuitem", { name: "From catalog" }).click();
		const dialog = page.getByRole("dialog", { name: "Local Model Catalog" });
		await expect.element(dialog).toBeVisible();

		session = { status: "anonymous" };
		for (const listener of listeners) listener(session);

		await expect.element(dialog).not.toBeInTheDocument();
	});

	it("retries the catalog request inside the modal", async () => {
		const listCatalog = vi
			.fn()
			.mockRejectedValueOnce(new Error("Catalog unavailable"))
			.mockResolvedValue({ models: [], total: 0 });
		const { baseElement } = renderSettings({
			"catalog.list": listCatalog,
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Add model" }).click();
		await page.getByRole("menuitem", { name: "From catalog" }).click();

		const dialog = page.getByRole("dialog", { name: "Local Model Catalog" });
		await expect.element(dialog.getByText("Could not load models")).toBeVisible();
		await expect.element(dialog.getByText("Catalog unavailable")).toBeVisible();

		await dialog.getByRole("button", { name: "Try again" }).click();
		await expect.element(dialog.getByText("No models available")).toBeVisible();
		await expect.poll(() => listCatalog).toHaveBeenCalledTimes(2);
	});

	it("shows structural skeletons in both catalog panes while data loads", async () => {
		let resolveCatalog:
			| ((value: { models: ModelCatalogEntry[]; total: number }) => void)
			| undefined;
		let resolveHardware: ((value: LocalInferenceHardwareProfile) => void) | undefined;
		const catalogResponse = new Promise<{ models: ModelCatalogEntry[]; total: number }>(
			(resolve) => {
				resolveCatalog = resolve;
			},
		);
		const hardwareResponse = new Promise<LocalInferenceHardwareProfile>((resolve) => {
			resolveHardware = resolve;
		});
		const { baseElement } = renderSettings({
			"catalog.list": () => catalogResponse,
			"hardware.profile": () => hardwareResponse,
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Add model" }).click();
		await page.getByRole("menuitem", { name: "From catalog" }).click();
		const dialog = page.getByRole("dialog", { name: "Local Model Catalog" });
		await expect.element(dialog.getByTestId("model-catalog-loading")).toBeVisible();
		await expect.element(dialog.getByTestId("model-catalog-detail-loading")).toBeVisible();

		resolveCatalog?.({ models: [catalogModel], total: 1 });
		await expect.element(dialog.getByTestId("model-catalog-loading")).toBeVisible();
		resolveHardware?.(hardwareProfile);

		await expect.element(dialog.getByTestId("model-catalog-loading")).not.toBeInTheDocument();
		await expect
			.element(dialog.getByTestId("model-catalog-detail-loading"))
			.not.toBeInTheDocument();
		await expect.element(dialog.getByTestId("model-catalog-detail-empty")).toBeVisible();
	});

	it("shows model details beside the catalog and selects a quantization", async () => {
		const { baseElement } = renderSettings({
			"catalog.list": async () => ({ models: [catalogModel], total: 1 }),
			"hardware.profile": async () => hardwareProfile,
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Add model" }).click();
		await page.getByRole("menuitem", { name: "From catalog" }).click();

		const catalogDialog = page.getByRole("dialog", { name: "Local Model Catalog" });
		await expect.element(catalogDialog.getByTestId("model-catalog-detail-empty")).toBeVisible();
		await catalogDialog.getByRole("row", { name: /Catalog Model/ }).click();

		const detailDialog = catalogDialog.getByTestId("model-catalog-detail-pane");
		await expect.element(catalogDialog.getByTestId("model-catalog-table")).toBeVisible();
		await expect
			.element(catalogDialog.getByTestId("model-catalog-detail-empty"))
			.not.toBeInTheDocument();
		await expect
			.element(detailDialog.getByTestId("model-catalog-detail-catalog-model"))
			.toBeVisible();
		const modelIdentity = detailDialog.getByTestId("model-catalog-detail-identity");
		await expect
			.element(modelIdentity.getByRole("heading", { name: catalogModel.name }))
			.toBeVisible();
		await expect.element(modelIdentity.getByRole("paragraph")).toHaveTextContent("Google");
		await expect.element(detailDialog.getByTestId("model-catalog-detail-publisher")).toBeVisible();
		const downloadControls = detailDialog.getByTestId("model-catalog-download-controls");
		const quantization = downloadControls.getByRole("combobox", { name: "Quantization" });
		await expect.element(downloadControls).toBeVisible();
		await expect.element(quantization.getByText("Q4_K_M")).toBeVisible();
		await expect.element(quantization.getByText("4 GB", { exact: true })).toBeVisible();
		await expect.element(downloadControls.getByRole("button", { name: "Add model" })).toBeEnabled();
		await expect.element(downloadControls.getByText("Estimated performance")).toBeVisible();
		await expect.element(downloadControls.getByText("~142–212", { exact: true })).toBeVisible();
		await expect
			.element(detailDialog.getByTestId("model-catalog-details-content"))
			.toHaveTextContent(catalogModel.description);
		await expect.element(detailDialog.getByTestId("model-catalog-details-content")).toBeVisible();
		const metadata = detailDialog.getByTestId("model-catalog-metadata");
		for (const text of [
			"Parameters",
			"1B",
			"Capabilities",
			"Chat",
			"License",
			"apache-2.0",
			"Context Window",
			"8,192 tokens",
			"Purpose",
			"Text Generation",
		]) {
			await expect.element(metadata.getByText(text, { exact: true })).toBeVisible();
		}
		await expect
			.element(metadata.getByText("Chat", { exact: true }))
			.toHaveAttribute("data-slot", "badge");

		await quantization.click();
		const q8Option = page.getByRole("option", { name: "Q8_0, 8 GB" });
		await expect.element(q8Option.getByText("8 GB", { exact: true })).toBeVisible();
		await expect
			.element(
				page.getByRole("option", { name: "Q4_K_M, 4 GB" }).getByText("4 GB", { exact: true }),
			)
			.toBeVisible();
		await q8Option.click();
		await expect.element(quantization.getByText("Q8_0")).toBeVisible();
		await expect.element(quantization.getByText("8 GB", { exact: true })).toBeVisible();
		await expect.element(downloadControls.getByText("~94–142", { exact: true })).toBeVisible();
		await expect
			.element(catalogDialog.getByRole("row", { name: /Catalog Model/ }))
			.toHaveAttribute("aria-selected", "true");
	});

	it("does not allow a model quantization that does not fit", async () => {
		const startDownload = vi.fn();
		const { baseElement } = renderSettings({
			"catalog.list": async () => ({ models: [catalogModel], total: 1 }),
			"catalog.download.start": startDownload,
			"hardware.profile": async () => constrainedHardwareProfile,
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Add model" }).click();
		await page.getByRole("menuitem", { name: "From catalog" }).click();
		const dialog = page.getByRole("dialog", { name: "Local Model Catalog" });
		await dialog.getByRole("row", { name: /Catalog Model/ }).click();

		const controls = dialog.getByTestId("model-catalog-download-controls");
		const addModel = controls.getByRole("button", { name: "Add model" });
		await expect.element(controls.getByText("Doesn’t Fit", { exact: true })).toBeVisible();
		await expect.element(addModel).toBeDisabled();
		await expect
			.element(
				controls.getByText("This quantization needs more memory than this machine can safely use."),
			)
			.toBeVisible();
		expect(startDownload).not.toHaveBeenCalled();
	});

	it("shows download progress and refreshes the registered model on completion", async () => {
		const identity = { modelId: "catalog-model", quantizationId: "catalog-model-q4" };
		const initialDownload: ModelDownload = {
			...identity,
			status: "downloading",
			transferredBytes: 0,
			totalBytes: 4 * 1024 ** 3,
			percentage: 0,
		};
		let models: LocalModel[] = [];
		const startDownload = vi.fn(async () => initialDownload);
		const listModels = vi.fn(async () => models);
		const removeModel = vi.fn(async () => ({ ok: true as const }));
		const { baseElement, sdk } = renderSettings({
			"catalog.list": async () => ({ models: [catalogModel], total: 1 }),
			"catalog.download.start": startDownload,
			"hardware.profile": async () => hardwareProfile,
			"models.list": listModels,
			"models.remove": removeModel,
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Add model" }).click();
		await page.getByRole("menuitem", { name: "From catalog" }).click();
		const dialog = page.getByRole("dialog", { name: "Local Model Catalog" });
		await dialog.getByRole("row", { name: /Catalog Model/ }).click();
		await dialog.getByRole("button", { name: "Add model" }).click();

		await expect.poll(() => startDownload).toHaveBeenCalledWith(identity);
		await expect.element(dialog.getByText("Downloading 0%", { exact: true })).toBeVisible();
		await expect
			.element(dialog.getByRole("button", { name: "Downloading 0%" }))
			.not.toBeInTheDocument();
		const cancelAtZero = dialog.getByRole("button", { name: "Cancel download at 0%" });
		await expect.element(cancelAtZero).toBeEnabled();
		expect(cancelAtZero.element().textContent).toBe("");
		const quantizationSelect = dialog.getByTestId("model-catalog-quantization-select");
		const quantizationWidthAtZero = quantizationSelect.element().getBoundingClientRect().width;

		sdk.events.emit("catalog-download-changed", {
			...initialDownload,
			transferredBytes: 2 * 1024 ** 3,
			percentage: 50,
		});
		await expect.element(dialog.getByText("Downloading 50%", { exact: true })).toBeVisible();
		await expect
			.element(dialog.getByRole("button", { name: "Cancel download at 50%" }))
			.toBeEnabled();
		expect(quantizationSelect.element().getBoundingClientRect().width).toBeCloseTo(
			quantizationWidthAtZero,
			1,
		);

		models = [
			{
				id: "downloaded-model",
				name: "Catalog Model (Q4_K_M)",
				path: "/models/Catalog-Model_Q4_K_M.gguf",
				available: true,
				addedAt: 1,
				catalog: identity,
				managedFile: true,
				sizeBytes: 4 * 1024 ** 3,
			},
		];
		sdk.events.emit("catalog-download-changed", {
			...initialDownload,
			status: "completed",
			transferredBytes: 4 * 1024 ** 3,
			percentage: 100,
		});

		await expect.element(dialog.getByText("Added", { exact: true })).toBeVisible();
		await expect.element(dialog.getByRole("button", { name: "Added" })).not.toBeInTheDocument();
		const deleteButton = dialog.getByRole("button", {
			name: "Delete downloaded file for Catalog Model (Q4_K_M)",
		});
		expect(deleteButton.element().textContent).toBe("");
		await deleteButton.click();
		const deleteDialog = page.getByRole("alertdialog", { name: "Delete downloaded model?" });
		await expect.element(deleteDialog.getByText(/4 GB/)).toBeVisible();
		await deleteDialog.getByRole("button", { name: "Delete file" }).click();
		await expect
			.poll(() => removeModel)
			.toHaveBeenCalledWith({ id: "downloaded-model", mode: "delete-managed-file" });
		await expect.poll(() => listModels.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it("cancels an active download without showing an error and can restart it", async () => {
		const identity = { modelId: "catalog-model", quantizationId: "catalog-model-q4" };
		const activeDownload: ModelDownload = {
			...identity,
			status: "downloading",
			transferredBytes: 1024,
			totalBytes: 4096,
			percentage: 25,
		};
		const cancelDownload = vi.fn(async () => ({
			...activeDownload,
			status: "cancelling" as const,
		}));
		const startDownload = vi.fn(async () => ({
			...activeDownload,
			transferredBytes: 0,
			percentage: 0,
		}));
		const { baseElement, sdk } = renderSettings({
			"catalog.list": async () => ({ models: [catalogModel], total: 1 }),
			"catalog.downloads.list": async () => [activeDownload],
			"catalog.download.cancel": cancelDownload,
			"catalog.download.start": startDownload,
			"hardware.profile": async () => hardwareProfile,
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Add model" }).click();
		await page.getByRole("menuitem", { name: "From catalog" }).click();
		const dialog = page.getByRole("dialog", { name: "Local Model Catalog" });
		await dialog.getByRole("row", { name: /Catalog Model/ }).click();
		await dialog.getByRole("button", { name: "Cancel download at 25%" }).click();

		await expect.poll(() => cancelDownload).toHaveBeenCalledWith(identity);
		await expect
			.element(dialog.getByRole("button", { name: "Cancelling download" }))
			.toBeDisabled();
		sdk.events.emit("catalog-download-changed", {
			...activeDownload,
			status: "cancelled",
		});
		const addButton = dialog.getByRole("button", { name: "Add model" });
		await expect.element(addButton).toBeEnabled();
		await expect.element(dialog.getByText(/cancel/i)).not.toBeInTheDocument();

		await addButton.click();
		await expect.poll(() => startDownload).toHaveBeenCalledWith(identity);
		await expect.element(dialog.getByText("Downloading 0%", { exact: true })).toBeVisible();
		await expect
			.element(dialog.getByRole("button", { name: "Cancel download at 0%" }))
			.toBeEnabled();
	});

	it("restores progress after the catalog is closed and reopened", async () => {
		const activeDownload: ModelDownload = {
			modelId: "catalog-model",
			quantizationId: "catalog-model-q4",
			status: "downloading",
			transferredBytes: 1515,
			totalBytes: 4096,
			percentage: 37,
		};
		const { baseElement } = renderSettings({
			"catalog.list": async () => ({ models: [catalogModel], total: 1 }),
			"catalog.downloads.list": async () => [activeDownload],
			"hardware.profile": async () => hardwareProfile,
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Add model" }).click();
		await page.getByRole("menuitem", { name: "From catalog" }).click();
		let dialog = page.getByRole("dialog", { name: "Local Model Catalog" });
		await dialog.getByRole("row", { name: /Catalog Model/ }).click();
		await expect
			.element(dialog.getByRole("button", { name: "Cancel download at 37%" }))
			.toBeVisible();
		await dialog.getByRole("button", { name: "Close" }).click();

		await screen.getByRole("button", { name: "Add model" }).click();
		await page.getByRole("menuitem", { name: "From catalog" }).click();
		dialog = page.getByRole("dialog", { name: "Local Model Catalog" });
		await dialog.getByRole("row", { name: /Catalog Model/ }).click();
		await expect
			.element(dialog.getByRole("button", { name: "Cancel download at 37%" }))
			.toBeVisible();
	});

	it("keeps progress independent when switching quantizations", async () => {
		const q4Download: ModelDownload = {
			modelId: "catalog-model",
			quantizationId: "catalog-model-q4",
			status: "downloading",
			transferredBytes: 1024,
			totalBytes: 4096,
			percentage: 25,
		};
		const q8Download: ModelDownload = {
			modelId: "catalog-model",
			quantizationId: "catalog-model-q8",
			status: "downloading",
			transferredBytes: 0,
			totalBytes: 8192,
			percentage: 0,
		};
		const startDownload = vi.fn(async () => q8Download);
		const { baseElement } = renderSettings({
			"catalog.list": async () => ({ models: [catalogModel], total: 1 }),
			"catalog.downloads.list": async () => [q4Download],
			"catalog.download.start": startDownload,
			"hardware.profile": async () => hardwareProfile,
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Add model" }).click();
		await page.getByRole("menuitem", { name: "From catalog" }).click();
		const dialog = page.getByRole("dialog", { name: "Local Model Catalog" });
		await dialog.getByRole("row", { name: /Catalog Model/ }).click();
		const quantization = dialog.getByRole("combobox", { name: "Quantization" });
		await quantization.click();
		await page.getByRole("option", { name: "Q8_0, 8 GB" }).click();
		await dialog.getByRole("button", { name: "Add model" }).click();

		await expect
			.poll(() => startDownload)
			.toHaveBeenCalledWith({
				modelId: "catalog-model",
				quantizationId: "catalog-model-q8",
			});
		await expect
			.element(dialog.getByRole("button", { name: "Cancel download at 0%" }))
			.toBeVisible();
		await quantization.click();
		await page.getByRole("option", { name: "Q4_K_M, 4 GB" }).click();
		await expect
			.element(dialog.getByRole("button", { name: "Cancel download at 25%" }))
			.toBeVisible();
	});

	it("shows a sanitized download failure and retries from zero", async () => {
		const failedDownload: ModelDownload = {
			modelId: "catalog-model",
			quantizationId: "catalog-model-q4",
			status: "failed",
			transferredBytes: 1024,
			totalBytes: 4096,
			percentage: 25,
			error: "The model file could not be downloaded.",
		};
		const startDownload = vi.fn(async () => ({
			...failedDownload,
			status: "downloading" as const,
			transferredBytes: 0,
			percentage: 0,
			error: undefined,
		}));
		const { baseElement } = renderSettings({
			"catalog.list": async () => ({ models: [catalogModel], total: 1 }),
			"catalog.downloads.list": async () => [failedDownload],
			"catalog.download.start": startDownload,
			"hardware.profile": async () => hardwareProfile,
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "Add model" }).click();
		await page.getByRole("menuitem", { name: "From catalog" }).click();
		const dialog = page.getByRole("dialog", { name: "Local Model Catalog" });
		await dialog.getByRole("row", { name: /Catalog Model/ }).click();
		await expect.element(dialog.getByText("The model file could not be downloaded.")).toBeVisible();
		await dialog.getByRole("button", { name: "Retry" }).click();

		await expect.poll(() => startDownload).toHaveBeenCalledOnce();
		await expect.element(dialog.getByText("Downloading 0%", { exact: true })).toBeVisible();
		await expect
			.element(dialog.getByRole("button", { name: "Cancel download at 0%" }))
			.toBeEnabled();
	});

	it("starts a disconnected server", async () => {
		const connect = vi.fn(async () => ({ ok: true as const }));
		const { baseElement } = renderSettings({
			"status.get": async () => ({ status: "disconnected" }),
			"usage.get": async () => usageSnapshot,
			"runtime.connect": connect,
		});
		const screen = page.elementLocator(baseElement);
		const toggle = screen.getByRole("switch", { name: "Model server" });

		await expect.element(toggle).toBeEnabled();
		await expect.element(toggle).toHaveAttribute("aria-checked", "false");
		await toggle.click();
		await expect.poll(() => connect).toHaveBeenCalledOnce();
	});

	it("shows when llama.cpp is being installed while the server starts", async () => {
		let currentStatus: LocalInferenceStatus = { status: "disconnected" };
		let resolveConnect: ((result: { ok: true }) => void) | undefined;
		const connect = vi.fn(
			() =>
				new Promise<{ ok: true }>((resolve) => {
					resolveConnect = resolve;
				}),
		);
		const { baseElement, sdk } = renderSettings({
			"status.get": async () => currentStatus,
			"usage.get": async () => usageSnapshot,
			"runtime.connect": connect,
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("switch", { name: "Model server" }).click();
		await expect.poll(() => connect).toHaveBeenCalledOnce();

		currentStatus = { status: "preparing-runtime" };
		sdk.events.emit("status-changed", currentStatus);

		await expect.element(screen.getByText("Installing llama.cpp…", { exact: true })).toBeVisible();
		resolveConnect?.({ ok: true });
	});

	it("stops an active server", async () => {
		const disconnect = vi.fn(async () => ({ ok: true as const }));
		const { baseElement } = renderSettings({
			"status.get": async () => ({ status: "ready" }),
			"usage.get": async () => usageSnapshot,
			"runtime.disconnect": disconnect,
		});
		const screen = page.elementLocator(baseElement);
		const toggle = screen.getByRole("switch", { name: "Model server" });

		await expect.element(toggle).toBeEnabled();
		await expect.element(toggle).toHaveAttribute("aria-checked", "true");
		await toggle.click();
		await expect.poll(() => disconnect).toHaveBeenCalledOnce();
	});

	it("refreshes the displayed status when the service emits a change", async () => {
		let currentStatus: LocalInferenceStatus = { status: "starting" };
		const statusGet = vi.fn(async () => currentStatus);
		const { baseElement, sdk } = renderSettings({
			"status.get": statusGet,
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Starting…", { exact: true })).toBeVisible();
		currentStatus = { status: "ready", loadedModelIds: [] };
		sdk.events.emit("status-changed", currentStatus);

		await expect.element(screen.getByText("Running", { exact: true })).toBeVisible();
		await expect.poll(() => statusGet.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it("shows service errors and retries startup", async () => {
		const retry = vi.fn(async () => ({ ok: true as const }));
		const { baseElement } = renderSettings({
			"status.get": async () => ({ status: "error", message: "Runtime failed to start" }),
			"usage.get": async () => usageSnapshot,
			"runtime.retry": retry,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("Error", { exact: true })).toBeVisible();
		await expect
			.element(screen.getByRole("alert").getByText("Runtime failed to start", { exact: true }))
			.toBeVisible();
		await screen.getByRole("button", { name: "Retry" }).click();
		await expect.poll(() => retry).toHaveBeenCalledOnce();
	});

	it("keeps the model list and settings skeletons visible while catalog metadata loads", async () => {
		let resolveCatalog:
			| ((value: { models: ModelCatalogEntry[]; total: number }) => void)
			| undefined;
		const catalogResponse = new Promise<{ models: ModelCatalogEntry[]; total: number }>(
			(resolve) => {
				resolveCatalog = resolve;
			},
		);
		const listCatalog = vi.fn(() => catalogResponse);
		const { baseElement } = renderSettings({
			"models.list": async () => [
				{
					id: "model-alpha",
					name: "Alpha 8B",
					path: "/models/alpha.gguf",
					available: true,
					addedAt: 1,
					catalog: { modelId: "catalog-model", quantizationId: "catalog-model-q4" },
				},
			],
			"catalog.list": listCatalog,
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);

		await expect.poll(() => listCatalog).toHaveBeenCalledOnce();
		await expect.element(screen.getByTestId("local-model-list-skeleton")).toBeVisible();
		await expect.element(screen.getByTestId("local-model-settings-skeleton")).toBeVisible();
		await expect
			.element(screen.getByTestId("local-model-select-model-alpha"))
			.not.toBeInTheDocument();

		resolveCatalog?.({ models: [catalogModel], total: 1 });

		await expect.element(screen.getByTestId("local-model-list-skeleton")).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("local-model-settings-skeleton"))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("local-model-publisher-icon-model-alpha"))
			.toBeVisible();
		await expect.element(screen.getByRole("button", { name: "General" })).toBeVisible();
	});

	it("searches models and filters them by catalog or imported source", async () => {
		const { baseElement } = renderSettings({
			"models.list": async () => [
				{
					id: "catalog-alpha",
					name: "Catalog Alpha",
					path: "/models/catalog-alpha.gguf",
					available: true,
					addedAt: 1,
					catalog: { modelId: "catalog-model", quantizationId: "catalog-model-q4" },
				},
				{
					id: "imported-beta",
					name: "Imported Beta",
					path: "/models/imported-beta.gguf",
					available: true,
					addedAt: 2,
				},
				{
					id: "imported-gamma",
					name: "Imported Gamma",
					path: "/models/imported-gamma.gguf",
					available: true,
					addedAt: 3,
				},
			],
			"catalog.list": async () => ({ models: [catalogModel], total: 1 }),
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);
		const settingsCard = screen.getByTestId("local-model-settings-card");
		const search = screen.getByRole("searchbox", { name: "Search models" });
		const sourceFilter = screen.getByTestId("local-model-source-filter");

		await expect.element(screen.getByTestId("local-model-select-catalog-alpha")).toBeVisible();
		await expect.element(screen.getByTestId("local-model-select-imported-beta")).toBeVisible();
		await search.fill("beta");
		await expect
			.element(screen.getByTestId("local-model-select-catalog-alpha"))
			.not.toBeInTheDocument();
		await expect.element(screen.getByTestId("local-model-select-imported-beta")).toBeVisible();
		await expect.element(settingsCard).toHaveAttribute("data-model-id", "imported-beta");

		await search.fill("");
		await sourceFilter.click();
		await page.getByRole("menuitemradio", { name: "Catalog models" }).click();
		await expect.element(screen.getByTestId("local-model-select-catalog-alpha")).toBeVisible();
		await expect
			.element(screen.getByTestId("local-model-select-imported-beta"))
			.not.toBeInTheDocument();
		await expect.element(settingsCard).toHaveAttribute("data-model-id", "catalog-alpha");
		await expect.element(sourceFilter).toHaveAttribute("aria-expanded", "false");

		await sourceFilter.click();
		const importedModelsFilter = page.getByRole("menuitemradio", { name: "Imported models" });
		await expect.element(importedModelsFilter).toBeVisible();
		await importedModelsFilter.click();
		await expect
			.element(screen.getByTestId("local-model-select-catalog-alpha"))
			.not.toBeInTheDocument();
		await expect.element(screen.getByTestId("local-model-select-imported-beta")).toBeVisible();
		await expect.element(screen.getByTestId("local-model-select-imported-gamma")).toBeVisible();
		await expect.element(settingsCard).toHaveAttribute("data-model-id", "imported-beta");

		await search.fill("missing");
		await expect.element(screen.getByText("No matching models", { exact: true })).toBeVisible();
		await screen.getByRole("button", { name: "Clear filters" }).click();
		await expect.element(screen.getByTestId("local-model-select-catalog-alpha")).toBeVisible();
		await expect.element(screen.getByTestId("local-model-select-imported-beta")).toBeVisible();
	});

	it("selects a model and exposes safe filesystem actions from its menu", async () => {
		const removeModel = vi.fn(async () => ({ ok: true as const }));
		const showItemInFolder = vi.fn(async () => ({ revealed: true }));
		const { baseElement } = renderSettings(
			{
				"models.list": async () => [
					{
						id: "model-alpha",
						name: "Alpha 8B",
						path: "/models/alpha.gguf",
						available: true,
						addedAt: 1,
						catalog: { modelId: "catalog-model", quantizationId: "catalog-model-q4" },
						managedFile: true,
						sizeBytes: 4 * 1024 ** 3,
					},
					{
						id: "model-beta",
						name: "Beta 3B",
						path: "/models/beta.gguf",
						available: true,
						addedAt: 2,
					},
				],
				"status.get": async () => ({
					status: "ready",
					loadedModelIds: ["model-alpha"],
				}),
				"models.remove": removeModel,
				"catalog.list": async () => ({ models: [catalogModel], total: 1 }),
				"usage.get": async () => usageSnapshot,
			},
			{ showItemInFolder },
		);
		const screen = page.elementLocator(baseElement);
		const settingsCard = screen.getByTestId("local-model-settings-card");

		await expect
			.element(screen.getByTestId("local-model-status-model-alpha"))
			.toHaveAttribute("data-status", "loaded");
		await expect
			.element(screen.getByTestId("local-model-status-model-beta"))
			.toHaveAttribute("data-status", "not-loaded");
		await expect
			.element(screen.getByTestId("local-model-publisher-icon-model-alpha"))
			.toBeVisible();
		await expect.element(screen.getByTestId("local-model-file-icon-model-beta")).toBeVisible();
		await expect.element(settingsCard).toHaveAttribute("data-model-id", "model-alpha");

		await screen.getByTestId("local-model-select-model-alpha").hover();
		const catalogPreview = page.getByTestId("local-model-catalog-preview-model-alpha");
		await expect.element(catalogPreview.getByText("Catalog Model", { exact: true })).toBeVisible();
		await expect
			.element(catalogPreview.getByText("A catalog model.", { exact: true }))
			.toBeVisible();
		await expect.element(catalogPreview.getByText("Q4_K_M", { exact: true })).toBeVisible();
		await expect.element(catalogPreview.getByText("4 GB", { exact: true })).toBeVisible();
		await catalogPreview.getByRole("button", { name: "View in catalog" }).click();
		await expect.element(page.getByTestId("model-catalog-detail-catalog-model")).toBeVisible();
		await page
			.getByRole("dialog", { name: "Local Model Catalog" })
			.getByRole("button", {
				name: "Close",
			})
			.click();

		await screen.getByTestId("local-model-title-model-beta").hover();
		const filePreview = page.getByTestId("local-model-file-preview-model-beta");
		await expect.element(filePreview.getByText("Imported GGUF", { exact: true })).toBeVisible();
		await expect
			.element(filePreview.getByTestId("local-model-path-model-beta"))
			.toHaveTextContent("/models/beta.gguf");
		await filePreview.getByRole("button", { name: "Show in Finder" }).click();
		await expect.poll(() => showItemInFolder).toHaveBeenCalledWith("/models/beta.gguf");

		await screen.getByTestId("local-model-select-model-beta").click();

		await expect.element(settingsCard).toHaveAttribute("data-model-id", "model-beta");
		await expect
			.element(screen.getByTestId("local-model-select-model-beta"))
			.toHaveAttribute("aria-pressed", "true");
		await expect.element(filePreview).not.toBeInTheDocument();
		await screen.getByTestId("local-model-search").hover();
		await screen.getByTestId("local-model-select-model-beta").hover();
		await expect.element(filePreview).toBeVisible();
		await screen.getByTestId("local-model-search").hover();
		await expect.element(filePreview).not.toBeInTheDocument();
		const betaActions = screen.getByRole("button", { name: "More actions for Beta 3B" });
		await betaActions.click();
		await page.getByRole("menuitem", { name: "Show in Finder" }).click();
		await expect.poll(() => showItemInFolder).toHaveBeenCalledWith("/models/beta.gguf");

		await betaActions.click();
		await page.getByRole("menuitem", { name: "Remove from model server" }).click();
		await expect
			.poll(() => removeModel)
			.toHaveBeenCalledWith({ id: "model-beta", mode: "registry-only" });

		await screen.getByRole("button", { name: "More actions for Alpha 8B" }).click();
		await page.getByRole("menuitem", { name: "Delete downloaded model" }).click();
		const deleteDialog = page.getByRole("alertdialog", { name: "Delete downloaded model?" });
		await expect.element(deleteDialog.getByText(/Alpha 8B \(4 GB\)/)).toBeVisible();
		await deleteDialog.getByRole("button", { name: "Delete file" }).click();
		await expect
			.poll(() => removeModel)
			.toHaveBeenCalledWith({ id: "model-alpha", mode: "delete-managed-file" });
	});

	it("keeps the deletion dialog open and shows model deletion failures", async () => {
		const removeModel = vi.fn(async () => {
			throw new Error("The model file is busy.");
		});
		const { baseElement } = renderSettings({
			"models.list": async () => [
				{
					id: "model-alpha",
					name: "Alpha 8B",
					path: "/models/alpha.gguf",
					available: true,
					addedAt: 1,
					managedFile: true,
					sizeBytes: 4 * 1024 ** 3,
				},
			],
			"models.remove": removeModel,
			"status.get": async () => ({ status: "ready", loadedModelIds: [] }),
			"usage.get": async () => usageSnapshot,
		});
		const screen = page.elementLocator(baseElement);

		await screen.getByRole("button", { name: "More actions for Alpha 8B" }).click();
		await page.getByRole("menuitem", { name: "Delete downloaded model" }).click();
		const dialog = page.getByRole("alertdialog", { name: "Delete downloaded model?" });
		await dialog.getByRole("button", { name: "Delete file" }).click();

		await expect.element(dialog.getByText("The model file is busy.")).toBeVisible();
		await expect.element(dialog).toBeVisible();
	});
});
