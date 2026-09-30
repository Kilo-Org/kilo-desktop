import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page } from "vitest/browser";

import {
	marketplaceContract,
	type MarketplaceMutationInput,
	type MarketplaceSnapshot,
} from "../contracts/schemas.js";
import { MarketplaceSettings } from "./MarketplaceSettings.js";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

const snapshot: MarketplaceSnapshot = {
	items: [
		{
			type: "agent",
			id: "reviewer",
			name: "Reviewer",
			description: "Reviews pull requests",
			category: "engineering",
			content: {
				mode: "subagent",
				description: "Reviews code",
				prompt: "Review.",
			},
		},
		{
			type: "skill",
			id: "notebooks",
			name: "Notebooks",
			description: "Builds notebooks",
			category: "data",
			content: "https://example.com/notebooks.tar.gz",
			githubUrl: "https://github.com/example/notebooks",
		},
	],
	targets: [{ id: "workspace-1", name: "Demo", directory: "/tmp/demo" }],
	installed: [],
	included: [],
	mcpStatuses: {},
	mcpInstallationStatuses: {},
	errors: [],
	stale: false,
	fetchedAt: 42,
};

afterEach(() => cleanup());

function renderPage(
	data: MarketplaceSnapshot = snapshot,
	options: { activeWorkspaceId?: string; holdList?: boolean } = {},
) {
	let current = data;
	let holdingList = options.holdList ?? false;
	const heldLists: Array<() => void> = [];
	const install = vi.fn(async (input: MarketplaceMutationInput) => {
		current = {
			...current,
			installed: [
				...current.installed,
				{
					type: input.item.type,
					id: input.item.id,
					scope: input.scope,
					...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
				},
			],
		};
		return { ok: true as const, path: "/tmp/reviewer.md" };
	});
	const remove = vi.fn(async () => ({ ok: true as const, path: "/tmp/reviewer.md" }));
	const authenticateMcp = vi.fn(async () => ({ ok: true as const }));
	const refresh = vi.fn(async () => current);
	const list = vi.fn(() =>
		holdingList
			? new Promise<MarketplaceSnapshot>((resolve) => heldLists.push(() => resolve(current)))
			: Promise.resolve(current),
	);
	const openExternal = vi.fn(async () => ({ opened: true as const }));
	const track = vi.fn(async (_input: { event: string; data: Record<string, unknown> }) => {});
	const sdk = createFakeSdk({
		featureId: "kilo-marketplace",
		channels: marketplaceContract,
		shell: { openExternal },
		telemetry: { track },
		handlers: {
			"marketplace.list": list,
			"marketplace.refresh": refresh,
			"marketplace.install": install,
			"marketplace.remove": remove,
			"marketplace.authenticateMcp": authenticateMcp,
		},
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-marketplace": sdk } });
	if (options.activeWorkspaceId) {
		system.getSdk("kilo-ui").state.register("active-workspace", options.activeWorkspaceId);
	}
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const { baseElement } = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={client}>
				<MarketplaceSettings />
			</QueryClientProvider>
		</SdkProvider>,
	);
	return {
		authenticateMcp,
		baseElement,
		client,
		install,
		list,
		openExternal,
		refresh,
		remove,
		releaseList() {
			holdingList = false;
			for (const resolve of heldLists.splice(0)) resolve();
		},
		track,
		setSnapshot(next: MarketplaceSnapshot) {
			current = next;
		},
	};
}

function itemIds(baseElement: HTMLElement): Array<string | undefined> {
	return Array.from(
		baseElement.querySelectorAll<HTMLElement>("[data-qa-id^='marketplace-item-']"),
	).map((row) => row.dataset.qaId);
}

async function openBrowse() {
	await page.getByTestId("marketplace-add").click();
	await expect.element(page.getByTestId("marketplace-catalog-dialog")).toBeVisible();
}

async function openInstalledFilters() {
	await page.getByTestId("marketplace-filter-menu").click();
}

async function openShowFilters() {
	if (page.getByTestId("marketplace-user-filter").query()) return;
	await page.getByTestId("marketplace-show-filter").click();
	await expect.element(page.getByTestId("marketplace-user-filter")).toBeVisible();
}

describe("MarketplaceSettings", () => {
	it("tracks browse opens and installs with item identity and destination", async () => {
		const { track } = renderPage();

		await openBrowse();
		await page.getByTestId("marketplace-install-agent-reviewer").click();
		await page.getByTestId("marketplace-install-confirm").click();
		await expect.element(page.getByTestId("marketplace-install-dialog")).not.toBeInTheDocument();

		expect(track.mock.calls.map(([input]) => input)).toEqual([
			{
				event: "Marketplace Tab Viewed",
				data: { featureId: "kilo-marketplace" },
			},
			{
				event: "Marketplace Install Button Clicked",
				data: {
					featureId: "kilo-marketplace",
					itemId: "reviewer",
					itemName: "Reviewer",
					itemType: "agent",
				},
			},
			{
				event: "Marketplace Item Installed",
				data: {
					featureId: "kilo-marketplace",
					itemId: "reviewer",
					itemName: "Reviewer",
					itemType: "agent",
					target: "global",
				},
			},
		]);
	});

	it("tracks a confirmed removal with item identity and destination", async () => {
		const { track } = renderPage({
			...snapshot,
			installed: [{ type: "agent", id: "reviewer", scope: "global" }],
		});

		await page.getByTestId("marketplace-card-trigger-agent-reviewer").click();
		await page.getByTestId("marketplace-remove-agent-reviewer-global").click();
		await page.getByTestId("marketplace-remove-confirm").click();
		await expect.poll(() => track.mock.calls.length).toBe(1);

		expect(track).toHaveBeenCalledWith({
			event: "Marketplace Item Removed",
			data: {
				featureId: "kilo-marketplace",
				itemId: "reviewer",
				itemName: "Reviewer",
				itemType: "agent",
				target: "global",
			},
		});
	});

	it("does not render supplied MCP images in Agent Behavior or the Kilo Marketplace", async () => {
		const iconDataUrl =
			"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
		const mcp = {
			type: "mcp" as const,
			id: "docs",
			name: "Docs",
			description: "Searches documentation",
			category: "knowledge",
			url: "https://docs.example.com/mcp",
			iconDataUrl,
			content: '{"type":"remote","url":"https://docs.example.com/mcp"}',
		};
		const { baseElement } = renderPage({
			...snapshot,
			items: [mcp],
			installed: [{ type: "mcp", id: "docs", scope: "global" }],
		});

		await expect.element(page.getByTestId("marketplace-item-mcp-docs")).toBeVisible();
		expect(baseElement.querySelector("img")).toBeNull();
		await openBrowse();
		await expect.element(page.getByTestId("marketplace-item-mcp-docs")).toBeVisible();
		expect(baseElement.querySelector("img")).toBeNull();
	});

	it("uses category display names on Marketplace card badges", async () => {
		renderPage({
			...snapshot,
			items: [
				{
					type: "agent",
					id: "automation-agent",
					name: "Automation Agent",
					description: "Automates browser workflows.",
					category: "web-automation",
					content: { mode: "subagent", description: "Automation", prompt: "Automate" },
				},
			],
		});

		await openBrowse();
		await expect
			.element(page.getByTestId("marketplace-card-category-agent-automation-agent"))
			.toHaveTextContent("Web Automation");
		const author = await page.getByTestId("marketplace-row-author-agent-automation-agent").query();
		const category = await page
			.getByTestId("marketplace-card-category-agent-automation-agent")
			.query();
		expect(category?.parentElement).toBe(author?.parentElement);
		await expect
			.element(page.getByTestId("marketplace-category-section-web-automation"))
			.toHaveAccessibleName("Web Automation");
	});

	it("sections Marketplace results by category", async () => {
		renderPage({
			...snapshot,
			items: [
				...snapshot.items,
				{
					type: "agent",
					id: "planner",
					name: "Planner",
					description: "Plans engineering work",
					category: "engineering",
					content: { mode: "subagent", description: "Plans work", prompt: "Plan." },
				},
			],
		});

		await openBrowse();
		await expect.element(page.getByRole("heading", { name: "Engineering" })).toBeVisible();
		await expect.element(page.getByText("Items: 2", { exact: true })).toBeVisible();
		await expect.element(page.getByTestId("marketplace-category-section-data")).toBeVisible();
		await expect
			.element(page.getByTestId("marketplace-category-section-engineering"))
			.toBeVisible();
		await page.getByTestId("marketplace-category-data").click();
		await expect
			.element(page.getByTestId("marketplace-category-section-engineering"))
			.not.toBeInTheDocument();
	});

	it("previews six items per category until View all selects that category", async () => {
		renderPage({
			...snapshot,
			items: [
				...Array.from({ length: 8 }, (_, index) => ({
					type: "agent" as const,
					id: `engineering-${index}`,
					name: `Engineering ${index}`,
					description: "Supports engineering work",
					category: "engineering",
					content: { mode: "subagent" as const, description: "Agent", prompt: "Help." },
				})),
				...Array.from({ length: 3 }, (_, index) => ({
					type: "agent" as const,
					id: `data-${index}`,
					name: `Data ${index}`,
					description: "Supports data work",
					category: "data",
					content: { mode: "subagent" as const, description: "Agent", prompt: "Help." },
				})),
			],
		});
		await openBrowse();

		const engineering = page.getByTestId("marketplace-category-section-engineering");
		const cards = () => engineering.element().querySelectorAll("[data-qa-id^='marketplace-item-']");
		await expect.element(engineering).toBeVisible();
		expect(cards()).toHaveLength(6);
		await expect.element(page.getByText("Items: 8", { exact: true })).toBeVisible();
		await expect.element(page.getByTestId("marketplace-view-all-data")).not.toBeInTheDocument();

		await page.getByTestId("marketplace-view-all-engineering").click();
		await expect
			.element(page.getByTestId("marketplace-category-engineering"))
			.toHaveAttribute("aria-pressed", "true");
		expect(cards()).toHaveLength(8);
		await expect
			.element(page.getByTestId("marketplace-category-section-data"))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByTestId("marketplace-view-all-engineering"))
			.not.toBeInTheDocument();

		await page.getByTestId("marketplace-category-all").click();
		expect(cards()).toHaveLength(6);
	});

	it("keeps category section headers the same height with or without View all", async () => {
		renderPage({
			...snapshot,
			items: Array.from({ length: 8 }, (_, index) => ({
				type: "agent" as const,
				id: `business-${index}`,
				name: `Business ${index}`,
				description: "Supports business work",
				category: "business",
				content: { mode: "subagent" as const, description: "Agent", prompt: "Help." },
			})),
		});
		await openBrowse();
		const headerRect = () =>
			page
				.getByTestId("marketplace-category-section-business")
				.element()
				.querySelector("header")!
				.getBoundingClientRect();

		await expect.element(page.getByTestId("marketplace-view-all-business")).toBeVisible();
		const withViewAll = headerRect();

		await page.getByTestId("marketplace-category-business").click();
		await expect.element(page.getByTestId("marketplace-view-all-business")).not.toBeInTheDocument();
		const withoutViewAll = headerRect();

		expect(withoutViewAll.height).toBeCloseTo(withViewAll.height, 0);
		expect(withoutViewAll.top).toBeCloseTo(withViewAll.top, 0);
	});

	it("keeps type filter widths stable when category counts change", async () => {
		renderPage({
			...snapshot,
			items: [
				...Array.from({ length: 10 }, (_, index) => ({
					type: "agent" as const,
					id: `engineering-agent-${index}`,
					name: `Engineering Agent ${index}`,
					description: "Supports engineering work",
					category: "engineering",
					content: { mode: "subagent" as const, description: "Agent", prompt: "Help." },
				})),
				{
					type: "agent",
					id: "data-agent",
					name: "Data Agent",
					description: "Supports data work",
					category: "data",
					content: { mode: "subagent", description: "Agent", prompt: "Help." },
				},
			],
		});

		await openBrowse();
		const tabs = ["all", "agent", "mcp", "skill"].map((type) => {
			const tab = page.getByTestId(`marketplace-type-${type}`).query();
			if (!(tab instanceof HTMLElement)) throw new Error(`Missing ${type} type filter.`);
			return tab;
		});
		const widthsBefore = tabs.map((tab) => tab.getBoundingClientRect().width);

		await page.getByTestId("marketplace-category-data").click();
		await expect.element(page.getByTestId("marketplace-type-all")).toHaveTextContent("All 1");

		expect(tabs.map((tab) => tab.getBoundingClientRect().width)).toEqual(widthsBefore);
	});

	it("holds type filter counts without reporting zero while the catalog loads", async () => {
		const { releaseList } = renderPage(
			{ ...snapshot, installed: [{ type: "agent", id: "reviewer", scope: "global" }] },
			{ holdList: true },
		);
		const typeFilters = () =>
			["all", "agent", "mcp", "skill"].map((type) => page.getByTestId(`marketplace-type-${type}`));
		const widths = () => typeFilters().map((tab) => tab.element().getBoundingClientRect().width);

		await expect.element(page.getByTestId("marketplace-loading")).toBeVisible();
		for (const tab of typeFilters()) expect(tab.element().textContent).not.toMatch(/\d/);
		const loadingWidths = widths();

		releaseList();
		await expect.element(page.getByTestId("marketplace-type-all")).toHaveTextContent("All 1");
		await expect.element(page.getByTestId("marketplace-type-mcp")).toHaveTextContent("MCPs 0");
		expect(widths()).toEqual(loadingWidths);
	});

	it("keeps the category tile grid shape while the catalog loads", async () => {
		await page.viewport(1200, 800);
		onTestFinished(() => page.viewport(414, 896));
		const { releaseList } = renderPage(snapshot, { holdList: true });

		await openBrowse();
		await expect.element(page.getByTestId("marketplace-loading")).toBeVisible();
		for (const type of ["all", "agent", "mcp", "skill"]) {
			expect(page.getByTestId(`marketplace-type-${type}`).element().textContent).not.toMatch(/\d/);
		}
		const container = page.getByTestId("marketplace-category-tiles").element();
		const allTile = page.getByTestId("marketplace-category-all").element().getBoundingClientRect();
		const tiles = Array.from(container.children, (tile) => tile.getBoundingClientRect());

		expect(tiles.length).toBeGreaterThan(1);
		expect(allTile.width).toBeLessThan(container.getBoundingClientRect().width / 2);
		for (const tile of tiles) {
			expect(tile.width).toBeCloseTo(allTile.width, 0);
			expect(tile.height).toBeCloseTo(allTile.height, 0);
		}

		releaseList();
		await expect.element(page.getByTestId("marketplace-category-data")).toBeVisible();
		expect(page.getByTestId("marketplace-category-placeholder").elements()).toHaveLength(0);
		const loadedAllTile = page.getByTestId("marketplace-category-all").element();
		expect(loadedAllTile.getBoundingClientRect().height).toBeCloseTo(allTile.height, 0);
	});

	it("places type filters after search on the same row in installed and Marketplace views", async () => {
		const searchFieldRect = () => {
			const group = page
				.getByTestId("marketplace-search")
				.element()
				.closest("[data-slot='input-group']");
			if (!(group instanceof HTMLElement)) throw new Error("Missing search field.");
			return group.getBoundingClientRect();
		};
		const typeFiltersRect = () =>
			page.getByRole("group", { name: "Marketplace item type" }).element().getBoundingClientRect();
		const expectSameRow = (a: DOMRect, b: DOMRect) => {
			expect(a.top).toBeLessThan(b.bottom);
			expect(a.bottom).toBeGreaterThan(b.top);
		};

		await page.viewport(1200, 800);
		onTestFinished(() => page.viewport(414, 896));
		renderPage({
			...snapshot,
			installed: [{ type: "agent", id: "reviewer", scope: "global" }],
		});
		await expect.element(page.getByTestId("marketplace-type-all")).toHaveTextContent("All 1");

		const installedSearch = searchFieldRect();
		const installedFilter = page
			.getByTestId("marketplace-filter-menu")
			.element()
			.getBoundingClientRect();
		const installedTypes = typeFiltersRect();
		expectSameRow(installedTypes, installedSearch);
		expectSameRow(installedFilter, installedSearch);
		expect(installedTypes.left).toBeGreaterThanOrEqual(installedSearch.right);
		expect(installedFilter.left).toBeGreaterThanOrEqual(installedTypes.right);

		await openBrowse();
		const catalogSearch = searchFieldRect();
		const catalogTypes = typeFiltersRect();
		const categories = page
			.getByTestId("marketplace-category-tiles")
			.element()
			.getBoundingClientRect();
		expectSameRow(catalogTypes, catalogSearch);
		expect(catalogTypes.left).toBeGreaterThanOrEqual(catalogSearch.right);
		expect(categories.top).toBeGreaterThanOrEqual(
			Math.max(catalogSearch.bottom, catalogTypes.bottom),
		);

		// Tile padding and the section header's min-h-7 are transparent, so compare the
		// visible content: tile icons against the search row and the first section heading.
		const tileIcons = Array.from(
			page
				.getByTestId("marketplace-category-tiles")
				.element()
				.querySelectorAll("button > span:first-child"),
			(icon) => icon.getBoundingClientRect(),
		);
		const firstHeading = page
			.getByTestId("marketplace-card-grid")
			.element()
			.querySelector("h2")!
			.getBoundingClientRect();
		const spaceAboveCategories =
			Math.min(...tileIcons.map((icon) => icon.top)) -
			Math.max(catalogSearch.bottom, catalogTypes.bottom);
		const spaceBelowCategories =
			firstHeading.top - Math.max(...tileIcons.map((icon) => icon.bottom));
		expect(Math.abs(spaceAboveCategories - spaceBelowCategories)).toBeLessThanOrEqual(2);
	});

	it("sizes category toggles equally to fit the longest name and fill the row", async () => {
		await page.viewport(1200, 800);
		onTestFinished(() => page.viewport(414, 896));
		const categories = [
			"business",
			"creative-media",
			"data",
			"development",
			"engineering",
			"automation",
			"observability",
			"productivity",
			"search",
			"knowledge",
			"research",
			"web-automation",
		];
		renderPage({
			...snapshot,
			items: categories.map((category) => ({
				type: "agent" as const,
				id: `${category}-agent`,
				name: `${category} agent`,
				description: `Supports ${category} work`,
				category,
				content: { mode: "subagent" as const, description: "Agent", prompt: "Help." },
			})),
		});

		await openBrowse();
		const container = page.getByTestId("marketplace-category-tiles").element();
		const containerRect = container.getBoundingClientRect();
		const pills = Array.from(container.children, (pill) => pill as HTMLElement);
		const pillRects = pills.map((pill) => pill.getBoundingClientRect());
		const firstRowTop = Math.min(...pillRects.map((rect) => rect.top));
		const firstRow = pillRects.filter((rect) => Math.abs(rect.top - firstRowTop) < 1);

		for (const rect of pillRects) expect(rect.width).toBeCloseTo(pillRects[0]!.width, 0);
		for (const pill of pills) expect(pill.scrollWidth).toBeLessThanOrEqual(pill.clientWidth);
		expect(Math.min(...firstRow.map((rect) => rect.left))).toBeCloseTo(containerRect.left, 0);
		expect(Math.max(...firstRow.map((rect) => rect.right))).toBeCloseTo(containerRect.right, 0);
	});

	it("places the Marketplace scrollbar at the dialog edge without clipping the card grid", async () => {
		renderPage({
			...snapshot,
			items: Array.from({ length: 12 }, (_, index) => ({
				type: "agent" as const,
				id: `agent-${index}`,
				name: `Agent ${index}`,
				description: "A Marketplace item with enough rows to make the catalog scroll.",
				category: "development",
				content: { mode: "subagent" as const, description: "Agent", prompt: "Help" },
			})),
		});

		await openBrowse();
		const dialog = (await page.getByTestId("marketplace-catalog-dialog").query()) as HTMLElement;
		const viewport = (await page.getByTestId("marketplace-scroll-viewport").query()) as HTMLElement;
		const grid = (await page.getByTestId("marketplace-card-grid").query()) as HTMLElement;
		const dialogRect = dialog.getBoundingClientRect();
		const viewportRect = viewport.getBoundingClientRect();
		const gridRect = grid.getBoundingClientRect();

		expect(dialog).toHaveClass("p-0");
		expect(viewport).toHaveClass("scroll-fade-y");
		expect(viewport).toHaveClass("[scrollbar-gutter:stable]");
		expect(Math.abs(viewportRect.right - dialogRect.right)).toBeLessThan(2);
		expect(gridRect.top - viewportRect.top).toBeGreaterThanOrEqual(3);
		expect(gridRect.left - viewportRect.left).toBeGreaterThanOrEqual(15);
		expect(viewportRect.right - gridRect.right).toBeGreaterThanOrEqual(15);
	});

	it("shows installed items on the page and opens browse items in the Marketplace modal", async () => {
		const { baseElement } = renderPage(
			{
				...snapshot,
				installed: [
					{ type: "agent", id: "reviewer", scope: "global" },
					{ type: "skill", id: "notebooks", scope: "workspace", workspaceId: "workspace-1" },
				],
			},
			{ activeWorkspaceId: "workspace-1" },
		);

		await expect.element(page.getByTestId("marketplace-add")).toHaveTextContent("Add");
		await expect.element(page.getByTestId("marketplace-catalog-dialog")).not.toBeInTheDocument();
		await expect
			.element(page.getByTestId("marketplace-type-all"))
			.toHaveAttribute("aria-pressed", "true");
		await expect.element(page.getByTestId("marketplace-type-all")).toHaveTextContent("All 2");
		await expect.element(page.getByTestId("marketplace-type-agent")).toHaveTextContent("Agents 1");
		await expect.element(page.getByTestId("marketplace-type-mcp")).toHaveTextContent("MCPs 0");
		await expect.element(page.getByTestId("marketplace-type-skill")).toHaveTextContent("Skills 1");
		expect(itemIds(baseElement)).toEqual([
			"marketplace-item-agent-reviewer",
			"marketplace-item-skill-notebooks",
		]);
		await page.getByTestId("marketplace-card-trigger-agent-reviewer").click();
		await expect
			.element(page.getByTestId("marketplace-installed-in-agent-reviewer-global"))
			.toHaveTextContent("All workspaces");
		await page.getByTestId("marketplace-card-trigger-agent-reviewer").click();

		await page.getByTestId("marketplace-type-skill").click();
		expect(itemIds(baseElement)).toEqual(["marketplace-item-skill-notebooks"]);
		await page.getByTestId("marketplace-card-trigger-skill-notebooks").click();
		await expect
			.element(page.getByTestId("marketplace-installed-in-skill-notebooks-workspace-1"))
			.toHaveTextContent("Demo");
		await expect
			.element(page.getByTestId("marketplace-card-category-skill-notebooks"))
			.toHaveTextContent("Data");
		await expect
			.element(page.getByTestId("marketplace-card-author-skill-notebooks"))
			.toHaveTextContent("By Unknown");
		await expect
			.element(page.getByTestId("marketplace-source-skill-notebooks"))
			.toHaveAccessibleName("View source");
		await page.getByTestId("marketplace-card-trigger-skill-notebooks").click();
		await expect.element(page.getByTestId("marketplace-category-tiles")).not.toBeInTheDocument();

		await openBrowse();
		await expect.element(page.getByTestId("marketplace-install-agent-reviewer")).toBeVisible();
		await expect.element(page.getByTestId("marketplace-install-skill-notebooks")).toBeVisible();
		await expect
			.element(page.getByTestId("marketplace-type-all"))
			.toHaveAttribute("aria-pressed", "true");
		await expect
			.element(page.getByTestId("marketplace-type-agent"))
			.toHaveAttribute("aria-pressed", "false");
		await expect.element(page.getByTestId("marketplace-category-tiles")).toBeVisible();

		await page.getByTestId("marketplace-type-mcp").click();
		await page.getByRole("button", { name: "Close" }).click();
		await expect.element(page.getByTestId("marketplace-catalog-dialog")).not.toBeInTheDocument();
		await expect
			.element(page.getByTestId("marketplace-type-skill"))
			.toHaveAttribute("aria-pressed", "true");
		await openBrowse();
		await expect
			.element(page.getByTestId("marketplace-type-mcp"))
			.toHaveAttribute("aria-pressed", "true");
	});

	it("shows and removes items configured outside the Marketplace", async () => {
		const { remove } = renderPage({
			...snapshot,
			items: [],
			installed: [{ type: "agent", id: "local-helper", scope: "global" }],
		});

		await expect.element(page.getByTestId("marketplace-item-agent-local-helper")).toBeVisible();
		await expect
			.element(page.getByTestId("marketplace-name-agent-local-helper"))
			.toHaveTextContent("Local helper");
		await page.getByTestId("marketplace-card-trigger-agent-local-helper").click();
		await expect
			.element(page.getByTestId("marketplace-installed-in-agent-local-helper-global"))
			.toHaveTextContent("All workspaces");
		await page.getByTestId("marketplace-remove-agent-local-helper-global").click();
		await page.getByTestId("marketplace-remove-confirm").click();

		await expect
			.poll(() => remove)
			.toHaveBeenCalledWith({
				item: { type: "agent", id: "local-helper" },
				scope: "global",
			});
	});

	it("explains why unavailable workspace locations cannot be removed", async () => {
		renderPage({
			...snapshot,
			items: [],
			installed: [{ type: "agent", id: "local-helper", scope: "workspace", workspaceId: "closed" }],
		});

		await page.getByTestId("marketplace-card-trigger-agent-local-helper").click();
		const unavailable = page.getByTestId("marketplace-locked-agent-local-helper-closed");
		await expect.element(unavailable).toHaveAccessibleName("Unavailable");
		await unavailable.hover();
		await expect
			.element(page.getByText("This workspace is unavailable, so it can’t be changed here"))
			.toBeVisible();
	});

	it("hides runtime items outside editable config roots until built-ins are shown", async () => {
		const { baseElement } = renderPage({
			...snapshot,
			items: [],
			included: [
				{
					type: "agent",
					id: "managed-reviewer",
					name: "Managed reviewer",
					description: "Provided by the organization.",
					category: "Organization",
					installedIn: "Organization",
				},
			],
		});

		await expect
			.element(page.getByTestId("marketplace-item-agent-managed-reviewer"))
			.not.toBeInTheDocument();
		await openInstalledFilters();
		await openShowFilters();
		await page.getByTestId("marketplace-built-in-filter").click();
		await page.getByTestId("marketplace-filter-menu").click();
		await expect
			.element(page.getByTestId("marketplace-name-agent-managed-reviewer"))
			.toHaveTextContent("Managed reviewer");
		await expect
			.element(page.getByTestId("marketplace-included-agent-managed-reviewer"))
			.toHaveAccessibleName("Built in");
		await page.getByTestId("marketplace-card-trigger-agent-managed-reviewer").click();
		await expect
			.element(page.getByTestId("marketplace-installed-in-agent-managed-reviewer"))
			.toHaveTextContent("Organization");
		expect(
			baseElement.querySelector("[data-qa-id^='marketplace-remove-agent-managed-reviewer-']"),
		).toBeNull();
	});

	it("keeps multiple installed items expanded", async () => {
		renderPage({
			...snapshot,
			installed: [
				{ type: "agent", id: "reviewer", scope: "global" },
				{ type: "skill", id: "notebooks", scope: "global" },
			],
		});

		await page.getByTestId("marketplace-card-trigger-agent-reviewer").click();
		await page.getByTestId("marketplace-card-trigger-skill-notebooks").click();
		await expect
			.element(page.getByTestId("marketplace-card-trigger-agent-reviewer"))
			.toHaveAttribute("aria-expanded", "true");
		await expect
			.element(page.getByTestId("marketplace-card-trigger-skill-notebooks"))
			.toHaveAttribute("aria-expanded", "true");
		await expect.element(page.getByTestId("marketplace-card-details-agent-reviewer")).toBeVisible();
		await expect
			.element(page.getByTestId("marketplace-card-details-skill-notebooks"))
			.toBeVisible();
	});

	it("clips a collapsed header description at the first sentence", async () => {
		renderPage({
			...snapshot,
			items: [],
			installed: [
				{
					type: "skill",
					id: "adbc",
					scope: "global",
					name: "Adbc",
					description: "Connect to databases. Use whenever the user needs a database.",
				},
			],
		});

		await expect
			.element(page.getByTestId("marketplace-card-summary-skill-adbc"))
			.toHaveTextContent("Connect to databases.");
		await page.getByTestId("marketplace-card-trigger-skill-adbc").click();
		await expect
			.element(
				page.getByText("Connect to databases. Use whenever the user needs a database.", {
					exact: true,
				}),
			)
			.toBeVisible();
	});

	it("shows managed item install locations instead of its organization origin", async () => {
		renderPage({
			...snapshot,
			items: [],
			targets: [{ id: "workspace-1", name: "Demo", directory: "/tmp/demo" }],
			installed: [
				{
					type: "agent",
					id: "architect",
					scope: "global",
					name: "Architect",
					description: "Stress-test technical designs.",
					category: "Development",
					installedIn: "Organization",
				},
				{
					type: "agent",
					id: "architect",
					scope: "workspace",
					workspaceId: "workspace-1",
					name: "Architect",
					description: "Stress-test technical designs.",
					category: "Development",
					installedIn: "Organization",
				},
			],
		});

		await page.getByTestId("marketplace-card-trigger-agent-architect").click();
		const globalLocation = page.getByTestId("marketplace-installed-in-agent-architect-global");
		const workspaceLocation = page.getByTestId(
			"marketplace-installed-in-agent-architect-workspace-1",
		);
		await expect.element(globalLocation).toHaveTextContent("All workspaces");
		await expect.element(workspaceLocation).toHaveTextContent("Demo");
		await expect
			.element(page.getByTestId("marketplace-card-details-agent-architect"))
			.not.toHaveTextContent("Organization");
		await expect
			.element(page.getByTestId("marketplace-installed-in-agent-architect"))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByTestId("marketplace-remove-agent-architect-global"))
			.toHaveAccessibleName("Remove Architect from All workspaces");
		await expect
			.element(page.getByTestId("marketplace-remove-agent-architect-workspace-1"))
			.toHaveAccessibleName("Remove Architect from Demo");
	});

	it("shows built-in agents and skills as installed without removal actions", async () => {
		const { baseElement } = renderPage({
			...snapshot,
			included: [
				{
					type: "agent",
					id: "code",
					name: "Code",
					description: "The default coding agent",
					category: "Built-in",
					installedIn: "Kilo",
				},
				{
					type: "skill",
					id: "browser-tools",
					name: "Browser tools",
					description: "Work with browser content",
					category: "Built-in",
					installedIn: "Kilo",
				},
			],
		});

		expect(itemIds(baseElement)).toEqual([]);

		await openInstalledFilters();
		await openShowFilters();
		await page.getByTestId("marketplace-built-in-filter").click();
		await page.getByTestId("marketplace-filter-menu").click();
		await expect.element(page.getByTestId("marketplace-type-agent")).toHaveTextContent("Agents 1");
		await expect.element(page.getByTestId("marketplace-type-skill")).toHaveTextContent("Skills 1");
		expect(itemIds(baseElement)).toEqual([
			"marketplace-item-agent-code",
			"marketplace-item-skill-browser-tools",
		]);
		await expect
			.element(page.getByTestId("marketplace-included-agent-code"))
			.toHaveAccessibleName("Built in");
		await page.getByTestId("marketplace-card-trigger-agent-code").click();
		await expect
			.element(page.getByTestId("marketplace-installed-in-agent-code"))
			.toHaveTextContent("Built-in");
		expect(baseElement.querySelector("[data-qa-id^='marketplace-remove-agent-code-']")).toBeNull();
		await page.getByTestId("marketplace-card-trigger-agent-code").click();

		await page.getByTestId("marketplace-type-skill").click();
		expect(itemIds(baseElement)).toEqual(["marketplace-item-skill-browser-tools"]);
		await page.getByTestId("marketplace-card-trigger-skill-browser-tools").click();
		await expect
			.element(page.getByTestId("marketplace-installed-in-skill-browser-tools"))
			.toHaveTextContent("Built-in");
		await expect
			.element(page.getByTestId("marketplace-included-skill-browser-tools"))
			.toHaveAccessibleName("Built in");
		expect(
			baseElement.querySelector("[data-qa-id^='marketplace-remove-skill-browser-tools-']"),
		).toBeNull();
		await page.getByTestId("marketplace-card-trigger-skill-browser-tools").click();

		await openBrowse();
		await expect.element(page.getByTestId("marketplace-filter-menu")).not.toBeInTheDocument();
		expect(itemIds(baseElement)).toEqual([
			"marketplace-item-skill-notebooks",
			"marketplace-item-agent-reviewer",
		]);
	});

	it("filters installed items by source and workspace", async () => {
		const { baseElement } = renderPage({
			...snapshot,
			targets: [
				{ id: "workspace-1", name: "Demo", directory: "/tmp/demo", color: "#F87171" },
				{ id: "workspace-2", name: "Other", directory: "/tmp/other" },
				...Array.from({ length: 10 }, (_, index) => ({
					id: `extra-${index}`,
					name: `Extra ${index}`,
					directory: `/tmp/extra-${index}`,
				})),
			],
			installed: [
				{ type: "agent", id: "reviewer", scope: "global" },
				{ type: "skill", id: "notebooks", scope: "workspace", workspaceId: "workspace-1" },
			],
			included: [
				{
					type: "agent",
					id: "code",
					name: "Code",
					description: "The default coding agent",
					category: "Built-in",
					installedIn: "Kilo",
				},
			],
		});

		await openInstalledFilters();
		await expect.element(page.getByTestId("marketplace-user-filter")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("marketplace-reset-filters")).not.toBeInTheDocument();
		await expect
			.element(page.getByTestId("marketplace-workspace-filter-workspace-1"))
			.toBeChecked();
		await expect
			.element(page.getByTestId("marketplace-workspace-filter-workspace-2"))
			.toBeChecked();
		const filterMenu = page.getByRole("menu").element();
		expect(filterMenu.scrollHeight).toBeGreaterThan(filterMenu.clientHeight);
		const workspaceList = page.getByTestId("marketplace-workspace-filter-list").element();
		expect(workspaceList.scrollHeight).toBe(workspaceList.clientHeight);
		const workspaceIcon = page
			.getByTestId("marketplace-workspace-filter-workspace-1")
			.element()
			.querySelector('[data-slot="marketplace-workspace-icon"]');
		expect(workspaceIcon?.getAttribute("stroke")).toBe("#F87171");

		await openShowFilters();
		await expect.element(page.getByTestId("marketplace-user-filter")).toBeChecked();
		await expect.element(page.getByTestId("marketplace-built-in-filter")).not.toBeChecked();
		await page.getByTestId("marketplace-built-in-filter").click();
		expect(itemIds(baseElement)).toContain("marketplace-item-agent-code");
		await page.getByTestId("marketplace-user-filter").click();
		expect(itemIds(baseElement)).toEqual(["marketplace-item-agent-code"]);
		await page.getByTestId("marketplace-user-filter").click();

		await page.getByTestId("marketplace-workspace-filter-workspace-1").click();
		expect(itemIds(baseElement)).not.toContain("marketplace-item-skill-notebooks");
		expect(itemIds(baseElement)).toContain("marketplace-item-agent-reviewer");
		expect(itemIds(baseElement)).toContain("marketplace-item-agent-code");

		await page.getByTestId("marketplace-reset-filters").click();
		expect(itemIds(baseElement)).toContain("marketplace-item-skill-notebooks");
		expect(itemIds(baseElement)).not.toContain("marketplace-item-agent-code");
		await openInstalledFilters();
		await expect
			.element(page.getByTestId("marketplace-workspace-filter-workspace-1"))
			.toBeChecked();
		await expect.element(page.getByTestId("marketplace-reset-filters")).not.toBeInTheDocument();
		await openShowFilters();
		await expect.element(page.getByTestId("marketplace-user-filter")).toBeChecked();
		await expect.element(page.getByTestId("marketplace-built-in-filter")).not.toBeChecked();

		await page.getByTestId("marketplace-user-filter").click();
		await page.getByTestId("marketplace-filter-menu").click();
		await openBrowse();
		await expect
			.element(page.getByTestId("marketplace-category-engineering"))
			.toHaveTextContent("Engineering");
		await expect.element(page.getByTestId("marketplace-item-agent-reviewer")).toBeVisible();
	});

	it("opens Browse from the empty installed state and switches item types with toggles", async () => {
		const { baseElement } = renderPage();
		await expect
			.element(page.getByTestId("marketplace-empty-title"))
			.toHaveTextContent("No items installed");
		await page.getByTestId("marketplace-browse-empty").click();
		await expect.element(page.getByTestId("marketplace-card-grid")).toBeVisible();
		expect(itemIds(baseElement)).toEqual([
			"marketplace-item-skill-notebooks",
			"marketplace-item-agent-reviewer",
		]);

		await page.getByTestId("marketplace-type-agent").click();
		expect(itemIds(baseElement)).toEqual(["marketplace-item-agent-reviewer"]);

		await page.getByTestId("marketplace-type-all").click();
		await page.getByTestId("marketplace-type-skill").click();
		expect(itemIds(baseElement)).toEqual(["marketplace-item-skill-notebooks"]);

		await page.getByTestId("marketplace-type-all").click();
		await page.getByTestId("marketplace-search").fill("e");
		await expect
			.element(page.getByTestId("marketplace-type-all"))
			.toHaveAttribute("aria-pressed", "true");
		await expect.element(page.getByTestId("marketplace-type-all")).toHaveTextContent("All 2");
		await expect
			.poll(() => itemIds(baseElement))
			.toEqual(["marketplace-item-skill-notebooks", "marketplace-item-agent-reviewer"]);

		await page.getByTestId("marketplace-type-skill").click();
		await expect.element(page.getByTestId("marketplace-search")).toHaveValue("e");
		await expect
			.element(page.getByTestId("marketplace-type-skill"))
			.toHaveAttribute("aria-pressed", "true");
		expect(itemIds(baseElement)).toEqual(["marketplace-item-skill-notebooks"]);
	});

	it("clears a type filter with no Marketplace matches", async () => {
		const { baseElement } = renderPage();
		await openBrowse();

		await page.getByTestId("marketplace-type-mcp").click();

		await expect
			.element(page.getByTestId("marketplace-empty-title"))
			.toHaveTextContent("No matching Marketplace items");
		await expect.element(page.getByTestId("marketplace-clear-filters")).toBeVisible();
		await page.getByTestId("marketplace-clear-filters").click();
		expect(itemIds(baseElement)).toEqual([
			"marketplace-item-skill-notebooks",
			"marketplace-item-agent-reviewer",
		]);
	});

	it("shows item details directly on Marketplace cards", async () => {
		const description =
			"Reviews pull requests for correctness, maintainability, security, performance, and test coverage.";
		renderPage({
			...snapshot,
			items: snapshot.items.map((item) =>
				item.id === "reviewer"
					? {
							...item,
							description,
							author: "Anaconda",
						}
					: item,
			),
		});
		await openBrowse();

		await expect
			.element(page.getByTestId("marketplace-card-description-agent-reviewer"))
			.toHaveTextContent(description);
		await expect
			.element(page.getByTestId("marketplace-row-author-agent-reviewer"))
			.toHaveTextContent("By Anaconda");
		const installButton = page.getByTestId("marketplace-install-agent-reviewer");
		await expect.element(installButton).toBeVisible();
		await expect.element(installButton).toHaveAccessibleName("Install Reviewer");
	});

	it("reveals the Marketplace install button on card hover and keyboard focus", async () => {
		renderPage();
		await openBrowse();

		const installButton = page.getByTestId("marketplace-install-agent-reviewer");
		const button = await installButton.query();
		if (!(button instanceof HTMLButtonElement)) throw new Error("Missing install button.");
		await page.getByTestId("marketplace-search").hover();
		await expect.poll(() => getComputedStyle(button).opacity).toBe("0");

		await page.getByTestId("marketplace-item-agent-reviewer").hover();
		await expect.poll(() => getComputedStyle(button).opacity).toBe("1");

		await page.getByTestId("marketplace-search").hover();
		await expect.poll(() => getComputedStyle(button).opacity).toBe("0");
		button.focus();
		await expect.poll(() => getComputedStyle(button).opacity).toBe("1");
	});

	it("disables Marketplace installation when an item is installed everywhere", async () => {
		renderPage({
			...snapshot,
			installed: [
				{ type: "agent", id: "reviewer", scope: "global" },
				{ type: "agent", id: "reviewer", scope: "workspace", workspaceId: "workspace-1" },
			],
		});
		await openBrowse();

		const installButton = page.getByTestId("marketplace-install-agent-reviewer");
		await expect.element(installButton).toBeDisabled();
		await expect.element(installButton).toHaveAccessibleName("Installed everywhere");
	});

	it("shows installed locations when the catalog card badge is hovered", async () => {
		renderPage({
			...snapshot,
			installed: [
				{ type: "agent", id: "reviewer", scope: "global" },
				{ type: "agent", id: "reviewer", scope: "workspace", workspaceId: "workspace-1" },
			],
		});
		await openBrowse();

		await expect
			.element(page.getByTestId("marketplace-installed-badge-agent-reviewer"))
			.toBeVisible();
		await page.getByTestId("marketplace-installed-badge-agent-reviewer").hover();
		await expect
			.element(page.getByTestId("marketplace-installed-locations-agent-reviewer"))
			.toHaveTextContent("Installed inAll workspacesDemo");
	});

	it("loads the Marketplace for the active workspace", async () => {
		const { list } = renderPage(snapshot, { activeWorkspaceId: "workspace-1" });
		await expect.poll(() => list).toHaveBeenCalledWith({ workspaceId: "workspace-1" });

		await openBrowse();
		await expect.element(page.getByTestId("marketplace-card-grid")).toBeVisible();
	});

	it("filters items and installs the selected canonical item", async () => {
		const { install } = renderPage();
		await expect.element(page.getByTestId("marketplace-page")).toBeVisible();
		await openBrowse();
		await expect.element(page.getByTestId("marketplace-card-grid")).toBeVisible();
		await page.getByTestId("marketplace-search").fill("review");

		await expect.element(page.getByTestId("marketplace-item-agent-reviewer")).toBeVisible();
		await expect
			.element(page.getByTestId("marketplace-item-skill-notebooks"))
			.not.toBeInTheDocument();

		await page.getByTestId("marketplace-install-agent-reviewer").click();
		await expect.element(page.getByTestId("marketplace-install-dialog")).toBeVisible();
		await expect
			.element(page.getByTestId("marketplace-install-title"))
			.toHaveTextContent("Install Reviewer");
		await expect
			.element(page.getByTestId("marketplace-install-target"))
			.toHaveTextContent("All workspaces");
		await expect
			.element(page.getByTestId("marketplace-install-confirm"))
			.toHaveTextContent("Install in All workspaces");
		await page.getByTestId("marketplace-install-confirm").click();

		await expect
			.poll(() => install)
			.toHaveBeenCalledWith({
				item: { type: "agent", id: "reviewer" },
				scope: "global",
			});
		await expect.element(page.getByTestId("marketplace-catalog-dialog")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("marketplace-card-details-agent-reviewer")).toBeVisible();
		await expect
			.element(page.getByTestId("marketplace-remove-agent-reviewer-global"))
			.toBeVisible();
	});

	it("does not later reveal an install that the installed filters hid", async () => {
		const { install } = renderPage({
			...snapshot,
			installed: [{ type: "skill", id: "notebooks", scope: "global" }],
		});
		await page.getByTestId("marketplace-type-skill").click();
		await expect.element(page.getByTestId("marketplace-item-skill-notebooks")).toBeVisible();

		await openBrowse();
		await page.getByTestId("marketplace-install-agent-reviewer").click();
		await page.getByTestId("marketplace-install-confirm").click();
		await expect.poll(() => install).toHaveBeenCalledOnce();
		await expect.element(page.getByTestId("marketplace-catalog-dialog")).not.toBeInTheDocument();
		await expect
			.element(page.getByTestId("marketplace-item-agent-reviewer"))
			.not.toBeInTheDocument();

		await page.getByTestId("marketplace-type-all").click();
		await expect
			.element(page.getByTestId("marketplace-item-agent-reviewer"))
			.toHaveAttribute("data-state", "summary");
		await expect
			.element(page.getByTestId("marketplace-card-details-agent-reviewer"))
			.not.toBeInTheDocument();
	});

	it("selects a workspace destination inside the install dialog", async () => {
		const { install } = renderPage();
		await openBrowse();
		await page.getByTestId("marketplace-install-agent-reviewer").click();
		await expect.element(page.getByTestId("marketplace-install-target")).toBeVisible();
		await page.getByTestId("marketplace-install-target").click();
		await page.getByTestId("marketplace-install-workspace-option-workspace-1").click();
		await expect.element(page.getByTestId("marketplace-install-target")).toHaveTextContent("Demo");
		await expect
			.element(page.getByTestId("marketplace-install-confirm"))
			.toHaveTextContent("Install in Demo");
		await page.getByTestId("marketplace-install-target").click();
		await page.getByTestId("marketplace-install-confirm").click();

		await expect
			.poll(() => install)
			.toHaveBeenCalledWith({
				item: { type: "agent", id: "reviewer" },
				scope: "workspace",
				workspaceId: "workspace-1",
			});
	});

	it("installs into multiple selected workspaces", async () => {
		const { install } = renderPage({
			...snapshot,
			targets: [
				{ id: "workspace-1", name: "Demo", directory: "/tmp/demo" },
				{ id: "workspace-2", name: "Other", directory: "/tmp/other" },
			],
		});
		await openBrowse();
		await page.getByTestId("marketplace-install-agent-reviewer").click();
		await page.getByTestId("marketplace-install-target").click();
		await page.getByTestId("marketplace-install-workspace-option-workspace-1").click();
		await page.getByTestId("marketplace-install-workspace-option-workspace-2").click();
		await expect
			.element(page.getByTestId("marketplace-install-workspace-option-workspace-1"))
			.toHaveAttribute("data-checked", "true");
		await expect
			.element(page.getByTestId("marketplace-install-workspace-option-workspace-2"))
			.toHaveAttribute("data-checked", "true");
		await page.getByTestId("marketplace-install-target").click();
		await expect
			.element(page.getByTestId("marketplace-install-confirm"))
			.toHaveTextContent("Install in 2 workspaces");
		await page.getByTestId("marketplace-install-confirm").click();

		await expect.poll(() => install).toHaveBeenCalledTimes(2);
		expect(install).toHaveBeenNthCalledWith(1, {
			item: { type: "agent", id: "reviewer" },
			scope: "workspace",
			workspaceId: "workspace-1",
		});
		expect(install).toHaveBeenNthCalledWith(2, {
			item: { type: "agent", id: "reviewer" },
			scope: "workspace",
			workspaceId: "workspace-2",
		});
	});

	it("attempts every selected workspace and keeps only failed ones selected", async () => {
		const { install } = renderPage({
			...snapshot,
			targets: [
				{ id: "workspace-1", name: "Demo", directory: "/tmp/demo" },
				{ id: "workspace-2", name: "Other", directory: "/tmp/other" },
				{ id: "workspace-3", name: "Third", directory: "/tmp/third" },
			],
		});
		const succeed = install.getMockImplementation()!;
		install.mockImplementation(async (input) => {
			if (input.workspaceId === "workspace-1") throw new Error("Config is read-only.");
			return succeed(input);
		});
		await openBrowse();
		await page.getByTestId("marketplace-install-agent-reviewer").click();
		await page.getByTestId("marketplace-install-target").click();
		for (const id of ["workspace-1", "workspace-2", "workspace-3"]) {
			await page.getByTestId(`marketplace-install-workspace-option-${id}`).click();
		}
		await page.getByTestId("marketplace-install-target").click();
		await page.getByTestId("marketplace-install-confirm").click();

		await expect.poll(() => install).toHaveBeenCalledTimes(3);
		const error = page.getByTestId("marketplace-install-error");
		await expect
			.element(error)
			.toHaveTextContent(
				"Could not install in Demo: Config is read-only.Installed in Other and Third.",
			);
		await expect.element(page.getByTestId("marketplace-install-dialog")).toBeVisible();
		await expect
			.element(page.getByTestId("marketplace-install-confirm"))
			.toHaveTextContent("Install in Demo");
		await page.getByTestId("marketplace-install-target").click();
		await expect
			.element(page.getByTestId("marketplace-install-workspace-option-workspace-1"))
			.toHaveAttribute("data-checked", "true");
		await expect
			.element(page.getByTestId("marketplace-install-workspace-option-workspace-2"))
			.toHaveTextContent("OtherInstalled");
		await expect
			.element(page.getByTestId("marketplace-install-workspace-option-workspace-3"))
			.toHaveTextContent("ThirdInstalled");
	});

	it("shows workspace identity folder icons without filesystem paths", async () => {
		renderPage({
			...snapshot,
			targets: [
				{ id: "workspace-1", name: "Demo", directory: "/private/work/demo", color: "#F87171" },
			],
		});
		await openBrowse();
		await page.getByTestId("marketplace-install-agent-reviewer").click();
		await page.getByTestId("marketplace-install-target").click();

		const row = page.getByTestId("marketplace-install-workspace-option-workspace-1");
		await expect.element(row).toHaveTextContent("Demo");
		await expect.element(row).not.toHaveTextContent("/private/work/demo");
		await expect
			.element(page.getByTestId("marketplace-install-workspace-icon-workspace-1"))
			.toHaveAttribute("stroke", "#F87171");
	});

	it("searches a larger workspace destination list by name or path", async () => {
		renderPage({
			...snapshot,
			targets: Array.from({ length: 7 }, (_, index) => ({
				id: `workspace-${index + 1}`,
				name: index === 6 ? "Customer Portal" : `Workspace ${index + 1}`,
				directory: index === 5 ? "/work/finance-api" : `/work/project-${index + 1}`,
			})),
		});
		await openBrowse();
		await page.getByTestId("marketplace-install-agent-reviewer").click();
		await page.getByTestId("marketplace-install-target").click();

		const search = page.getByTestId("marketplace-install-workspace-search");
		await expect.element(search).toBeVisible();
		await search.fill("customer");
		await expect
			.element(page.getByTestId("marketplace-install-workspace-option-workspace-7"))
			.toBeVisible();
		await expect
			.element(page.getByTestId("marketplace-install-workspace-option-workspace-1"))
			.not.toBeInTheDocument();

		await search.fill("finance-api");
		await expect
			.element(page.getByTestId("marketplace-install-workspace-option-workspace-6"))
			.toBeVisible();
	});

	it("offers only destinations where the item is not already installed", async () => {
		const { install } = renderPage({
			...snapshot,
			targets: [
				{ id: "workspace-a", name: "Workspace A", directory: "/tmp/a" },
				{ id: "workspace-b", name: "Workspace B", directory: "/tmp/b" },
			],
			installed: [
				{ type: "agent", id: "reviewer", scope: "workspace", workspaceId: "workspace-a" },
			],
		});

		await openBrowse();
		await expect.element(page.getByTestId("marketplace-install-agent-reviewer")).toBeVisible();
		await expect
			.element(page.getByTestId("marketplace-installed-badge-agent-reviewer"))
			.toBeVisible();
		await page.getByTestId("marketplace-installed-badge-agent-reviewer").hover();
		await expect
			.element(page.getByTestId("marketplace-installed-locations-agent-reviewer"))
			.toHaveTextContent("Installed inWorkspace A");
		await page.getByTestId("marketplace-install-agent-reviewer").click();
		await page.getByTestId("marketplace-install-target").click();
		await page.getByTestId("marketplace-install-workspace-option-workspace-b").click();
		await page.getByTestId("marketplace-install-target").click();
		await page.getByTestId("marketplace-install-confirm").click();

		await expect
			.poll(() => install)
			.toHaveBeenCalledWith({
				item: { type: "agent", id: "reviewer" },
				scope: "workspace",
				workspaceId: "workspace-b",
			});
	});

	it("explains when the All workspaces destination is already installed", async () => {
		renderPage({
			...snapshot,
			installed: [{ type: "skill", id: "notebooks", scope: "global" }],
		});

		await openBrowse();
		await expect
			.element(page.getByTestId("marketplace-installed-badge-skill-notebooks"))
			.toBeVisible();
		await page.getByTestId("marketplace-installed-badge-skill-notebooks").hover();
		await expect
			.element(page.getByTestId("marketplace-installed-locations-skill-notebooks"))
			.toHaveTextContent("Installed inAll workspaces");
		await page.getByTestId("marketplace-install-skill-notebooks").click();

		await expect.element(page.getByTestId("marketplace-install-target")).toHaveTextContent("Demo");
		await page.getByTestId("marketplace-install-target").click();
		await expect.element(page.getByTestId("marketplace-install-scope-global")).toBeDisabled();
		await expect
			.element(page.getByTestId("marketplace-install-scope-global"))
			.toHaveTextContent("All workspacesAlready installed");
	});

	it("explains when the item is installed in every workspace", async () => {
		renderPage({
			...snapshot,
			targets: [
				{ id: "workspace-a", name: "Workspace A", directory: "/tmp/a" },
				{ id: "workspace-b", name: "Workspace B", directory: "/tmp/b" },
			],
			installed: [
				{ type: "agent", id: "reviewer", scope: "workspace", workspaceId: "workspace-a" },
				{ type: "agent", id: "reviewer", scope: "workspace", workspaceId: "workspace-b" },
			],
		});

		await openBrowse();
		await page.getByTestId("marketplace-install-agent-reviewer").click();
		await expect
			.element(page.getByTestId("marketplace-install-target"))
			.toHaveTextContent("All workspaces");
	});

	it("reconciles the install destination when availability changes while open", async () => {
		const initial: MarketplaceSnapshot = {
			...snapshot,
			targets: [
				{ id: "workspace-a", name: "Workspace A", directory: "/tmp/a" },
				{ id: "workspace-b", name: "Workspace B", directory: "/tmp/b" },
			],
		};
		const { client, install, setSnapshot } = renderPage(initial);

		await openBrowse();
		await page.getByTestId("marketplace-install-agent-reviewer").click();
		await expect
			.element(page.getByTestId("marketplace-install-target"))
			.toHaveTextContent("All workspaces");

		setSnapshot({
			...initial,
			targets: [
				...initial.targets,
				{ id: "workspace-c", name: "Workspace C", directory: "/tmp/c" },
			],
			installed: [
				{ type: "agent", id: "reviewer", scope: "global" },
				{ type: "agent", id: "reviewer", scope: "workspace", workspaceId: "workspace-a" },
				{ type: "agent", id: "reviewer", scope: "workspace", workspaceId: "workspace-b" },
			],
		});
		await client.invalidateQueries();

		await expect
			.element(page.getByTestId("marketplace-install-target"))
			.toHaveTextContent("Workspace C");
		await expect.element(page.getByTestId("marketplace-install-confirm")).toBeEnabled();
		await page.getByTestId("marketplace-install-confirm").click();

		await expect
			.poll(() => install)
			.toHaveBeenCalledWith({
				item: { type: "agent", id: "reviewer" },
				scope: "workspace",
				workspaceId: "workspace-c",
			});
	});

	it("installs an MCP into the selected workspace with required parameters", async () => {
		const mcpSnapshot: MarketplaceSnapshot = {
			...snapshot,
			items: [
				{
					type: "mcp",
					id: "docs",
					name: "Docs",
					description: "Searches documentation",
					category: "knowledge",
					url: "https://github.com/example/docs",
					content: [
						{
							name: "npm",
							content: '{"command":"npx","args":["docs"],"env":{"API_KEY":"{{API_KEY}}"}}',
							parameters: [{ name: "API key", key: "API_KEY" }],
							prerequisites: ["Node.js"],
						},
						{
							name: "remote",
							content: '{"url":"https://example.com/mcp"}',
						},
					],
				},
			],
			errors: ["catalog offline"],
			stale: true,
		};
		const { install, openExternal } = renderPage(mcpSnapshot, {
			activeWorkspaceId: "workspace-1",
		});
		await expect.element(page.getByTestId("marketplace-warning")).toBeVisible();

		await openBrowse();
		await page.getByTestId("marketplace-source-mcp-docs").click();
		await expect.poll(() => openExternal).toHaveBeenCalledWith("https://github.com/example/docs");
		await page.getByTestId("marketplace-install-mcp-docs").click();
		await page.getByTestId("marketplace-install-method").click();
		await page.getByRole("option", { name: "remote" }).click();
		await expect.element(page.getByTestId("marketplace-param-API_KEY")).not.toBeInTheDocument();
		await page.getByTestId("marketplace-install-method").click();
		await page.getByRole("option", { name: "npm" }).click();
		await page.getByTestId("marketplace-param-API_KEY").fill("secret");
		await page.getByTestId("marketplace-install-target").click();
		await page.getByTestId("marketplace-install-workspace-option-workspace-1").click();
		await expect.element(page.getByTestId("marketplace-secret-warning")).toBeVisible();
		await page.getByTestId("marketplace-install-target").click();
		await page.getByTestId("marketplace-install-confirm").click();

		await expect
			.poll(() => install)
			.toHaveBeenCalledWith({
				item: { type: "mcp", id: "docs" },
				scope: "workspace",
				workspaceId: "workspace-1",
				method: "npm",
				parameters: { API_KEY: "secret" },
			});
	});

	it("merges item and method MCP parameters with method definitions taking precedence", async () => {
		const { install } = renderPage({
			...snapshot,
			items: [
				{
					type: "mcp",
					id: "docs",
					name: "Docs",
					description: "Searches documentation",
					category: "knowledge",
					url: "https://github.com/example/docs",
					parameters: [
						{ name: "Organization", key: "ORG" },
						{ name: "Default token", key: "TOKEN", optional: true },
					],
					content: [
						{
							name: "npm",
							content: '{"command":"npx","env":{"ORG":"{{ORG}}","TOKEN":"{{TOKEN}}"}}',
							parameters: [{ name: "Access token", key: "TOKEN" }],
						},
					],
				},
			],
		});

		await openBrowse();
		await page.getByTestId("marketplace-install-mcp-docs").click();
		await expect.element(page.getByTestId("marketplace-param-ORG")).toBeVisible();
		await expect.element(page.getByTestId("marketplace-param-TOKEN")).toBeVisible();
		await expect.element(page.getByText("Access token")).toBeVisible();
		await page.getByTestId("marketplace-param-ORG").fill("anaconda");
		await page.getByTestId("marketplace-param-TOKEN").fill("secret");
		await page.getByTestId("marketplace-install-confirm").click();

		await expect
			.poll(() => install)
			.toHaveBeenCalledWith({
				item: { type: "mcp", id: "docs" },
				scope: "global",
				method: "npm",
				parameters: { ORG: "anaconda", TOKEN: "secret" },
			});
	});

	it("scrolls tall MCP configuration while keeping install actions visible", async () => {
		renderPage({
			...snapshot,
			items: [
				{
					type: "mcp",
					id: "configured",
					name: "Configured MCP",
					description: "Requires several configuration values",
					category: "development",
					url: "https://example.com/configured",
					content: [
						{
							name: "local",
							content: '{"command":"npx","args":["configured"]}',
							parameters: Array.from({ length: 12 }, (_, index) => ({
								name: `Configuration ${index + 1}`,
								key: `CONFIG_${index + 1}`,
							})),
						},
					],
				},
			],
		});

		await openBrowse();
		await page.getByTestId("marketplace-install-mcp-configured").click();

		const content = page.getByTestId("marketplace-install-content");
		await expect
			.poll(() => {
				const element = content.element();
				return element.scrollHeight > element.clientHeight;
			})
			.toBe(true);
		const contentElement = content.element();
		contentElement.scrollTo({ top: contentElement.scrollHeight });
		await expect.poll(() => content.element().scrollTop > 0).toBe(true);
		await expect.element(page.getByTestId("marketplace-install-confirm")).toBeVisible();
	});

	it("combines type and category filters while browsing", async () => {
		renderPage({
			...snapshot,
			installed: [{ type: "agent", id: "reviewer", scope: "global" }],
		});

		await openBrowse();
		await expect.element(page.getByTestId("marketplace-item-agent-reviewer")).toBeVisible();
		await page.getByTestId("marketplace-type-agent").click();
		await page.getByTestId("marketplace-type-skill").click();
		await expect.element(page.getByTestId("marketplace-item-skill-notebooks")).toBeVisible();
		await expect.element(page.getByTestId("marketplace-item-agent-reviewer")).toBeVisible();
		await expect
			.element(page.getByTestId("marketplace-type-agent"))
			.toHaveAttribute("aria-pressed", "true");
		await expect
			.element(page.getByTestId("marketplace-type-skill"))
			.toHaveAttribute("aria-pressed", "true");

		await page.getByTestId("marketplace-category-data").click();
		await page.getByTestId("marketplace-category-engineering").click();
		await expect.element(page.getByTestId("marketplace-item-skill-notebooks")).toBeVisible();
		await expect.element(page.getByTestId("marketplace-item-agent-reviewer")).toBeVisible();
		await page.getByTestId("marketplace-category-all").click();
		await expect
			.element(page.getByTestId("marketplace-category-all"))
			.toHaveAttribute("aria-pressed", "true");
		await page.getByTestId("marketplace-type-all").click();
		await expect
			.element(page.getByTestId("marketplace-type-all"))
			.toHaveAttribute("aria-pressed", "true");
		await expect
			.element(page.getByTestId("marketplace-type-agent"))
			.toHaveAttribute("aria-pressed", "false");
		await page.getByTestId("marketplace-type-skill").click();
		await expect.element(page.getByTestId("marketplace-item-skill-notebooks")).toBeVisible();
	});

	it("refreshes the catalog and removes an installation", async () => {
		await page.viewport(1200, 800);
		onTestFinished(() => page.viewport(414, 896));
		const installedSnapshot: MarketplaceSnapshot = {
			...snapshot,
			items: [snapshot.items[1]!],
			installed: [{ type: "skill", id: "notebooks", scope: "global" }],
		};
		const { refresh, remove } = renderPage(installedSnapshot);

		const locationBadge = page.getByTestId("marketplace-card-location-summary-skill-notebooks");
		await expect.element(locationBadge).toBeVisible();
		await expect.element(locationBadge).toHaveTextContent("All workspaces");
		const locationLabel = locationBadge.element().querySelector("span");
		expect(locationLabel?.scrollWidth).toBeLessThanOrEqual(locationLabel?.clientWidth ?? 0);
		await page.getByTestId("marketplace-refresh").click();
		await expect.poll(() => refresh).toHaveBeenCalledWith({});
		await page.getByTestId("marketplace-card-trigger-skill-notebooks").click();
		await page.getByTestId("marketplace-remove-skill-notebooks-global").click();
		await expect.element(page.getByTestId("marketplace-remove-dialog")).toBeVisible();
		await page.getByTestId("marketplace-remove-confirm").click();

		await expect
			.poll(() => remove)
			.toHaveBeenCalledWith({
				item: { type: "skill", id: "notebooks" },
				scope: "global",
			});
	});

	it("groups an item's installed locations into one card with a details panel", async () => {
		const { baseElement, remove } = renderPage({
			...snapshot,
			items: [snapshot.items[0]!],
			targets: [
				{ id: "workspace-a", name: "Workspace A", directory: "/tmp/a" },
				{ id: "workspace-b", name: "Workspace B", directory: "/tmp/b" },
			],
			installed: [
				{ type: "agent", id: "reviewer", scope: "global" },
				{ type: "agent", id: "reviewer", scope: "workspace", workspaceId: "workspace-a" },
				{
					type: "agent",
					id: "reviewer",
					scope: "workspace",
					workspaceId: "workspace-b",
				},
			],
		});

		await expect.poll(() => itemIds(baseElement)).toEqual(["marketplace-item-agent-reviewer"]);
		await expect
			.element(page.getByTestId("marketplace-card-location-summary-agent-reviewer"))
			.toHaveTextContent("3 places");
		const installedCard = baseElement.querySelector<HTMLElement>(
			"[data-qa-id='marketplace-item-agent-reviewer']",
		);
		expect(installedCard).not.toBeNull();
		installedCard!.style.width = "20rem";
		expect(installedCard!.scrollWidth).toBeLessThanOrEqual(installedCard!.clientWidth);
		const trigger = page.getByTestId("marketplace-card-trigger-agent-reviewer");
		const chevron = page.getByTestId("marketplace-card-chevron-agent-reviewer");
		await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
		await expect.element(chevron).toHaveAttribute("aria-expanded", "false");
		await trigger.click();
		await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
		await expect.element(chevron).toHaveAttribute("aria-expanded", "true");
		await expect.element(page.getByTestId("marketplace-card-details-agent-reviewer")).toBeVisible();
		expect(installedCard!.scrollWidth).toBeLessThanOrEqual(installedCard!.clientWidth);
		await trigger.click();
		await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
		await trigger.click();
		await expect
			.element(page.getByTestId("marketplace-installed-in-agent-reviewer-global"))
			.toHaveTextContent("All workspaces");
		await expect
			.element(page.getByTestId("marketplace-installed-in-agent-reviewer-workspace-a"))
			.toHaveTextContent("Workspace A");
		await expect
			.element(page.getByTestId("marketplace-installed-in-agent-reviewer-workspace-b"))
			.toHaveTextContent("Workspace B");
		await expect
			.element(page.getByTestId("marketplace-remove-agent-reviewer-global"))
			.toBeVisible();
		await expect
			.element(page.getByTestId("marketplace-remove-agent-reviewer-workspace-b"))
			.toHaveAccessibleName("Remove Reviewer from Workspace B");
		await page.getByTestId("marketplace-remove-agent-reviewer-workspace-a").click();
		await page.getByTestId("marketplace-remove-confirm").click();

		await expect
			.poll(() => remove)
			.toHaveBeenCalledWith({
				item: { type: "agent", id: "reviewer" },
				scope: "workspace",
				workspaceId: "workspace-a",
			});
	});

	it("adds another install location from the details panel", async () => {
		const { install } = renderPage({
			...snapshot,
			targets: [
				{ id: "workspace-a", name: "Workspace A", directory: "/tmp/a" },
				{ id: "workspace-b", name: "Workspace B", directory: "/tmp/b" },
			],
			installed: [
				{ type: "agent", id: "reviewer", scope: "workspace", workspaceId: "workspace-a" },
			],
		});

		await page.getByTestId("marketplace-card-trigger-agent-reviewer").click();
		await expect
			.element(page.getByTestId("marketplace-card-category-agent-reviewer"))
			.toHaveTextContent("Engineering");
		const addLocation = page.getByTestId("marketplace-add-location-agent-reviewer");
		await expect.element(addLocation).toHaveAccessibleName("Add location");
		await expect.element(addLocation).not.toHaveTextContent("location");
		await page.getByTestId("marketplace-add-location-agent-reviewer").click();
		await expect.element(page.getByTestId("marketplace-install-dialog")).toBeVisible();
		await page.getByTestId("marketplace-install-target").click();
		await expect.element(page.getByTestId("marketplace-install-scope-global")).toBeEnabled();
		await page.getByTestId("marketplace-install-workspace-option-workspace-b").click();
		await page.getByTestId("marketplace-install-target").click();
		await page.getByTestId("marketplace-install-confirm").click();

		await expect
			.poll(() => install)
			.toHaveBeenCalledWith({
				item: { type: "agent", id: "reviewer" },
				scope: "workspace",
				workspaceId: "workspace-b",
			});
	});

	it("hides Install when an item is installed everywhere", async () => {
		renderPage({
			...snapshot,
			targets: [{ id: "workspace-a", name: "Workspace A", directory: "/tmp/a" }],
			installed: [
				{ type: "agent", id: "reviewer", scope: "global" },
				{ type: "agent", id: "reviewer", scope: "workspace", workspaceId: "workspace-a" },
			],
		});

		await page.getByTestId("marketplace-card-trigger-agent-reviewer").click();
		await expect
			.element(page.getByTestId("marketplace-add-location-agent-reviewer"))
			.not.toBeInTheDocument();
	});

	it("signs in each installed MCP location independently", async () => {
		const mcp = {
			type: "mcp" as const,
			id: "github",
			name: "GitHub",
			description: "Connects GitHub tools",
			category: "development",
			url: "https://mcp.example.com",
			content: '{"type":"remote","url":"https://mcp.example.com"}',
		};
		const { authenticateMcp } = renderPage(
			{
				...snapshot,
				items: [mcp],
				installed: [
					{ type: "mcp", id: "github", scope: "global" },
					{ type: "mcp", id: "github", scope: "workspace", workspaceId: "workspace-1" },
				],
				mcpStatuses: { github: { status: "needs_auth" } },
				mcpInstallationStatuses: {
					"github:global": { status: "needs_auth" },
					"github:workspace-1": { status: "needs_auth" },
				},
			},
			{ activeWorkspaceId: "workspace-1" },
		);

		await expect
			.element(page.getByTestId("marketplace-authenticate-mcp-github-global"))
			.not.toBeInTheDocument();
		await page.getByTestId("marketplace-card-trigger-mcp-github").click();
		await expect
			.element(page.getByTestId("marketplace-authenticate-mcp-github-global"))
			.toHaveTextContent("Sign in");
		await expect
			.element(page.getByTestId("marketplace-mcp-auth-needed-github"))
			.toHaveTextContent("Needs sign-in");
		const authBadge = page.getByTestId("marketplace-mcp-auth-needed-github").element();
		const locationBadge = page
			.getByTestId("marketplace-card-location-summary-mcp-github")
			.element();
		expect(
			authBadge.compareDocumentPosition(locationBadge) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		await page.getByTestId("marketplace-authenticate-mcp-github-global").click();
		await expect.poll(() => authenticateMcp).toHaveBeenCalledWith({ id: "github" });
		await page.getByTestId("marketplace-authenticate-mcp-github-workspace-1").click();
		await expect
			.poll(() => authenticateMcp)
			.toHaveBeenCalledWith({ id: "github", workspaceId: "workspace-1" });
	});

	it("falls back to the selected workspace MCP status while scoped statuses load", async () => {
		const mcp = {
			type: "mcp" as const,
			id: "github",
			name: "GitHub",
			description: "Connects GitHub tools",
			category: "development",
			url: "https://mcp.example.com",
			content: '{"type":"remote","url":"https://mcp.example.com"}',
		};
		renderPage(
			{
				...snapshot,
				items: [mcp],
				installed: [{ type: "mcp", id: "github", scope: "workspace", workspaceId: "workspace-1" }],
				mcpStatuses: { github: { status: "needs_auth" } },
				mcpInstallationStatuses: {},
			},
			{ activeWorkspaceId: "workspace-1" },
		);

		await expect
			.element(page.getByTestId("marketplace-mcp-auth-needed-github"))
			.toHaveTextContent("Needs sign-in");
		await page.getByTestId("marketplace-card-trigger-mcp-github").click();
		await expect
			.element(page.getByTestId("marketplace-authenticate-mcp-github-workspace-1"))
			.toHaveTextContent("Sign in");
	});

	it("flags failed and disabled MCP locations and shows the failure reason", async () => {
		const mcp = {
			type: "mcp" as const,
			id: "github",
			name: "GitHub",
			description: "Connects GitHub tools",
			category: "development",
			url: "https://mcp.example.com",
			content: '{"type":"remote","url":"https://mcp.example.com"}',
		};
		renderPage({
			...snapshot,
			items: [mcp],
			installed: [
				{ type: "mcp", id: "github", scope: "global" },
				{ type: "mcp", id: "github", scope: "workspace", workspaceId: "workspace-1" },
			],
			mcpInstallationStatuses: {
				"github:global": { status: "failed", error: "spawn npx ENOENT" },
				"github:workspace-1": { status: "disabled" },
			},
		});

		await expect
			.element(page.getByTestId("marketplace-mcp-failed-github"))
			.toHaveTextContent("Failed");
		await expect
			.element(page.getByTestId("marketplace-mcp-disabled-github"))
			.toHaveTextContent("Disabled");
		await page.getByTestId("marketplace-card-trigger-mcp-github").click();
		await expect
			.element(page.getByTestId("marketplace-mcp-error-github-global"))
			.toHaveTextContent("spawn npx ENOENT");
		await expect
			.element(page.getByTestId("marketplace-mcp-error-github-workspace-1"))
			.not.toBeInTheDocument();
	});

	it("flags an installed MCP that requires client registration", async () => {
		const mcp = {
			type: "mcp" as const,
			id: "github",
			name: "GitHub",
			description: "Connects GitHub tools",
			category: "development",
			url: "https://mcp.example.com",
			content: '{"type":"remote","url":"https://mcp.example.com"}',
		};
		renderPage({
			...snapshot,
			items: [mcp],
			installed: [{ type: "mcp", id: "github", scope: "global" }],
			mcpStatuses: {
				github: { status: "needs_client_registration", error: "Add a client ID." },
			},
			mcpInstallationStatuses: {
				"github:global": { status: "needs_client_registration", error: "Add a client ID." },
			},
		});

		await page.getByTestId("marketplace-card-trigger-mcp-github").click();
		await expect
			.element(page.getByTestId("marketplace-mcp-blocked-mcp-github-global"))
			.toHaveTextContent("Requires setup");
		await expect
			.element(page.getByTestId("marketplace-mcp-error-github-global"))
			.toHaveTextContent("Add a client ID.");
		await expect
			.element(page.getByTestId("marketplace-authenticate-mcp-github-global"))
			.not.toBeInTheDocument();
	});
});
