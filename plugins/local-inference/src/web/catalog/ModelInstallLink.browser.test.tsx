import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	KernelError,
	KernelFlagSource,
	type FlagValue,
	type KernelLogger,
} from "@kilo-desktop/kernel";
import { testPlugin } from "@kilo-desktop/kernel/testing";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";
import { toast } from "@kilo-desktop/ui/components/sonner";

import {
	MODEL_CATALOG_FLAG,
	type LocalInferenceHardwareProfile,
	type ModelCatalogEntry,
	type ModelDownload,
} from "../../contracts/index";
import {
	ANACONDA_CATALOG,
	bootLocalInferenceHost,
	usageSnapshot,
	type LocalInferenceHostOptions,
} from "../../test/local-inference-host";
import { LocalModelServerSettings } from "../settings/LocalModelServerSettings";

const MODEL_UUID = "550e8400-e29b-41d4-a716-446655440000";
const Q8_FILE_UUID = "660e8400-e29b-41d4-a716-446655440001";
const Q4_FILE_UUID = "660e8400-e29b-41d4-a716-446655440002";
const OTHER_MODEL_UUID = "770e8400-e29b-41d4-a716-446655440003";

const catalogModel: ModelCatalogEntry = {
	id: MODEL_UUID,
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
			id: Q8_FILE_UUID,
			method: "Q8_0",
			sizeBytes: 8 * 1024 ** 3,
			sha256: "8".repeat(64),
		},
		{
			id: Q4_FILE_UUID,
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

const otherCatalogModel: ModelCatalogEntry = {
	...catalogModel,
	id: OTHER_MODEL_UUID,
	name: "Other Model",
	quantizations: [
		{
			id: "other-q8",
			method: "Q8_0",
			sizeBytes: 8 * 1024 ** 3,
			sha256: "9".repeat(64),
		},
		{
			id: "other-q4",
			method: "Q4_K_M",
			sizeBytes: 4 * 1024 ** 3,
			sha256: "5".repeat(64),
		},
	],
};

const hardwareProfile: LocalInferenceHardwareProfile = {
	name: "Apple M4 Pro",
	kind: "unified-memory",
	accelerator: "metal",
	memoryTotalBytes: 24 * 1024 ** 3,
	systemMemoryTotalBytes: 24 * 1024 ** 3,
	memoryBandwidthGBps: 273,
};

function installSearch(search: Record<string, string>) {
	return {
		modelAction: "install",
		source: "dot-org",
		...search,
	};
}

async function renderModelLink(options: {
	readonly search: Record<string, string>;
	readonly handlers?: LocalInferenceHostOptions["handlers"];
	readonly flags?: LocalInferenceHostOptions["flags"];
	readonly plugins?: LocalInferenceHostOptions["plugins"];
	readonly initialState?: LocalInferenceHostOptions["initialState"];
	readonly logger?: KernelLogger;
}) {
	const host = await bootLocalInferenceHost({
		search: options.search,
		...(options.flags ? { flags: options.flags } : {}),
		...(options.plugins ? { plugins: options.plugins } : {}),
		...(options.initialState ? { initialState: options.initialState } : {}),
		...(options.logger ? { logger: options.logger } : {}),
		handlers: {
			listCatalog: async () => ({ models: [catalogModel, otherCatalogModel], total: 2 }),
			hardwareProfile: async () => hardwareProfile,
			status: async () => ({ status: "ready", loadedModelIds: [] }),
			usage: async () => usageSnapshot,
			...options.handlers,
		},
	});
	const view = host.render(<LocalModelServerSettings />);
	return { ...view, host };
}

afterEach(() => {
	toast.dismiss();
	cleanup();
});

describe("kilo-desktop://models/install deep links", () => {
	it("opens the catalog on the requested model and file, clears the route, and downloads that file", async () => {
		const startDownload = vi.fn(
			async (identity: { modelId: string; quantizationId: string }): Promise<ModelDownload> => ({
				...identity,
				status: "downloading",
				transferredBytes: 0,
				totalBytes: 8 * 1024 ** 3,
				percentage: 0,
			}),
		);
		const { host } = await renderModelLink({
			search: installSearch({ model: MODEL_UUID, file: Q8_FILE_UUID }),
			handlers: { startDownload },
		});

		const dialog = page.getByTestId("local-model-catalog-dialog");
		await expect.element(dialog).toBeVisible();
		await expect.element(dialog.getByTestId(`model-catalog-detail-${MODEL_UUID}`)).toBeVisible();

		// Q8_0 proves the requested file beat the hardware-recommended Q4_K_M quantization.
		const quantization = dialog.getByRole("combobox", { name: "Quantization" });
		await expect.element(quantization.getByText("Q8_0")).toBeVisible();
		await expect.element(quantization.getByText("8 GB", { exact: true })).toBeVisible();

		await dialog.getByTestId("model-catalog-download").click();
		await expect
			.poll(() => startDownload)
			.toHaveBeenCalledWith({ modelId: MODEL_UUID, quantizationId: Q8_FILE_UUID });

		expect(host.navigations).toEqual([{ path: "/settings/local-model-server", search: {} }]);
		await expect
			.poll(() => host.tracked)
			.toEqual([
				{
					event: "Model Install Link Received",
					data: { hasFile: true, source: "dot-org" },
				},
			]);
		expect(JSON.stringify(host.tracked)).not.toContain(MODEL_UUID);
		expect(JSON.stringify(host.tracked)).not.toContain(Q8_FILE_UUID);
	});

	it("selects the hardware-recommended quantization when the link omits file", async () => {
		const { host } = await renderModelLink({
			search: installSearch({ model: MODEL_UUID }),
		});

		const dialog = page.getByTestId("local-model-catalog-dialog");
		await expect.element(dialog.getByTestId(`model-catalog-detail-${MODEL_UUID}`)).toBeVisible();
		const quantization = dialog.getByRole("combobox", { name: "Quantization" });
		await expect.element(quantization.getByText("Q4_K_M")).toBeVisible();
		await expect.element(quantization.getByText("4 GB", { exact: true })).toBeVisible();

		await expect
			.poll(() => host.tracked)
			.toEqual([
				{
					event: "Model Install Link Received",
					data: { hasFile: false, source: "dot-org" },
				},
			]);
	});

	it("shows the detail skeleton while the catalog loads and hands over to the detail pane", async () => {
		let resolveCatalog!: (value: { models: ModelCatalogEntry[]; total: number }) => void;
		const catalogResponse = new Promise<{ models: ModelCatalogEntry[]; total: number }>(
			(resolve) => {
				resolveCatalog = resolve;
			},
		);
		await renderModelLink({
			search: installSearch({ model: MODEL_UUID, file: Q8_FILE_UUID }),
			handlers: { listCatalog: () => catalogResponse },
		});

		const dialog = page.getByTestId("local-model-catalog-dialog");
		await expect.element(dialog.getByTestId("model-catalog-detail-loading")).toBeVisible();

		resolveCatalog({ models: [catalogModel], total: 1 });

		await expect
			.element(dialog.getByTestId("model-catalog-detail-loading"))
			.not.toBeInTheDocument();
		await expect.element(dialog.getByTestId(`model-catalog-detail-${MODEL_UUID}`)).toBeVisible();
		await expect
			.element(dialog.getByRole("combobox", { name: "Quantization" }).getByText("Q8_0"))
			.toBeVisible();
	});

	it("keeps the request alive across catalog sign-in and selects model and file afterwards", async () => {
		let signedIn = false;
		const { host } = await renderModelLink({
			search: installSearch({ model: MODEL_UUID, file: Q8_FILE_UUID }),
			initialState: { catalog: { title: "Anaconda", access: { status: "signed-out" } } },
			handlers: {
				listCatalog: async () => {
					if (!signedIn) {
						throw new KernelError(
							"BUSINESS",
							"Sign in to your Anaconda account to view the model catalog.",
						);
					}
					return { models: [catalogModel], total: 1 };
				},
			},
		});

		const dialog = page.getByTestId("local-model-catalog-dialog");
		await expect.element(dialog.getByTestId("model-catalog-sign-in")).toBeVisible();
		await expect
			.element(dialog.getByTestId("model-catalog-detail-loading"))
			.not.toBeInTheDocument();

		signedIn = true;
		await host.setCatalog(ANACONDA_CATALOG);

		await expect.element(dialog.getByTestId(`model-catalog-detail-${MODEL_UUID}`)).toBeVisible();
		await expect
			.element(dialog.getByRole("combobox", { name: "Quantization" }).getByText("Q8_0"))
			.toBeVisible();
	});

	it("updates the selected quantization when a second link targets the same model with another file", async () => {
		const { host } = await renderModelLink({
			search: installSearch({ model: MODEL_UUID, file: Q8_FILE_UUID }),
		});

		const dialog = page.getByTestId("local-model-catalog-dialog");
		const quantization = dialog.getByRole("combobox", { name: "Quantization" });
		await expect.element(quantization.getByText("Q8_0")).toBeVisible();

		await host.main.kernelSdk.domainObjects.get(Navigation)!.methods.navigate({
			path: "/settings/local-model-server",
			search: installSearch({ model: MODEL_UUID, file: Q4_FILE_UUID }),
		});

		await expect.element(quantization.getByText("Q4_K_M")).toBeVisible();

		// Manual selection still works after deep-link pre-selection.
		await quantization.click();
		await page.getByRole("option", { name: "Q8_0, 8 GB" }).click();
		await expect.element(quantization.getByText("Q8_0")).toBeVisible();

		// Clicking another model clears the deep-link override and uses its default quantization.
		await dialog.getByRole("row", { name: /Other Model/ }).click();
		await expect
			.element(dialog.getByTestId(`model-catalog-detail-${OTHER_MODEL_UUID}`))
			.toBeVisible();
		await expect.element(quantization.getByText("Q4_K_M")).toBeVisible();
	});

	it("shows a toast and leaves the catalog open for browsing when the model is not found", async () => {
		await renderModelLink({
			search: installSearch({ model: "unknown-model-id" }),
		});

		const dialog = page.getByTestId("local-model-catalog-dialog");
		await expect.element(dialog.getByTestId("model-catalog-table")).toBeVisible();
		await expect
			.element(dialog.getByRole("region", { name: "Model details" }))
			.not.toBeInTheDocument();
		await expect.element(page.getByText("This model was not found in the catalog.")).toBeVisible();
	});

	it("opens the model on its default quantization and shows a toast when the file is unavailable", async () => {
		await renderModelLink({
			search: installSearch({ model: MODEL_UUID, file: "unavailable-file-id" }),
		});

		const dialog = page.getByTestId("local-model-catalog-dialog");
		await expect.element(dialog.getByTestId(`model-catalog-detail-${MODEL_UUID}`)).toBeVisible();
		await expect
			.element(dialog.getByRole("combobox", { name: "Quantization" }).getByText("Q4_K_M"))
			.toBeVisible();
		await expect
			.element(page.getByText("The selected model file is not available for local download."))
			.toBeVisible();
	});

	it("reports unavailability and does not open the catalog when the catalog flag is off", async () => {
		const { host } = await renderModelLink({
			search: installSearch({ model: MODEL_UUID, file: Q8_FILE_UUID }),
			flags: { "local-model-catalog": false },
		});

		await expect.element(page.getByText("The model catalog is not available.")).toBeVisible();
		expect(page.getByTestId("local-model-catalog-dialog").elements()).toHaveLength(0);
		expect(host.navigations).toEqual([{ path: "/settings/local-model-server", search: {} }]);
		await expect
			.poll(() => host.tracked)
			.toEqual([
				{
					event: "Model Install Link Received",
					data: { hasFile: true, source: "dot-org" },
				},
			]);
	});

	it("shows an error toast and tracks a rejection when the link is missing model", async () => {
		const { host } = await renderModelLink({
			search: installSearch({}),
		});

		await expect.element(page.getByText("This model link is invalid.")).toBeVisible();
		expect(page.getByTestId("local-model-catalog-dialog").elements()).toHaveLength(0);
		expect(host.navigations).toEqual([{ path: "/settings/local-model-server", search: {} }]);
		await expect
			.poll(() => host.tracked)
			.toEqual([
				{
					event: "Model Install Link Rejected",
					data: { reason: "missing-model", source: "dot-org" },
				},
			]);
	});

	it("shows an error toast and tracks a rejection when the link has an invalid file", async () => {
		const { host } = await renderModelLink({
			search: installSearch({ model: MODEL_UUID, file: "../escape.gguf" }),
		});

		await expect.element(page.getByText("This model link is invalid.")).toBeVisible();
		expect(page.getByTestId("local-model-catalog-dialog").elements()).toHaveLength(0);
		expect(host.navigations).toEqual([{ path: "/settings/local-model-server", search: {} }]);
		await expect
			.poll(() => host.tracked)
			.toEqual([
				{
					event: "Model Install Link Rejected",
					data: { reason: "invalid-file", source: "dot-org" },
				},
			]);
		expect(JSON.stringify(host.tracked)).not.toContain(MODEL_UUID);
		expect(JSON.stringify(host.tracked)).not.toContain("../escape.gguf");
	});

	it("only logs a warning and tracks a rejection for an unsupported action", async () => {
		const warn = vi.fn();
		const logger: KernelLogger = { debug: () => {}, info: () => {}, warn, error: () => {} };
		const { host } = await renderModelLink({
			search: { modelAction: "run", model: MODEL_UUID, source: "unknown-site" },
			logger,
		});

		await expect
			.poll(() => warn)
			.toHaveBeenCalledWith(expect.stringContaining('unsupported action "run"'));
		expect(page.getByText("This model link is invalid.").elements()).toHaveLength(0);
		expect(page.getByTestId("local-model-catalog-dialog").elements()).toHaveLength(0);
		expect(host.navigations).toEqual([{ path: "/settings/local-model-server", search: {} }]);
		await expect
			.poll(() => host.tracked)
			.toEqual([
				{
					event: "Model Install Link Rejected",
					data: { reason: "unsupported-action", source: "other" },
				},
			]);
		expect(JSON.stringify(host.tracked)).not.toContain(MODEL_UUID);
	});

	it("waits until KernelFlags is ready before rejecting or consuming a cold-start link", async () => {
		let resolvedValues: Readonly<Record<string, FlagValue>> | null = null;
		const listeners = new Set<() => void>();
		const flagSource = testPlugin("test.flag-source", {
			manifest: { contributes: { extensions: { "kernel/flag-source": [{ id: "remote" }] } } },
			entry: {
				activate(sdk) {
					sdk.extensions.implement(KernelFlagSource, "remote", {
						values: () => resolvedValues,
						subscribe: (listener) => {
							listeners.add(listener);
							return () => listeners.delete(listener);
						},
						identify: () => undefined,
					});
				},
			},
		});

		const { host } = await renderModelLink({
			search: installSearch({ model: MODEL_UUID, file: Q8_FILE_UUID }),
			flags: { [MODEL_CATALOG_FLAG]: undefined },
			plugins: [flagSource],
		});

		await expect.element(page.getByTestId("local-model-server-page")).toBeVisible();
		expect(page.getByText("The model catalog is not available.").elements()).toHaveLength(0);
		expect(page.getByTestId("local-model-catalog-dialog").elements()).toHaveLength(0);
		expect(host.navigations).toEqual([]);
		expect(host.tracked).toEqual([]);

		resolvedValues = { [MODEL_CATALOG_FLAG]: true };
		for (const listener of listeners) listener();

		const dialog = page.getByTestId("local-model-catalog-dialog");
		await expect.element(dialog).toBeVisible();
		await expect.element(dialog.getByTestId(`model-catalog-detail-${MODEL_UUID}`)).toBeVisible();
		await expect
			.element(dialog.getByRole("combobox", { name: "Quantization" }).getByText("Q8_0"))
			.toBeVisible();
		expect(host.navigations).toEqual([{ path: "/settings/local-model-server", search: {} }]);
	});
});
