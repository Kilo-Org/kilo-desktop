import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import {
	localInferenceContract,
	type LocalInferenceHardwareProfile,
	type ModelCatalogCapabilities,
	type ModelCatalogEntry,
} from "../contracts/schemas.js";
import { LocalModelCatalog } from "./LocalModelCatalogSettings.js";

afterEach(cleanup);

const TEST_SHA256 = "0".repeat(64);

const supportedCapabilities: ModelCatalogCapabilities = {
	chat: true,
	embedding: true,
	vision: true,
	toolCalling: true,
};

const recommendedCatalogModel: ModelCatalogEntry = {
	id: "qwen-3.8",
	name: "Qwen3.8-27B",
	description: "",
	numParameters: 27_000_000_000,
	modelType: "Text Generation",
	publisher: "Qwen",
	libraryName: "transformers",
	license: "apache-2.0",
	contextWindowSize: 262_144,
	publishedAt: "2026-08-01T00:00:00Z",
	tags: ["chat", "reasoning"],
	quantizations: [
		{
			id: "qwen-3.8-q4",
			method: "Q4_K_M",
			sizeBytes: 20 * 1024 ** 3,
			sha256: TEST_SHA256,
		},
	],
	capabilities: { chat: true, embedding: false, vision: false, toolCalling: true },
};

function renderCatalog(
	capabilities: ModelCatalogCapabilities | undefined,
	memoryTotalBytes = 24 * 1024 ** 3,
	extraModels: ModelCatalogEntry[] = [],
	onSelectModel: (model: ModelCatalogEntry) => void = () => undefined,
	containerWidth = "60rem",
) {
	const sdk = createFakeSdk({
		featureId: "local-inference",
		channels: localInferenceContract,
		handlers: {
			"catalog.list": async () => ({
				models: [
					...extraModels,
					{
						id: "48d448b0-2634-4c32-b3fe-56a26483c904",
						name: "Llama 3.1 8B Instruct",
						description: "A compact instruction-tuned language model.",
						numParameters: 8_000_000_000,
						modelType: "Text Generation",
						publisher: "meta-models",
						libraryName: "transformers",
						license: "llama3.1",
						contextWindowSize: 131_072,
						publishedAt: "2024-07-23T00:00:00Z",
						tags: ["chat", "code-generation", "size-small"],
						quantizations: [
							{
								id: "llama-q4",
								method: "Q4_K_M",
								sizeBytes: 4 * 1024 ** 3,
								sha256: TEST_SHA256,
							},
						],
						capabilities: capabilities as ModelCatalogCapabilities,
					},
				],
				total: extraModels.length + 1,
			}),
			"hardware.profile": async (): Promise<LocalInferenceHardwareProfile> => ({
				name: "Apple M4 Pro",
				kind: "unified-memory",
				accelerator: "metal",
				memoryTotalBytes,
				systemMemoryTotalBytes: memoryTotalBytes,
				memoryBandwidthGBps: 273,
			}),
		},
	});
	const system = createFakeFeatureSystem({ sdks: { "local-inference": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<div style={{ width: containerWidth }}>
					<LocalModelCatalog onSelectModel={onSelectModel} />
				</div>
			</QueryClientProvider>
		</SdkProvider>,
	);
}

describe("LocalModelCatalog", () => {
	it("shows catalog models in a table", async () => {
		const { baseElement } = renderCatalog(supportedCapabilities);
		const screen = page.elementLocator(baseElement);
		const table = screen.getByTestId("model-catalog-table");

		await expect.element(table).toBeVisible();
		await expect
			.element(screen.getByTestId("model-catalog-sort").getByText("Newest", { exact: true }))
			.toBeVisible();
		expect([...baseElement.querySelectorAll("th")].map((header) => header.innerText)).toEqual([
			"Model",
			"Capabilities",
			"Estimated performance",
		]);
		await expect.element(screen.getByText("Recommended Models")).toBeVisible();
		await expect.element(screen.getByText("Chat & coding")).toBeVisible();
		await expect.element(screen.getByText("Lightweight models")).toBeVisible();
		await expect.element(table.getByText("Runs Great", { exact: true })).toBeVisible();
		await expect.element(table.getByText("~31–47", { exact: true })).toBeVisible();
		await expect.element(table.getByText("tokens/sec", { exact: true })).toBeVisible();
		await expect.element(table.getByText("Llama 3.1 8B Instruct")).toBeVisible();
		await expect.element(screen.getByTestId("model-publisher")).toHaveTextContent("Meta");
		expect(baseElement.querySelector('[data-slot="publisher-icon"] svg')).not.toBeNull();
		await expect
			.element(
				screen.getByTestId("model-catalog-capability-chat-48d448b0-2634-4c32-b3fe-56a26483c904"),
			)
			.toHaveAttribute("aria-label", "Chat");
		await expect
			.element(
				screen.getByTestId("model-catalog-capability-vision-48d448b0-2634-4c32-b3fe-56a26483c904"),
			)
			.toHaveAttribute("aria-label", "Vision");
		await expect
			.element(
				screen.getByTestId(
					"model-catalog-capability-toolCalling-48d448b0-2634-4c32-b3fe-56a26483c904",
				),
			)
			.toHaveAttribute("aria-label", "Tool Calling");
		await expect
			.element(
				screen.getByTestId(
					"model-catalog-capability-embedding-48d448b0-2634-4c32-b3fe-56a26483c904",
				),
			)
			.toHaveAttribute("aria-label", "Embedding");

		const capabilities = screen.getByTestId(
			"model-catalog-capabilities-48d448b0-2634-4c32-b3fe-56a26483c904",
		);
		await expect
			.element(capabilities)
			.toHaveAttribute(
				"aria-label",
				"Model type: Text Generation. Capabilities: Chat, Tool Calling, Vision, Embedding.",
			);
		await capabilities.hover();
		await expect
			.element(
				page.getByTestId("model-catalog-tooltip-model-type-48d448b0-2634-4c32-b3fe-56a26483c904"),
			)
			.toHaveTextContent("Text Generation");
		await expect
			.element(
				page.getByTestId(
					"model-catalog-tooltip-capability-chat-48d448b0-2634-4c32-b3fe-56a26483c904",
				),
			)
			.toHaveTextContent("Chat");
		await expect
			.element(
				page.getByTestId(
					"model-catalog-tooltip-capability-toolCalling-48d448b0-2634-4c32-b3fe-56a26483c904",
				),
			)
			.toHaveTextContent("Tool Calling");
		await expect
			.element(
				page.getByTestId(
					"model-catalog-tooltip-capability-vision-48d448b0-2634-4c32-b3fe-56a26483c904",
				),
			)
			.toHaveTextContent("Vision");
		await expect
			.element(
				page.getByTestId(
					"model-catalog-tooltip-capability-embedding-48d448b0-2634-4c32-b3fe-56a26483c904",
				),
			)
			.toHaveTextContent("Embedding");
		expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).not.toContain(
			"Model Type",
		);
		expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).not.toContain(
			"Capabilities",
		);
		expect(
			document.querySelectorAll('[data-qa-id^="model-catalog-tooltip-capability-"] svg'),
		).toHaveLength(4);
		await screen.getByText("Chat & coding").hover();
		await expect
			.poll(() => document.querySelector('[data-slot="tooltip-content"][data-open]'))
			.toBeNull();
	});

	it("searches the catalog without hiding recommendations", async () => {
		const { baseElement } = renderCatalog(supportedCapabilities, 32 * 1024 ** 3, [
			recommendedCatalogModel,
		]);
		const screen = page.elementLocator(baseElement);
		const search = screen.getByRole("searchbox", { name: "Search model catalog" });

		await expect.element(search).toBeVisible();
		await search.fill("Qwen 27B");

		await expect.element(screen.getByText("Search results", { exact: true })).toBeVisible();
		await expect
			.element(screen.getByTestId("model-catalog-table").getByText("Qwen3.8-27B", { exact: true }))
			.toBeVisible();
		await expect
			.element(screen.getByText("Llama 3.1 8B Instruct", { exact: true }))
			.not.toBeInTheDocument();
		await expect.element(screen.getByText("Recommended Models", { exact: true })).toBeVisible();

		await search.fill("unknown publisher");
		await expect.element(screen.getByText("No matching models", { exact: true })).toBeVisible();
		await screen.getByRole("button", { name: "Clear search" }).click();

		await expect.element(search).toHaveValue("");
		await expect.element(screen.getByText("Recommended Models", { exact: true })).toBeVisible();
		await expect.element(screen.getByText("All models", { exact: true })).toBeVisible();
	});

	it("uses two columns when the catalog pane is narrow", async () => {
		const { baseElement } = renderCatalog(
			supportedCapabilities,
			32 * 1024 ** 3,
			[recommendedCatalogModel],
			() => undefined,
			"30rem",
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("columnheader", { name: "Performance" })).toBeVisible();
		const capabilitiesHeader = baseElement.querySelectorAll("th")[1];
		expect(capabilitiesHeader).toBeInstanceOf(HTMLElement);
		expect(getComputedStyle(capabilitiesHeader as HTMLElement).display).toBe("none");
		const recommendationPerformance = baseElement.querySelector(
			'[data-qa-id="recommended-model-qwen-3.8"] [data-slot="model-performance"]',
		);
		expect(recommendationPerformance).toBeInstanceOf(HTMLElement);
		expect(getComputedStyle(recommendationPerformance as HTMLElement).flexDirection).toBe("column");
	});

	it("selects a recommended model for its detail view", async () => {
		const onSelectModel = vi.fn();
		const { baseElement } = renderCatalog(
			supportedCapabilities,
			32 * 1024 ** 3,
			[recommendedCatalogModel],
			onSelectModel,
		);
		const recommendation = page
			.elementLocator(baseElement)
			.getByTestId("recommended-model-qwen-3.8");

		await recommendation.click();

		expect(onSelectModel).toHaveBeenCalledWith(expect.objectContaining({ id: "qwen-3.8" }));
	});

	it("handles catalog rows created before capabilities were added", async () => {
		const { baseElement } = renderCatalog(undefined);
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("model-catalog-table").getByText("Llama 3.1 8B Instruct"))
			.toBeVisible();
		expect(baseElement.querySelector('[data-qa-id^="model-catalog-capabilities-"]')).toBeNull();
	});

	it("shows initials when a catalog publisher has no known logo", async () => {
		const exampleLabs: ModelCatalogEntry = {
			id: "example-labs-model",
			name: "Example Model",
			description: "",
			numParameters: 1_000_000_000,
			modelType: "Text Generation",
			publisher: "Example Labs",
			libraryName: "transformers",
			license: "apache-2.0",
			contextWindowSize: 8_192,
			publishedAt: "2026-01-01T00:00:00Z",
			tags: [],
			quantizations: [],
			capabilities: supportedCapabilities,
		};
		const acmeModel: ModelCatalogEntry = {
			...exampleLabs,
			id: "acme-model",
			name: "Acme Model",
			publisher: "Acme",
		};
		const { baseElement } = renderCatalog(supportedCapabilities, 24 * 1024 ** 3, [
			exampleLabs,
			acmeModel,
		]);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("EL", { exact: true })).toBeVisible();
		await expect.element(screen.getByText("AC", { exact: true })).toBeVisible();
	});

	it("reports models that exceed available memory", async () => {
		const { baseElement } = renderCatalog(supportedCapabilities, 1024 ** 3);
		const fitLabel = page.elementLocator(baseElement).getByText("Doesn’t Fit", { exact: true });

		await expect.element(fitLabel).toBeVisible();
	});

	it("defaults to newest and offers a fastest sort", async () => {
		const legacyModel: ModelCatalogEntry = {
			id: "legacy-model",
			name: "gpt2",
			description: "",
			numParameters: 1_500_000_000,
			modelType: "Text Generation",
			publisher: "OpenAI",
			libraryName: "transformers",
			license: "mit",
			contextWindowSize: 1_024,
			publishedAt: "2019-02-01T00:00:00Z",
			tags: [],
			quantizations: [
				{
					id: "legacy-q4",
					method: "Q4_K_M",
					sizeBytes: 1024 ** 3,
					sha256: TEST_SHA256,
				},
			],
			capabilities: {
				chat: true,
				embedding: false,
				vision: false,
				toolCalling: false,
			},
		};
		const { baseElement } = renderCatalog(
			{ ...supportedCapabilities, embedding: false },
			24 * 1024 ** 3,
			[legacyModel],
		);
		const screen = page.elementLocator(baseElement);
		const table = screen.getByTestId("model-catalog-table");

		await expect.element(table.getByText("Llama 3.1 8B Instruct")).toBeVisible();
		await expect
			.poll(() => baseElement.querySelector("tbody tr")?.textContent)
			.toContain("Llama 3.1 8B Instruct");

		await screen.getByRole("combobox", { name: "Sort models" }).click();
		await page.getByRole("option", { name: "Fastest" }).click();
		await expect.poll(() => baseElement.querySelector("tbody tr")?.textContent).toContain("gpt2");
	});

	it("renders Best Picks in CanIRun editorial order while browse defaults to newest", async () => {
		const qwen35: ModelCatalogEntry = {
			...recommendedCatalogModel,
			id: "qwen-3.5",
			name: "Qwen3.5-9B",
			numParameters: 9_000_000_000,
			contextWindowSize: 32_768,
			publishedAt: "2026-02-01T00:00:00Z",
			quantizations: [
				{
					id: "qwen-3.5-q4",
					method: "Q4_K_M",
					sizeBytes: 2 * 1024 ** 3,
					sha256: TEST_SHA256,
				},
			],
		};
		const { baseElement } = renderCatalog(
			{ ...supportedCapabilities, embedding: false },
			32 * 1024 ** 3,
			[qwen35, recommendedCatalogModel],
		);

		await expect
			.poll(() =>
				baseElement.querySelector('[data-qa-id^="recommended-model-"]')?.getAttribute("data-qa-id"),
			)
			.toBe("recommended-model-qwen-3.8");
		await expect
			.poll(() => baseElement.querySelector("tbody tr")?.textContent)
			.toContain("Qwen3.8-27B");
	});
});
