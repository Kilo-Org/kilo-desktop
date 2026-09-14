import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { condaContract, type CondaService } from "../../../contracts/providers/conda.js";
import { COLUMN_WIDTHS_STORAGE_KEY, MIN_COLUMN_WIDTH } from "./column-widths.js";
import { EnvironmentsPanel } from "./EnvironmentsPanel.js";

const mockEnvironments = [
	{ name: "alpha", prefix: "/opt/conda/envs/alpha" },
	{ name: "bravo", prefix: "/opt/conda/envs/bravo" },
	{ name: "charlie", prefix: "/opt/conda/envs/charlie" },
	{ name: "delta", prefix: "/home/user/envs/delta" },
	{ name: "echo", prefix: "/home/user/envs/echo" },
	{ name: "", prefix: "/opt/conda" },
];

function renderPanel(
	options: {
		list?: CondaService["conda.envs.list"];
		/** Height of the surrounding shell; the real page lives in a bounded scroller. */
		hostHeight?: number;
		/** Width of the surrounding shell, for narrow-window regressions. */
		hostWidth?: number;
	} = {},
) {
	const list = options.list ?? (async () => mockEnvironments);
	const notImpl = async () => {
		throw new Error("not implemented in test");
	};
	const sdk = createFakeSdk({
		featureId: "environments",
		channels: condaContract,
		handlers: {
			"conda.envs.list": list,
			"conda.envs.create": notImpl,
			"conda.envs.clone": notImpl,
			"conda.envs.createFromFile": notImpl,
			"conda.envs.delete": notImpl,
			"conda.envs.pickFile": notImpl,
			"conda.envs.readFile": notImpl,
			"conda.envs.distributions": notImpl,
			"conda.envs.prefixOptions": async () => ({
				envsDirs: ["/opt/anaconda3/envs"],
				channels: ["defaults", "conda-forge"],
			}),
			"conda.packages.list": notImpl,
			"conda.packages.install": notImpl,
			"conda.packages.remove": notImpl,
			"conda.channels.list": notImpl,
			"conda.channels.add": notImpl,
			"conda.channels.remove": notImpl,
			"conda.repodata.find": async () => ({ packages: [], truncated: false }),
			"conda.jobs.cancel": notImpl,
		},
	});
	const system = createFakeFeatureSystem({ sdks: { environments: sdk } });
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	const panel = (
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<EnvironmentsPanel />
			</QueryClientProvider>
		</SdkProvider>
	);

	if (options.hostHeight === undefined && options.hostWidth === undefined) return render(panel);

	return render(
		<div
			style={{
				...(options.hostHeight === undefined ? {} : { height: `${options.hostHeight}px` }),
				...(options.hostWidth === undefined ? {} : { width: `${options.hostWidth}px` }),
				display: "flex",
				flexDirection: "column",
			}}
			data-qa-id="test-shell"
		>
			{panel}
		</div>,
	);
}

afterEach(() => {
	cleanup();
});

describe("EnvironmentsPanel — search, sort, pagination", () => {
	it("renders the table with controls", async () => {
		const { baseElement } = renderPanel();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-controls")).toBeVisible();
		await expect.element(screen.getByTestId("environments-search-input")).toBeVisible();
		await expect.element(screen.getByTestId("environments-sort-toggle")).toBeVisible();
		await expect.element(screen.getByTestId("environments-results-info")).toBeVisible();

		const rows = screen.getByTestId("environments-conda-row");
		await expect.element(rows.first()).toBeVisible();
	});

	it("filters environments by search query (case-insensitive, matches name)", async () => {
		const { baseElement } = renderPanel();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-controls")).toBeVisible();

		const searchInput = screen.getByTestId("environments-search-input");
		await userEvent.fill(searchInput.element(), "ALPHA");

		// Scope to the name column so a prefix that merely contains the query
		// cannot satisfy the assertion.
		await expect.element(screen.getByTestId("environments-conda-name")).toHaveTextContent("alpha");
		expect(screen.getByTestId("environments-conda-row").elements()).toHaveLength(1);
	});

	it("filters environments by search query (matches prefix)", async () => {
		const { baseElement } = renderPanel();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-controls")).toBeVisible();

		const searchInput = screen.getByTestId("environments-search-input");
		await userEvent.fill(searchInput.element(), "/home/user");

		// delta + echo live under /home/user; the other four do not.
		await expect
			.element(screen.getByTestId("environments-conda-name").first())
			.toHaveTextContent("delta");
		expect(screen.getByTestId("environments-conda-row").elements()).toHaveLength(2);
	});

	it("hides the pager and shows the empty message when nothing matches", async () => {
		const { baseElement } = renderPanel();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-controls")).toBeVisible();

		const searchInput = screen.getByTestId("environments-search-input");
		await userEvent.fill(searchInput.element(), "nonexistent");

		await expect.element(screen.getByTestId("environments-conda-empty-filtered")).toBeVisible();
		// A pager over zero results would render a nonsensical "1 – 0 of 0" range.
		await expect.element(screen.getByTestId("environments-pagination")).not.toBeInTheDocument();
	});

	it("sorts environments alphabetically — default ascending, toggle to descending", async () => {
		const { baseElement } = renderPanel();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-controls")).toBeVisible();

		// Default sort is ascending: first name should be "alpha"
		const firstRow = screen.getByTestId("environments-conda-name").first();
		await expect.element(firstRow).toHaveTextContent("alpha");

		// Click the Name column header to toggle sort
		const sortButton = screen.getByTestId("environments-sort-toggle");
		await sortButton.click();

		// Now "echo" should be first (descending)
		const firstRowAfter = screen.getByTestId("environments-conda-name").first();
		await expect.element(firstRowAfter).toHaveTextContent("echo");
	});

	it("handles base environments (empty name) in sorting", async () => {
		const { baseElement } = renderPanel({
			list: async () => [
				{ name: "", prefix: "/opt/anaconda" },
				{ name: "zulu", prefix: "/opt/conda/envs/zulu" },
			],
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-controls")).toBeVisible();

		// Empty name → displays directory basename "anaconda", which sorts before "zulu".
		const firstRow = screen.getByTestId("environments-conda-name").first();
		await expect.element(firstRow).toHaveTextContent("anaconda");
	});

	it("correctly displays an env nested inside another env's prefix", async () => {
		const { baseElement } = renderPanel({
			list: async () => [
				{ name: "", prefix: "/opt/conda" },
				{ name: "dev", prefix: "/opt/conda/envs/dev" },
				{ name: "", prefix: "/opt/conda/envs/dev/nested" },
			],
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-controls")).toBeVisible();

		// All three environments should render with distinct display names.
		const names = screen.getByTestId("environments-conda-name");
		expect(names.elements()).toHaveLength(3);
		// Sorted: "conda" < "dev" < "nested"
		await expect.element(names.first()).toHaveTextContent("conda");
		await expect.element(names.nth(1)).toHaveTextContent("dev");
		await expect.element(names.nth(2)).toHaveTextContent("nested");
	});

	it("shows an accessible spinner while the query is pending", async () => {
		let resolve: ((envs: typeof mockEnvironments) => void) | undefined;
		const pending = new Promise<typeof mockEnvironments>((r) => {
			resolve = r;
		});

		const { baseElement } = renderPanel({ list: () => pending });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-loading")).toBeVisible();
		// The dots are decorative; the status role carries the announcement.
		await expect
			.element(screen.getByRole("status", { name: "Loading environments" }))
			.toBeVisible();

		resolve?.(mockEnvironments);

		// Spinner is torn down once data lands.
		await expect.element(screen.getByTestId("environments-controls")).toBeVisible();
		expect(screen.getByTestId("environments-conda-loading").elements()).toHaveLength(0);
	});

	it("displays the item count", async () => {
		const { baseElement } = renderPanel();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-results-info")).toBeVisible();
		await expect.element(screen.getByText("6 items")).toBeVisible();
	});

	it("shows pagination and navigates pages when items exceed page size", async () => {
		// Create 20 environments to trigger pagination at the default page size of 15
		const manyEnvs = Array.from({ length: 20 }, (_, i) => ({
			name: `env-${String(i).padStart(2, "0")}`,
			prefix: `/opt/conda/envs/env-${String(i).padStart(2, "0")}`,
		}));

		const { baseElement } = renderPanel({ list: async () => manyEnvs });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-pagination")).toBeVisible();
		await expect.element(screen.getByTestId("environments-pagination-next")).toBeVisible();

		// Click next page
		await screen.getByTestId("environments-pagination-next").click();

		// Should now show remaining items (page 2 starts at env-15)
		await expect.element(screen.getByText("env-15")).toBeVisible();
	});
});

describe("EnvironmentsPanel — toolbar and row actions", () => {
	it("renders New environment and Import from file toolbar buttons", async () => {
		const { baseElement } = renderPanel();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-create-btn")).toBeVisible();
		await expect.element(screen.getByTestId("environments-import-btn")).toBeVisible();
	});

	it("opens the Create Environment dialog from the toolbar button", async () => {
		const { baseElement } = renderPanel();
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-create-btn"));
		await expect.element(screen.getByTestId("environments-create-dialog")).toBeVisible();
	});

	it("opens the Import from file dialog from the toolbar button", async () => {
		const { baseElement } = renderPanel();
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-import-btn"));
		await expect.element(screen.getByTestId("environments-import-dialog")).toBeVisible();
	});

	it("shows the row actions menu with Clone for named envs", async () => {
		const { baseElement } = renderPanel();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-controls")).toBeVisible();

		// Click the row actions button for the first named env
		const actionButtons = screen.getByTestId("environments-row-actions");
		await userEvent.click(actionButtons.first());

		await expect.element(screen.getByTestId("environments-row-clone")).toBeVisible();
	});

	it("opens the Clone dialog from the row actions menu", async () => {
		const { baseElement } = renderPanel();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-controls")).toBeVisible();

		const actionButtons = screen.getByTestId("environments-row-actions");
		await userEvent.click(actionButtons.first());
		await userEvent.click(screen.getByTestId("environments-row-clone"));

		await expect.element(screen.getByTestId("environments-clone-dialog")).toBeVisible();
	});

	it("shows 'No actions available' for nameless envs (base or prefix-only)", async () => {
		const { baseElement } = renderPanel({
			list: async () => [{ name: "", prefix: "/opt/conda" }],
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-controls")).toBeVisible();

		const actionButtons = screen.getByTestId("environments-row-actions");
		await userEvent.click(actionButtons.first());

		await expect.element(screen.getByText("No actions available")).toBeVisible();
	});

	it("shows the row actions menu with Delete for named envs", async () => {
		const { baseElement } = renderPanel();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-controls")).toBeVisible();

		const actionButtons = screen.getByTestId("environments-row-actions");
		await userEvent.click(actionButtons.first());

		await expect.element(screen.getByTestId("environments-row-delete")).toBeVisible();
	});

	it("opens the Delete dialog from the row actions menu", async () => {
		const { baseElement } = renderPanel();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-controls")).toBeVisible();

		const actionButtons = screen.getByTestId("environments-row-actions");
		await userEvent.click(actionButtons.first());
		await userEvent.click(screen.getByTestId("environments-row-delete"));

		await expect.element(screen.getByTestId("environments-delete-dialog")).toBeVisible();
	});
});

/** Drives the pointer sequence a real drag produces, which userEvent cannot express. */
function dragHandle(handle: Element, deltaX: number) {
	const startX = 400;
	handle.dispatchEvent(
		new PointerEvent("pointerdown", { bubbles: true, clientX: startX, pointerId: 1 }),
	);
	window.dispatchEvent(
		new PointerEvent("pointermove", { bubbles: true, clientX: startX + deltaX, pointerId: 1 }),
	);
	window.dispatchEvent(
		new PointerEvent("pointerup", { bubbles: true, clientX: startX + deltaX, pointerId: 1 }),
	);
}

describe("EnvironmentsPanel — resizable columns", () => {
	afterEach(() => {
		localStorage.removeItem(COLUMN_WIDTHS_STORAGE_KEY);
	});

	it("widens the Name column when its handle is dragged right", async () => {
		const { baseElement } = renderPanel({ hostWidth: 900 });
		const screen = page.elementLocator(baseElement);
		const handle = screen.getByTestId("environments-column-resizer-name");

		await expect.element(handle).toBeVisible();
		dragHandle(handle.element(), 60);

		// Name starts at its 240px default, so a 60px drag lands on 300px.
		await expect.element(handle).toHaveAttribute("aria-valuenow", "300");
	});

	it("narrows a column from the keyboard with the arrow keys", async () => {
		const { baseElement } = renderPanel({ hostWidth: 900 });
		const screen = page.elementLocator(baseElement);
		const handle = screen.getByTestId("environments-column-resizer-name");

		await expect.element(handle).toBeVisible();
		await userEvent.click(handle);
		await userEvent.keyboard("{ArrowLeft}");

		// Name starts at its 240px default and steps by 16px per keypress.
		await expect.element(handle).toHaveAttribute("aria-valuenow", "224");
	});

	it("keeps a resized column after the panel is remounted", async () => {
		const first = renderPanel({ hostWidth: 900 });
		const firstHandle = page
			.elementLocator(first.baseElement)
			.getByTestId("environments-column-resizer-name");

		await expect.element(firstHandle).toBeVisible();
		dragHandle(firstHandle.element(), 60);
		await expect.element(firstHandle).toHaveAttribute("aria-valuenow", "300");

		cleanup();
		const second = renderPanel({ hostWidth: 900 });
		const secondHandle = page
			.elementLocator(second.baseElement)
			.getByTestId("environments-column-resizer-name");

		await expect.element(secondHandle).toHaveAttribute("aria-valuenow", "300");
	});

	it("refuses to collapse a column below its minimum width", async () => {
		const { baseElement } = renderPanel({ hostWidth: 900 });
		const screen = page.elementLocator(baseElement);
		const handle = screen.getByTestId("environments-column-resizer-name");

		await expect.element(handle).toBeVisible();
		dragHandle(handle.element(), -400);

		await expect.element(handle).toHaveAttribute("aria-valuenow", String(MIN_COLUMN_WIDTH));
	});
});

describe("EnvironmentsPanel — sticky chrome", () => {
	const manyEnvironments = Array.from({ length: 15 }, (_, index) => ({
		name: `env-${String(index).padStart(2, "0")}`,
		prefix: `/opt/conda/envs/env-${index}`,
	}));

	it("scrolls the environment list while the toolbar and column headers stay put", async () => {
		const { baseElement } = renderPanel({
			list: async () => manyEnvironments,
			hostHeight: 360,
		});
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-controls")).toBeVisible();
		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();

		const table = baseElement.querySelector("table")!;
		const scroller = table.parentElement!;
		const search = baseElement.querySelector('[data-qa-id="environments-search-input"]')!;
		const columnHeader = baseElement.querySelector("thead")!;

		// The list must be the thing that overflows, not the page around it.
		expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);

		const searchBefore = search.getBoundingClientRect().top;
		const headerBefore = columnHeader.getBoundingClientRect().top;
		const firstRowBefore = baseElement
			.querySelector('[data-qa-id="environments-conda-row"]')!
			.getBoundingClientRect().top;

		scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
		await vi.waitFor(() => {
			expect(scroller.scrollTop).toBeGreaterThan(0);
		});

		const firstRowAfter = baseElement
			.querySelector('[data-qa-id="environments-conda-row"]')!
			.getBoundingClientRect().top;

		expect(search.getBoundingClientRect().top).toBeCloseTo(searchBefore, 0);
		expect(columnHeader.getBoundingClientRect().top).toBeCloseTo(headerBefore, 0);
		expect(firstRowAfter).toBeLessThan(firstRowBefore);
	});
});

describe("EnvironmentsPanel — list height", () => {
	it("sizes the list to its rows instead of filling the available space", async () => {
		const { baseElement } = renderPanel({
			list: async () => [{ name: "solo", prefix: "/opt/conda/envs/solo" }],
			hostHeight: 600,
		});
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();

		const table = baseElement.querySelector("table")!;
		const scroller = table.parentElement!;
		const scrollerHeight = scroller.getBoundingClientRect().height;
		const tableHeight = table.getBoundingClientRect().height;

		// A single row must not be stretched down the page; the border accounts for
		// the couple of pixels of slack.
		expect(scrollerHeight - tableHeight).toBeLessThanOrEqual(4);
		expect(scrollerHeight).toBeLessThan(200);
	});
});

describe("EnvironmentsPanel — narrow containers", () => {
	it("never scrolls horizontally when the window is narrow", async () => {
		const { baseElement } = renderPanel({ hostHeight: 420, hostWidth: 360 });
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();

		const scroller = baseElement.querySelector("table")!.parentElement!;

		expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth + 1);
	});
});
