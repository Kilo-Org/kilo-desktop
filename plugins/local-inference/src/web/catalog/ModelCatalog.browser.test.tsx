import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelError } from "@kilo-desktop/kernel";

import type {
	LocalInferenceHardwareProfile,
	ModelCatalogCapabilities,
	ModelCatalogEntry,
} from "../../contracts/index.js";
import { bootLocalInferenceHost } from "../../test/local-inference-host.js";
import { AnacondaAccountContext } from "./use-anaconda-account.js";
import { LocalModelCatalog } from "./ModelCatalog.js";

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

async function renderCatalog(
	capabilities: ModelCatalogCapabilities | undefined,
	memoryTotalBytes = 24 * 1024 ** 3,
	extraModels: ModelCatalogEntry[] = [],
	onSelectModel: (model: ModelCatalogEntry) => void = () => undefined,
	containerWidth = "60rem",
) {
	const host = await bootLocalInferenceHost({
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
	return host.render(
		<div style={{ width: containerWidth }}>
			<LocalModelCatalog onSelectModel={onSelectModel} />
		</div>,
	);
}

describe("LocalModelCatalog", () => {
	it("shows catalog models in a table", async () => {
		const { baseElement } = await renderCatalog(supportedCapabilities);
		const screen = page.elementLocator(baseElement);
		const table = screen.getByTestId("model-catalog-table");

		await expect.element(table).toBeVisible();
		await expect
			.element(screen.getByTestId("model-catalog-sort"))
			.toHaveAccessibleName("Sort models: Newest");
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
			.toHaveAttribute("aria-label", "Tool calling");
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
				"Model type: Text Generation. Capabilities: Chat, Tool calling, Vision, Embedding.",
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
			.toHaveTextContent("Tool calling");
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
		const { baseElement } = await renderCatalog(supportedCapabilities, 32 * 1024 ** 3, [
			recommendedCatalogModel,
		]);
		const screen = page.elementLocator(baseElement);
		const search = screen.getByRole("searchbox", { name: "Search model catalog" });

		await expect.element(search).toBeVisible();
		await search.fill("Qwen 27B");

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
		await expect
			.element(screen.getByTestId("model-catalog-table").getByText("Llama 3.1 8B Instruct"))
			.toBeVisible();
	});

	it("uses two columns when the catalog pane is narrow", async () => {
		const { baseElement } = await renderCatalog(
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
		const { baseElement } = await renderCatalog(
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
		const { baseElement } = await renderCatalog(undefined);
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
		const { baseElement } = await renderCatalog(supportedCapabilities, 24 * 1024 ** 3, [
			exampleLabs,
			acmeModel,
		]);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("EL", { exact: true })).toBeVisible();
		await expect.element(screen.getByText("AC", { exact: true })).toBeVisible();
	});

	it("reports models that exceed available memory", async () => {
		const { baseElement } = await renderCatalog(supportedCapabilities, 1024 ** 3);
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
		const { baseElement } = await renderCatalog(
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

		await screen.getByRole("button", { name: "Sort models: Newest" }).click();
		await page.getByRole("menuitemradio", { name: "Fastest" }).click();
		await expect.poll(() => baseElement.querySelector("tbody tr")?.textContent).toContain("gpt2");
		await expect
			.element(screen.getByTestId("model-catalog-sort"))
			.toHaveAccessibleName("Sort models: Fastest");
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
		const { baseElement } = await renderCatalog(
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

type AuthSession =
	| { status: "anonymous" }
	| { status: "authenticated"; user: { email?: string } }
	| { status: "error"; reason: string };

describe("LocalModelCatalog Anaconda sign-in", () => {
	async function renderWithoutKey(
		initial: AuthSession = { status: "anonymous" },
		withProvider = true,
		options: { catalogAlwaysFails?: boolean; signInWaitsForBrowser?: boolean } = {},
	) {
		let session = initial;
		// Like the real capability: the cache reads anonymous until the first resolve.
		let cached: AuthSession = { status: "anonymous" };
		const subscribers = new Set<(next: AuthSession) => void>();
		const publish = (next: AuthSession) => {
			cached = next;
			for (const fn of [...subscribers]) fn(next);
		};
		let keyStored = initial.status === "authenticated";
		const login = vi.fn(async (): Promise<AuthSession> => {
			keyStored = true;
			session = { status: "authenticated", user: { email: "dev@anaconda.com" } };
			publish(session);
			return session;
		});
		const signOut = () => {
			keyStored = false;
			session = { status: "anonymous" };
			publish(session);
		};
		const list = vi.fn(async () => {
			if (options.catalogAlwaysFails)
				throw new KernelError("BUSINESS", "No access to the catalog.");
			if (!keyStored) throw new KernelError("BUSINESS", "Sign in to your Anaconda account.");
			return { models: [recommendedCatalogModel], total: 1 };
		});
		let endPendingSignIn: () => void = () => {};
		// Stable identity, as `sdk.plugins.get(...).account` is in production.
		const account = {
			subscribe(fn: (next: AuthSession) => void) {
				subscribers.add(fn);
				fn(cached);
				return () => {
					subscribers.delete(fn);
				};
			},
			peek: () => cached,
			getSession: async () => {
				publish(session);
				return session;
			},
			signIn: async () => {
				if (options.signInWaitsForBrowser) {
					return new Promise<{ ok: false; reason: string; cancelled: true }>((resolve) => {
						endPendingSignIn = () =>
							resolve({ ok: false, reason: "Sign-in was cancelled.", cancelled: true });
					});
				}
				const next = await login();
				return next.status === "authenticated"
					? ({ ok: true } as const)
					: ({ ok: false, reason: "failed" } as const);
			},
			cancelSignIn: vi.fn(async () => endPendingSignIn()),
		};
		const host = await bootLocalInferenceHost({
			handlers: {
				"catalog.list": list,
				"hardware.profile": async (): Promise<LocalInferenceHardwareProfile> => ({
					name: "Apple M4 Pro",
					kind: "unified-memory",
					accelerator: "metal",
					memoryTotalBytes: 24 * 1024 ** 3,
					systemMemoryTotalBytes: 24 * 1024 ** 3,
					memoryBandwidthGBps: 273,
				}),
			},
		});
		const tree = (showCatalog: boolean) =>
			host.wrap(
				<AnacondaAccountContext.Provider value={withProvider ? account : undefined}>
					{showCatalog ? <LocalModelCatalog onSelectModel={() => undefined} /> : null}
				</AnacondaAccountContext.Provider>,
			);
		const view = render(tree(true));
		return {
			screen: page.elementLocator(view.baseElement),
			login,
			list,
			signOut,
			/** Close and reopen the catalog, keeping the shared query cache. */
			setCatalogOpen: (open: boolean) => view.rerender(tree(open)),
			cancelSignIn: account.cancelSignIn,
		};
	}

	it("offers Anaconda sign-in when no key is stored, then loads the catalog", async () => {
		const { screen, login, list } = await renderWithoutKey();

		await expect.element(screen.getByTestId("model-catalog-sign-in")).toBeVisible();
		await screen.getByTestId("model-catalog-sign-in-button").click();

		await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(1));
		await expect.element(screen.getByTestId("model-catalog-table")).toBeVisible();
		expect(list).toHaveBeenCalledTimes(2);
	});

	it("offers Cancel while waiting for the browser and returns to the prompt", async () => {
		const { screen, cancelSignIn } = await renderWithoutKey({ status: "anonymous" }, true, {
			signInWaitsForBrowser: true,
		});

		await screen.getByTestId("model-catalog-sign-in-button").click();
		await expect
			.element(screen.getByTestId("model-catalog-sign-in-button"))
			.toHaveTextContent("Waiting for browser…");
		await screen.getByTestId("model-catalog-cancel-sign-in").click();

		await vi.waitFor(() => expect(cancelSignIn).toHaveBeenCalledTimes(1));
		await expect
			.element(screen.getByTestId("model-catalog-sign-in-button"))
			.toHaveTextContent("Sign in to Anaconda");
		expect(screen.getByTestId("model-catalog-cancel-sign-in").query()).toBeNull();
	});

	it("prompts for sign-in when reopened after signing out, instead of the cached catalog", async () => {
		const { screen, signOut, setCatalogOpen } = await renderWithoutKey({
			status: "authenticated",
			user: { email: "dev@anaconda.com" },
		});
		await expect.element(screen.getByTestId("model-catalog-table")).toBeVisible();

		setCatalogOpen(false);
		signOut();
		setCatalogOpen(true);

		await expect.element(screen.getByTestId("model-catalog-sign-in")).toBeVisible();
		expect(screen.getByTestId("model-catalog-table").query()).toBeNull();
	});

	it("drops the catalog when signed out while it is open", async () => {
		const { screen, signOut } = await renderWithoutKey({
			status: "authenticated",
			user: { email: "dev@anaconda.com" },
		});
		await expect.element(screen.getByTestId("model-catalog-table")).toBeVisible();

		signOut();

		await expect.element(screen.getByTestId("model-catalog-sign-in")).toBeVisible();
	});

	it("does not refetch the catalog when the first resolve finds an existing key", async () => {
		const { screen, list } = await renderWithoutKey(
			{ status: "authenticated", user: { email: "dev@anaconda.com" } },
			true,
			{ catalogAlwaysFails: true },
		);

		await expect.element(screen.getByTestId("model-catalog-error")).toBeVisible();
		// Give a would-be refetch a chance to fire before asserting it didn't.
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(list).toHaveBeenCalledTimes(1);
	});

	it("shows the generic error when the anaconda-account plugin is absent", async () => {
		const { screen } = await renderWithoutKey({ status: "anonymous" }, false);

		await expect.element(screen.getByTestId("model-catalog-error")).toBeVisible();
		expect(screen.getByTestId("model-catalog-sign-in").query()).toBeNull();
	});

	it("shows the generic error, not sign-in, when the Anaconda session itself errored", async () => {
		const { screen } = await renderWithoutKey({ status: "error", reason: "offline" });

		// keyStored is true for authenticated only, so the catalog still fails here.
		await expect.element(screen.getByTestId("model-catalog-error")).toBeVisible();
		expect(screen.getByTestId("model-catalog-sign-in").query()).toBeNull();
	});
});
