import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { CondaClient } from "../../conda";
import { renderWithConda, type EnvironmentsHostOptions } from "../../../test/environments-host";
import { EnvironmentsPanel } from "./EnvironmentsPanel";

const mockEnvironments = [
	{ name: "alpha", prefix: "/opt/conda/envs/alpha" },
	{ name: "bravo", prefix: "/opt/conda/envs/bravo" },
	{ name: "charlie", prefix: "/opt/conda/envs/charlie" },
	{ name: "delta", prefix: "/home/user/envs/delta" },
	{ name: "echo", prefix: "/home/user/envs/echo" },
	{ name: "", prefix: "/opt/conda" },
];

async function renderPanel(
	options: {
		list?: CondaClient["listEnvironments"];
		/** Height of the surrounding shell; the real page lives in a bounded scroller. */
		hostHeight?: number;
		/** Width of the surrounding shell, for narrow-window regressions. */
		hostWidth?: number;
		navigate?: EnvironmentsHostOptions["navigate"];
		followNavigation?: boolean;
		/** Shell location search params, e.g. `{ env }` for a deep link. */
		search?: Record<string, string>;
	} = {},
) {
	const list = options.list ?? (async () => mockEnvironments);
	const notImpl = async () => {
		throw new Error("not implemented in test");
	};
	const hostOptions: EnvironmentsHostOptions = {
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
		...(options.search ? { search: options.search } : {}),
		...(options.navigate ? { navigate: options.navigate } : {}),
		...(options.followNavigation === false ? { followNavigation: false } : {}),
	};

	const panel = (
		<>
			<EnvironmentsPanel />
		</>
	);

	if (options.hostHeight === undefined && options.hostWidth === undefined) {
		return renderWithConda(panel, hostOptions);
	}

	return renderWithConda(
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
		hostOptions,
	);
}

afterEach(() => {
	cleanup();
});

describe("EnvironmentsPanel — search and sort", () => {
	it("renders the list with its toolbar", async () => {
		const { baseElement } = await renderPanel();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-controls")).toBeVisible();
		await expect.element(screen.getByTestId("environments-search-input")).toBeVisible();
		await expect
			.element(screen.getByTestId("environments-search-input"))
			.toHaveAttribute("placeholder", "Search environments");
		await expect.element(screen.getByTestId("environments-sort-menu")).toBeVisible();

		const rows = screen.getByTestId("environments-conda-row");
		await expect.element(rows.first()).toBeVisible();
		expect(rows.elements()).toHaveLength(mockEnvironments.length);
	});

	it("filters environments by search query (case-insensitive, matches name)", async () => {
		const { baseElement } = await renderPanel();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();

		await userEvent.fill(screen.getByTestId("environments-search-input").element(), "ALPHA");

		// Scope to the name so a prefix that merely contains the query cannot
		// satisfy the assertion.
		await expect.element(screen.getByTestId("environments-conda-name")).toHaveTextContent("alpha");
		expect(screen.getByTestId("environments-conda-row").elements()).toHaveLength(1);
	});

	it("filters environments by search query (matches prefix)", async () => {
		const { baseElement } = await renderPanel();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();

		await userEvent.fill(screen.getByTestId("environments-search-input").element(), "/home/user");

		// delta + echo live under /home/user; the other four do not.
		await expect
			.element(screen.getByTestId("environments-conda-name").first())
			.toHaveTextContent("delta");
		expect(screen.getByTestId("environments-conda-row").elements()).toHaveLength(2);
	});

	it("shows an empty state with a way back when nothing matches", async () => {
		const { baseElement } = await renderPanel();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();
		await userEvent.fill(screen.getByTestId("environments-search-input").element(), "nonexistent");

		await expect.element(screen.getByTestId("environments-conda-empty-filtered")).toBeVisible();
		await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
		expect(screen.getByTestId("environments-conda-row").elements()).toHaveLength(
			mockEnvironments.length,
		);
	});

	it("sorts by name ascending by default and descending from the sort menu", async () => {
		const { baseElement } = await renderPanel();
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("environments-conda-name").first())
			.toHaveTextContent("alpha");

		await userEvent.click(screen.getByTestId("environments-sort-menu"));
		await userEvent.click(screen.getByRole("menuitem", { name: /^Order/ }));
		await userEvent.click(screen.getByRole("menuitemradio", { name: "Descending" }));

		await expect
			.element(screen.getByTestId("environments-conda-name").first())
			.toHaveTextContent("echo");
	});

	it("sorts by location from the sort menu", async () => {
		const { baseElement } = await renderPanel();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();
		await userEvent.click(screen.getByTestId("environments-sort-menu"));
		await userEvent.click(screen.getByRole("menuitem", { name: /Sort by/ }));
		await userEvent.click(screen.getByRole("menuitemradio", { name: "Location" }));

		// "/home/user/envs/delta" sorts before every "/opt/…" prefix.
		await expect
			.element(screen.getByTestId("environments-conda-name").first())
			.toHaveTextContent("delta");
	});

	it("handles base environments (empty name) in sorting", async () => {
		const { baseElement } = await renderPanel({
			list: async () => [
				{ name: "", prefix: "/opt/anaconda" },
				{ name: "zulu", prefix: "/opt/conda/envs/zulu" },
			],
		});
		const screen = page.elementLocator(baseElement);

		// Empty name → displays directory basename "anaconda", which sorts before "zulu".
		await expect
			.element(screen.getByTestId("environments-conda-name").first())
			.toHaveTextContent("anaconda");
	});

	it("correctly displays an env nested inside another env's prefix", async () => {
		const { baseElement } = await renderPanel({
			list: async () => [
				{ name: "", prefix: "/opt/conda" },
				{ name: "dev", prefix: "/opt/conda/envs/dev" },
				{ name: "", prefix: "/opt/conda/envs/dev/nested" },
			],
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-name").first()).toBeVisible();

		// All three environments render with distinct display names.
		const names = screen.getByTestId("environments-conda-name");
		expect(names.elements()).toHaveLength(3);
		// Sorted: "conda" < "dev" < "nested"
		await expect.element(names.first()).toHaveTextContent("conda");
		await expect.element(names.nth(1)).toHaveTextContent("dev");
		await expect.element(names.nth(2)).toHaveTextContent("nested");
	});

	it("shows an accessible loading skeleton while the query is pending", async () => {
		let resolve: ((envs: typeof mockEnvironments) => void) | undefined;
		const pending = new Promise<typeof mockEnvironments>((r) => {
			resolve = r;
		});

		const { baseElement } = await renderPanel({ list: () => pending });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-loading")).toBeVisible();
		// The placeholder shapes are decorative; the status role carries the announcement.
		await expect
			.element(screen.getByRole("status", { name: "Loading environments" }))
			.toBeVisible();

		resolve?.(mockEnvironments);

		// Skeleton is torn down once data lands.
		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();
		expect(screen.getByTestId("environments-conda-loading").elements()).toHaveLength(0);
	});

	it("shows the detail loading state, not the list, while a linked environment loads", async () => {
		const { baseElement } = await renderPanel({
			list: () => new Promise(() => {}),
			search: { env: "/opt/conda/envs/alpha" },
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("status", { name: "Loading packages" })).toBeVisible();
		await expect
			.element(screen.getByTestId("environments-conda-detail-name"))
			.toHaveTextContent("alpha");
		expect(screen.getByTestId("environments-conda-loading").elements()).toHaveLength(0);
		expect(screen.getByTestId("environments-new-menu").elements()).toHaveLength(0);
	});

	it("goes back to the list from the linked environment's loading state", async () => {
		const navigate = vi.fn();
		const { baseElement } = await renderPanel({
			list: () => new Promise(() => {}),
			search: { env: "/opt/conda/envs/alpha" },
			navigate,
		});
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByRole("button", { name: "Back to environments" }));
		expect(navigate).toHaveBeenCalledWith("/settings/environments", { search: {} });
	});

	it("renders every environment without pagination", async () => {
		const manyEnvs = Array.from({ length: 40 }, (_, i) => ({
			name: `env-${String(i).padStart(2, "0")}`,
			prefix: `/opt/conda/envs/env-${String(i).padStart(2, "0")}`,
		}));

		const { baseElement } = await renderPanel({ list: async () => manyEnvs });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();
		expect(screen.getByTestId("environments-conda-row").elements()).toHaveLength(40);
	});

	it("offers a retry with friendly copy when the list fails to load", async () => {
		let calls = 0;
		const { baseElement } = await renderPanel({
			list: async () => {
				calls += 1;
				if (calls === 1) throw new Error("SOLVE_FAILED: numpy vs pandas conflict");
				return mockEnvironments;
			},
		});
		const screen = page.elementLocator(baseElement);

		const state = screen.getByTestId("environments-conda-error");
		await expect.element(state).toBeVisible();
		// Curated copy, not the raw KernelError internals.
		await expect.element(state).not.toHaveTextContent("SOLVE_FAILED");

		await userEvent.click(screen.getByTestId("environments-conda-error-retry"));
		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();
	});

	it("shows the backend-starting state (not an error) while the backend is not ready, and clears on recovery", async () => {
		let calls = 0;
		const { baseElement } = await renderPanel({
			list: async () => {
				calls += 1;
				if (calls === 1) {
					throw new Error(
						"PROVIDER_NOT_READY: anaconda-bridge-sidecar error: Pending response rejected since connection got disposed",
					);
				}
				return mockEnvironments;
			},
		});
		const screen = page.elementLocator(baseElement);

		// Transient warm-up reads as "starting", not a hard error.
		await expect.element(screen.getByTestId("environments-conda-starting")).toBeVisible();
		expect(screen.getByTestId("environments-conda-error").elements()).toHaveLength(0);
		// No opaque plumbing jargon leaks into the copy.
		await expect
			.element(screen.getByTestId("environments-conda-starting"))
			.not.toHaveTextContent("connection got disposed");

		// The 3s poll re-reads and clears the state once the backend comes up.
		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();
	});

	it("holds the backend-starting state across a failing poll cycle (no skeleton/error flicker)", async () => {
		// Regression: TanStack flips a still-empty query back to pending/error:null
		// at the start of each background refetch. The starting state must survive
		// that transient so the 120s window accumulates and the UI does not flicker.
		let calls = 0;
		const { baseElement } = await renderPanel({
			list: async () => {
				calls += 1;
				throw new Error("PROVIDER_NOT_READY: anaconda-bridge-sidecar error: still starting");
			},
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-starting")).toBeVisible();
		const firstCalls = calls;

		// Wait out at least one 3s poll (which also fails) and confirm the panel
		// stays in the starting state — never the skeleton or the error state.
		await vi.waitFor(() => expect(calls).toBeGreaterThan(firstCalls), { timeout: 6_000 });
		await expect.element(screen.getByTestId("environments-conda-starting")).toBeVisible();
		expect(screen.getByTestId("environments-conda-loading").elements()).toHaveLength(0);
		expect(screen.getByTestId("environments-conda-error").elements()).toHaveLength(0);
	});

	it("keeps the header actions available when there are no environments", async () => {
		const { baseElement } = await renderPanel({ list: async () => [] });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-empty")).toBeVisible();
		await expect.element(screen.getByTestId("environments-new-menu")).toBeVisible();
	});
});

describe("EnvironmentsPanel — header and row actions", () => {
	it("offers Create new and Import file in the New environment menu", async () => {
		const { baseElement } = await renderPanel();
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByRole("button", { name: "New environment" }));

		await expect.element(screen.getByRole("menuitem", { name: "Create new" })).toBeVisible();
		await expect.element(screen.getByRole("menuitem", { name: "Import file" })).toBeVisible();
	});

	it("opens the Create environment dialog from the New environment menu", async () => {
		const { baseElement } = await renderPanel();
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-new-menu"));
		await userEvent.click(screen.getByTestId("environments-create-item"));
		await expect.element(screen.getByTestId("environments-create-dialog")).toBeVisible();
	});

	it("opens the Import from file dialog from the New environment menu", async () => {
		const { baseElement } = await renderPanel();
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-new-menu"));
		await userEvent.click(screen.getByTestId("environments-import-item"));
		await expect.element(screen.getByTestId("environments-import-dialog")).toBeVisible();
	});

	it("opens the Clone dialog from the row actions menu", async () => {
		const { baseElement } = await renderPanel();
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-row-actions").first());
		await userEvent.click(screen.getByTestId("environments-row-clone"));

		await expect.element(screen.getByTestId("environments-clone-dialog")).toBeVisible();
	});

	it("opens the Delete confirmation from the row actions menu", async () => {
		const { baseElement } = await renderPanel();
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-row-actions").first());
		await userEvent.click(screen.getByTestId("environments-row-delete"));

		await expect.element(screen.getByTestId("environments-delete-dialog")).toBeVisible();
	});

	it("offers no row actions for nameless envs (base or prefix-only)", async () => {
		const { baseElement } = await renderPanel({
			list: async () => [{ name: "", prefix: "/opt/conda" }],
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-row")).toBeVisible();
		expect(screen.getByTestId("environments-row-actions").elements()).toHaveLength(0);
	});
});

describe("EnvironmentsPanel — scrolling", () => {
	const manyEnvironments = Array.from({ length: 15 }, (_, index) => ({
		name: `env-${String(index).padStart(2, "0")}`,
		prefix: `/opt/conda/envs/env-${index}`,
	}));

	it("does not trap scroll on the environment list", async () => {
		const { baseElement } = await renderPanel({
			list: async () => manyEnvironments,
			hostHeight: 360,
		});
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();

		const list = baseElement.querySelector('[data-qa-id="environments-conda-list"]')!;
		expect(list.scrollHeight).toBeLessThanOrEqual(list.clientHeight + 1);
	});

	it("sizes the list to its rows instead of filling the available space", async () => {
		const { baseElement } = await renderPanel({
			list: async () => [{ name: "solo", prefix: "/opt/conda/envs/solo" }],
			hostHeight: 600,
		});
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();

		const list = baseElement.querySelector('[data-qa-id="environments-conda-list"]')!;
		expect(list.getBoundingClientRect().height).toBeLessThan(120);
	});

	it("never scrolls horizontally when the window is narrow", async () => {
		const { baseElement } = await renderPanel({ hostHeight: 420, hostWidth: 360 });
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-conda-row").first()).toBeVisible();

		const list = baseElement.querySelector('[data-qa-id="environments-conda-list"]')!;
		expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth + 1);
	});
});

describe("EnvironmentsPanel — row navigation", () => {
	it("opens an environment from anywhere on its row except the actions menu", async () => {
		const navigate = vi.fn();
		const { baseElement } = await renderPanel({ navigate, followNavigation: false });
		const screen = page.elementLocator(baseElement);
		const row = screen.getByTestId("environments-conda-row").first();
		await expect.element(row).toBeVisible();

		const { width, height } = row.element().getBoundingClientRect();
		await row.click({ position: { x: 2, y: 2 } });
		await row.click({ position: { x: width - 45, y: height - 2 } });
		expect(navigate).toHaveBeenCalledTimes(2);
		expect(navigate).toHaveBeenLastCalledWith("/settings/environments", {
			search: { env: "/opt/conda/envs/alpha" },
		});

		await row.getByRole("button", { name: "Actions for alpha" }).click();
		await expect.element(page.getByTestId("environments-row-clone")).toBeVisible();
		expect(navigate).toHaveBeenCalledTimes(2);
	});
});
