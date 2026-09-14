import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import {
	condaContract,
	type CondaEnv,
	type CondaPackage,
	type CondaPackagesListResult,
	type CondaRepodataPackage,
	type CondaService,
} from "../../../contracts/providers/conda.js";
import { PACKAGE_TABLE_COLUMN_WIDTHS_STORAGE_KEY } from "./column-widths.js";
import { EnvironmentDetail } from "./EnvironmentDetail.js";

const MOCK_ENV: CondaEnv = { name: "dev", prefix: "/opt/conda/envs/dev" };

const MOCK_PACKAGES: CondaPackage[] = [
	{ name: "numpy", version: "2.5.1", build: "py311_0", channel: "defaults" },
	{ name: "pandas", version: "3.0.3", build: "py311_0", channel: "conda-forge" },
	{ name: "matplotlib", version: "3.11.0", build: "py311_0", channel: "defaults" },
	{ name: "seaborn", version: "0.13.2", build: "py311_0", channel: "conda-forge" },
	{ name: "jupyter", version: "1.1.1", build: "py311_0", channel: "defaults" },
	{ name: "scikit-learn", version: "1.5.0", build: "py311_0", channel: "defaults" },
	{ name: "scipy", version: "1.14.0", build: "py311_0", channel: "defaults" },
	{ name: "requests", version: "2.32.3", build: "pypi_0", channel: "pypi" },
];

interface HandlerOverrides {
	packagesList?: CondaService["conda.packages.list"];
	packagesInstall?: CondaService["conda.packages.install"];
	packagesRemove?: CondaService["conda.packages.remove"];
	packagesUpdate?: CondaService["conda.packages.update"];
	channelsList?: CondaService["conda.channels.list"];
	repodataFind?: CondaService["conda.repodata.find"];
	prefixOptions?: CondaService["conda.envs.prefixOptions"];
}

function defaultHandlers(
	overrides?: HandlerOverrides | CondaService["conda.packages.list"],
): Record<string, (...args: never[]) => Promise<unknown>> {
	// Support legacy call signature: single function = packagesListHandler
	const opts: HandlerOverrides =
		typeof overrides === "function" ? { packagesList: overrides } : (overrides ?? {});

	return {
		"conda.envs.list": async () => [],
		"conda.envs.create": async () => {
			throw new Error("not implemented in test");
		},
		"conda.envs.delete": async () => {
			throw new Error("not implemented in test");
		},
		"conda.packages.list":
			opts.packagesList ??
			(async (): Promise<CondaPackagesListResult> => ({
				envName: "dev",
				packages: MOCK_PACKAGES,
			})),
		"conda.packages.install":
			opts.packagesInstall ??
			(async () => {
				throw new Error("not implemented in test");
			}),
		"conda.packages.remove":
			opts.packagesRemove ??
			(async () => {
				throw new Error("not implemented in test");
			}),
		"conda.packages.update":
			opts.packagesUpdate ??
			(async () => {
				throw new Error("not implemented in test");
			}),
		"conda.channels.list": opts.channelsList ?? (async () => ["defaults", "conda-forge"]),
		"conda.repodata.find":
			opts.repodataFind ??
			(async () => {
				throw new Error("not implemented in test");
			}),
		"conda.envs.prefixOptions":
			opts.prefixOptions ??
			(async () => {
				throw new Error("not implemented in test");
			}),
		"conda.channels.add": async () => {
			throw new Error("not implemented in test");
		},
		"conda.channels.remove": async () => {
			throw new Error("not implemented in test");
		},
		"conda.jobs.cancel": async () => {
			throw new Error("not implemented in test");
		},
	};
}

function renderDetail(
	options: {
		env?: CondaEnv;
		onBack?: () => void;
		packagesList?: CondaService["conda.packages.list"];
		/** Height of the surrounding shell; the detail view lives in a bounded column. */
		hostHeight?: number;
		/** Width of the surrounding shell, for narrow-window regressions. */
		hostWidth?: number;
		handlers?: HandlerOverrides;
	} = {},
) {
	const env = options.env ?? MOCK_ENV;
	const onBack = options.onBack ?? (() => {});
	const handlerOverrides: HandlerOverrides = {
		...options.handlers,
		...(options.packagesList ? { packagesList: options.packagesList } : {}),
	};
	const sdk = createFakeSdk({
		featureId: "environments",
		channels: condaContract,
		handlers: defaultHandlers(handlerOverrides),
	});
	const system = createFakeFeatureSystem({ sdks: { environments: sdk } });
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	const detail = (
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<EnvironmentDetail env={env} onBack={onBack} />
			</QueryClientProvider>
		</SdkProvider>
	);

	if (options.hostHeight === undefined && options.hostWidth === undefined) return render(detail);

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
			{detail}
		</div>,
	);
}

afterEach(() => {
	cleanup();
});

describe("EnvironmentDetail", () => {
	it("renders the environment name and prefix", async () => {
		const { baseElement } = renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("environments-conda-detail-name"))
			.toHaveTextContent("dev");
		await expect
			.element(screen.getByTestId("environments-conda-detail-prefix"))
			.toHaveTextContent("/opt/conda/envs/dev");
	});

	it("renders directory basename as the name when env.name is empty", async () => {
		const { baseElement } = renderDetail({
			env: { name: "", prefix: "/opt/conda" },
		});
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("environments-conda-detail-name"))
			.toHaveTextContent("conda");
	});

	it("shows a loading state before packages resolve", async () => {
		let resolve: ((result: CondaPackagesListResult) => void) | undefined;
		const pending = new Promise<CondaPackagesListResult>((r) => {
			resolve = r;
		});
		const { baseElement } = renderDetail({
			packagesList: () => pending,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-loading")).toBeVisible();
		resolve?.({ envName: "dev", packages: [] });
	});

	it("renders a table of packages after loading", async () => {
		const { baseElement } = renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();
		// Default page size is 20; our mock has 7 packages so all should render
		expect(
			baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-row"]').length,
		).toBe(8);
	});

	it("displays pagination info showing total items", async () => {
		const { baseElement } = renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-pagination")).toBeVisible();
		await expect.element(screen.getByText("1 – 8 of 8 items")).toBeVisible();
	});

	it("surfaces backend errors", async () => {
		const { baseElement } = renderDetail({
			packagesList: async () => {
				throw new Error("connection failed");
			},
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-error")).toBeVisible();
		await expect.element(screen.getByText(/could not load packages/i)).toBeVisible();
	});

	it("shows empty state when no packages are installed", async () => {
		const { baseElement } = renderDetail({
			packagesList: async () => ({ envName: "dev", packages: [] }),
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-empty")).toBeVisible();
		await expect.element(screen.getByText(/no packages installed/i)).toBeVisible();
	});

	it("filters packages by search query", async () => {
		const { baseElement } = renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		const searchInput = screen.getByTestId("environments-conda-detail-search");
		await searchInput.fill("num");

		// Only "numpy" should match
		expect(
			baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-row"]').length,
		).toBe(1);
		await expect.element(screen.getByText("numpy")).toBeVisible();
	});

	it("shows no-match message when search yields no results", async () => {
		const { baseElement } = renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		const searchInput = screen.getByTestId("environments-conda-detail-search");
		await searchInput.fill("nonexistentpackage");

		await expect.element(screen.getByTestId("environments-conda-detail-empty")).toBeVisible();
	});

	it("renders back button and action buttons", async () => {
		const { baseElement } = renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-back")).toBeVisible();
		await expect.element(screen.getByTestId("environments-conda-detail-add-pkg")).toBeVisible();
	});

	it("navigates pages when there are more packages than page size", async () => {
		const manyPackages: CondaPackage[] = Array.from({ length: 45 }, (_, i) => ({
			name: `pkg-${String(i).padStart(3, "0")}`,
			version: "1.0.0",
			build: "py311_0",
			channel: "defaults",
		}));
		const { baseElement } = renderDetail({
			packagesList: async () => ({ envName: "dev", packages: manyPackages }),
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();
		await expect.element(screen.getByText("1 – 20 of 45 items")).toBeVisible();

		const pager = screen.getByTestId("environments-conda-detail-pagination");

		await screen.getByTestId("environments-conda-detail-pagination-next").click();
		await expect.element(screen.getByText("21 – 40 of 45 items")).toBeVisible();

		// The last page is reached by its number: the shared pager offers no
		// first/last jump, relying on numbered pages and ellipsis instead.
		await pager.getByText("3", { exact: true }).click();
		await expect.element(screen.getByText("41 – 45 of 45 items")).toBeVisible();

		await screen.getByTestId("environments-conda-detail-pagination-prev").click();
		await expect.element(screen.getByText("21 – 40 of 45 items")).toBeVisible();
	});

	it("sorts packages by version when version header is clicked", async () => {
		const { baseElement } = renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		// Click version header to sort by version ascending
		const versionButton = screen.getByRole("button", { name: /version/i });
		await versionButton.click();

		// Extract displayed versions and verify ascending order
		// Column indices: 0=checkbox, 1=name, 2=version, 3=source, 4=actions
		const rows = baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-row"]');
		const versions = Array.from(rows).map(
			(row) => row.querySelectorAll("td")[2]?.textContent ?? "",
		);
		const sortedVersions = [...versions].sort((a, b) => a.localeCompare(b));
		expect(versions).toEqual(sortedVersions);
	});

	it("shows conda badge for conda packages and pip badge for pypi packages", async () => {
		const { baseElement } = renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		const badges = baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-source"]');
		const labels = Array.from(badges).map((b) => b.textContent?.trim());

		// The mock data has 7 conda packages and 1 pip package
		expect(labels.filter((l) => l === "conda")).toHaveLength(7);
		expect(labels.filter((l) => l === "pip")).toHaveLength(1);
	});

	it("sorts packages by source when the Source header is clicked", async () => {
		const { baseElement } = renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		// Click source header to sort by source ascending (conda before pip)
		const sourceButton = screen.getByRole("button", { name: /source/i });
		await sourceButton.click();

		const badges = baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-source"]');
		const labels = Array.from(badges).map((b) => b.textContent?.trim());

		// All conda packages should appear before pip packages in ascending order
		const firstPipIndex = labels.indexOf("pip");
		const lastCondaIndex = labels.lastIndexOf("conda");
		expect(lastCondaIndex).toBeLessThan(firstPipIndex);
	});

	it("toggles sort direction when clicking the same column header again", async () => {
		const { baseElement } = renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		// Default sort is name ascending. Clicking the name header toggles to descending.
		const nameButton = screen.getByRole("columnheader", { name: /package/i }).getByRole("button");
		await nameButton.click();

		// Extract names and verify descending order
		// Column indices: 0=checkbox, 1=name, 2=version, 3=source, 4=actions
		const rows = baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-row"]');
		const names = Array.from(rows).map((row) => row.querySelectorAll("td")[1]?.textContent ?? "");
		const sortedDesc = [...names].sort((a, b) => b.localeCompare(a));
		expect(names).toEqual(sortedDesc);
	});

	it("Add Package button opens the add package dialog", async () => {
		const { baseElement } = renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		const addBtn = screen.getByTestId("environments-conda-detail-add-pkg");
		await addBtn.click();

		await expect.element(screen.getByTestId("environments-conda-add-pkg-dialog")).toBeVisible();
		await expect.element(screen.getByText(/Add Packages to/)).toBeVisible();
		await expect.element(screen.getByTestId("environments-conda-add-pkg-search")).toBeVisible();
	});

	it("Add Package dialog greys out installed packages and shows the installed version", async () => {
		const repodataPackages: CondaRepodataPackage[] = [
			{
				name: "numpy",
				version: "2.6.0",
				build: 0,
				channel: "conda-forge",
				summary: "",
				home: "",
				versions: [{ version: "2.6.0", size: 1024 }],
			},
			{
				name: "brand-new-pkg",
				version: "1.0.0",
				build: 0,
				channel: "conda-forge",
				summary: "",
				home: "",
				versions: [{ version: "1.0.0", size: 512 }],
			},
		];
		const { baseElement } = renderDetail({
			handlers: {
				repodataFind: async () => ({ packages: repodataPackages, truncated: false }),
				prefixOptions: async () => ({ envsDirs: ["/opt/conda/envs"], channels: ["conda-forge"] }),
			},
		});
		const screen = page.elementLocator(baseElement);

		const addBtn = screen.getByTestId("environments-conda-detail-add-pkg");
		await addBtn.click();
		await expect.element(screen.getByTestId("environments-conda-add-pkg-dialog")).toBeVisible();

		// Wait for the debounced repodata search to populate the grid.
		await expect.element(screen.getByText("brand-new-pkg")).toBeVisible();

		const rows = Array.from(
			baseElement.querySelectorAll<HTMLElement>('[data-qa-id="environments-conda-add-pkg-row"]'),
		);
		const numpyRow = rows.find((row) => row.textContent?.includes("numpy"));
		const newRow = rows.find((row) => row.textContent?.includes("brand-new-pkg"));
		expect(numpyRow).toBeDefined();
		expect(newRow).toBeDefined();

		// numpy is installed (2.5.1): greyed out, not selectable, installed version shown.
		expect(numpyRow!.getAttribute("aria-disabled")).toBe("true");
		expect(numpyRow!.textContent).toContain("Installed");
		expect(numpyRow!.textContent).toContain("2.5.1");

		// brand-new-pkg is not installed: stays selectable.
		expect(newRow!.getAttribute("aria-disabled")).toBeNull();

		// Clicking the installed row must not select it; clicking the available row does.
		numpyRow!.click();
		newRow!.click();
		await expect
			.element(screen.getByTestId("environments-conda-add-pkg-selected-count"))
			.toHaveTextContent("1");
	});

	it("per-row action menu renders Update and Remove options", async () => {
		const { baseElement } = renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		// Click the first row's action button
		const actionButtons = baseElement.querySelectorAll(
			'[data-qa-id="environments-conda-detail-row-actions"]',
		);
		expect(actionButtons.length).toBeGreaterThan(0);
		(actionButtons[0] as HTMLElement).click();

		// The dropdown should show Update and Remove
		await expect.element(screen.getByText(/update/i)).toBeVisible();
		await expect.element(screen.getByText(/remove/i)).toBeVisible();
	});

	// ─── Update detection, bulk selection, and row-level update ──────────

	function repodataPkg(name: string, versions: string[]): CondaRepodataPackage {
		return {
			name,
			version: versions[0]!,
			build: 0,
			channel: "defaults",
			summary: "",
			home: "",
			versions: versions.map((version) => ({ version, size: 1 })),
		};
	}

	/** numpy 2.5.1 → 2.6.0 available; pandas 3.0.3 already newest. */
	const UPGRADE_HANDLERS: HandlerOverrides = {
		repodataFind: async () => ({
			packages: [repodataPkg("numpy", ["2.6.0", "2.5.1"]), repodataPkg("pandas", ["3.0.3"])],
			truncated: false,
		}),
	};

	it("asks repodata only for the installed conda packages, never pip ones", async () => {
		const repodataFind = vi.fn(async () => ({ packages: [], truncated: false }));
		renderDetail({ handlers: { repodataFind } });

		await vi.waitFor(() => {
			const names = repodataFind.mock.calls.flatMap(
				(call) => (call as unknown as [{ names?: string[] }])[0]?.names ?? [],
			);
			expect(names).toContain("numpy");
			expect(names).not.toContain("requests");
		});
	});

	it("marks upgradable rows and offers the updates dropdown with a filter", async () => {
		const { baseElement } = renderDetail({ handlers: UPGRADE_HANDLERS });
		const screen = page.elementLocator(baseElement);

		const badge = screen.getByTestId("environments-conda-detail-upgrade-badge");
		await expect.element(badge).toBeVisible();
		expect(await badge.all()).toHaveLength(1);
		await expect.element(badge).toHaveAttribute("aria-label", "Update available: 2.5.1 → 2.6.0");

		const trigger = screen.getByTestId("environments-conda-detail-upgradable-filter");
		expect(await trigger.element().textContent).toContain("1");
		await userEvent.click(trigger);
		await userEvent.click(screen.getByRole("menuitem", { name: /Filter packages with updates/ }));

		await vi.waitFor(() => {
			const rows = baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-row"]');
			expect(rows).toHaveLength(1);
			expect(rows[0]!.textContent).toContain("numpy");
		});

		await userEvent.click(trigger);
		await userEvent.click(screen.getByRole("menuitem", { name: /Show all packages/ }));
		await vi.waitFor(() => {
			expect(
				baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-row"]'),
			).toHaveLength(MOCK_PACKAGES.length);
		});
	});

	it("Update all… opens the update sheet with every upgradable package", async () => {
		const { baseElement } = renderDetail({ handlers: UPGRADE_HANDLERS });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-conda-detail-upgradable-filter"));
		await userEvent.click(screen.getByRole("menuitem", { name: /Update all/ }));

		const sheet = screen.getByTestId("environments-conda-update-confirm-dialog");
		await expect.element(sheet).toBeVisible();
		expect(await sheet.element().textContent).toContain("Update 1 Package in");
	});

	it("per-row Update… opens the update sheet for just that package", async () => {
		const { baseElement } = renderDetail({ handlers: UPGRADE_HANDLERS });
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("environments-conda-detail-upgrade-badge"))
			.toBeVisible();
		await userEvent.click(screen.getByRole("button", { name: "Actions for numpy" }));
		await userEvent.click(screen.getByRole("menuitem", { name: /Update…/ }));

		const sheet = screen.getByTestId("environments-conda-update-confirm-dialog");
		await expect.element(sheet).toBeVisible();
		const text = (await sheet.element().textContent) ?? "";
		expect(text).toContain("Update 1 Package in");
		expect(text).toContain("numpy");
		expect(text).not.toContain("pandas");
	});

	it("shows the Python version badge when python is installed", async () => {
		const { baseElement } = renderDetail({
			packagesList: async () => ({
				envName: "dev",
				packages: [
					...MOCK_PACKAGES,
					{ name: "python", version: "3.11.9", build: "h0", channel: "defaults" },
				],
			}),
		});
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("environments-conda-detail-python"))
			.toHaveTextContent("Python 3.11.9");
	});

	it("selecting rows shows the bulk bar; select-all toggles the page; Clear resets", async () => {
		const { baseElement } = renderDetail();
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		await userEvent.click(screen.getByRole("checkbox", { name: "Select numpy" }));
		const bar = screen.getByTestId("environments-conda-detail-bulk-bar");
		await expect.element(bar).toBeVisible();
		expect(await bar.element().textContent).toContain("1 package selected");

		await userEvent.click(screen.getByTestId("environments-conda-detail-select-all"));
		await vi.waitFor(async () => {
			expect(await bar.element().textContent).toContain(
				`${MOCK_PACKAGES.length} packages selected`,
			);
		});

		await userEvent.click(screen.getByTestId("environments-conda-detail-select-all"));
		await vi.waitFor(async () => {
			expect(await bar.all()).toHaveLength(0);
		});

		await userEvent.click(screen.getByRole("checkbox", { name: "Select pandas" }));
		await userEvent.click(screen.getByRole("checkbox", { name: "Select scipy" }));
		await expect.element(bar).toBeVisible();
		await userEvent.click(screen.getByRole("button", { name: "Clear" }));
		await vi.waitFor(async () => {
			expect(await bar.all()).toHaveLength(0);
		});
	});

	it("bulk Remove opens the confirmation listing the selected packages and clears on success", async () => {
		const packagesRemove = vi.fn(async () => ({
			jobId: "job-1",
			envName: "dev",
			removed: ["numpy", "pandas"],
		}));
		const { baseElement } = renderDetail({ handlers: { packagesRemove } });
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		await userEvent.click(screen.getByRole("checkbox", { name: "Select numpy" }));
		await userEvent.click(screen.getByRole("checkbox", { name: "Select pandas" }));
		await userEvent.click(screen.getByTestId("environments-conda-detail-bulk-remove"));

		const dialog = screen.getByTestId("environments-conda-bulk-remove-dialog");
		await expect.element(dialog).toBeVisible();
		expect(await dialog.element().textContent).toContain("Remove 2 packages?");

		await userEvent.click(screen.getByTestId("environments-conda-bulk-remove-confirm-btn"));
		await vi.waitFor(() => {
			expect(packagesRemove).toHaveBeenCalledOnce();
		});
		expect(
			(packagesRemove.mock.calls[0] as unknown as [{ packages: string[] }])[0].packages,
		).toEqual(["numpy", "pandas"]);
		await vi.waitFor(async () => {
			expect(await screen.getByTestId("environments-conda-detail-bulk-bar").all()).toHaveLength(0);
		});
	});

	it("bulk Update opens the sheet with the selection, marking up-to-date packages", async () => {
		const { baseElement } = renderDetail({ handlers: UPGRADE_HANDLERS });
		const screen = page.elementLocator(baseElement);
		await expect
			.element(screen.getByTestId("environments-conda-detail-upgrade-badge"))
			.toBeVisible();

		await userEvent.click(screen.getByRole("checkbox", { name: "Select numpy" }));
		await userEvent.click(screen.getByRole("checkbox", { name: "Select pandas" }));
		await userEvent.click(screen.getByTestId("environments-conda-detail-bulk-update"));

		const sheet = screen.getByTestId("environments-conda-update-confirm-dialog");
		await expect.element(sheet).toBeVisible();
		const text = (await sheet.element().textContent) ?? "";
		// numpy is upgradable; pandas is listed but shown as already current.
		expect(text).toContain("Update 1 Package in");
		expect(text).toContain("pandas");
		expect(text).toContain("up to date");
	});

	it("sorts by channel when the Channel header is clicked", async () => {
		const { baseElement } = renderDetail();
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		await userEvent.click(screen.getByRole("button", { name: /^Channel/ }));

		const channels = Array.from(
			baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-channel"]'),
		).map((cell) => cell.textContent ?? "");
		expect(channels).toEqual([...channels].sort((a, b) => a.localeCompare(b)));
	});
});

describe("EnvironmentDetail — sticky package headers", () => {
	const manyPackages = Array.from({ length: 40 }, (_, index) => ({
		name: `pkg-${String(index).padStart(2, "0")}`,
		version: "1.0.0",
		build: "py311_0",
		channel: "defaults",
	}));

	it("keeps the column headers visible while the package rows scroll", async () => {
		const { baseElement } = renderDetail({
			packagesList: async () => ({ envName: "dev", packages: manyPackages }),
			hostHeight: 380,
		});
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-conda-detail-row").first()).toBeVisible();

		const scroller = baseElement.querySelector(
			'[data-qa-id="environments-conda-detail-table"]',
		)! as HTMLElement;
		const header = baseElement.querySelector("thead")!;

		expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);

		const headerBefore = header.getBoundingClientRect().top;
		const firstRowBefore = baseElement
			.querySelector('[data-qa-id="environments-conda-detail-row"]')!
			.getBoundingClientRect().top;

		scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
		await vi.waitFor(() => {
			expect(scroller.scrollTop).toBeGreaterThan(0);
		});

		const firstRowAfter = baseElement
			.querySelector('[data-qa-id="environments-conda-detail-row"]')!
			.getBoundingClientRect().top;

		// Rows move; the header does not.
		expect(firstRowAfter).toBeLessThan(firstRowBefore);
		expect(header.getBoundingClientRect().top).toBeCloseTo(headerBefore, 0);
	});
});

describe("EnvironmentDetail — resizable columns", () => {
	afterEach(() => {
		localStorage.removeItem(PACKAGE_TABLE_COLUMN_WIDTHS_STORAGE_KEY);
	});

	function dragHandle(handle: Element, deltaX: number) {
		const startX = 500;
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

	it("widens the Package column when its handle is dragged right", async () => {
		const { baseElement } = renderDetail({ hostWidth: 900 });
		const screen = page.elementLocator(baseElement);
		const handle = screen.getByTestId("environments-detail-column-resizer-name");

		await expect.element(handle).toBeVisible();
		dragHandle(handle.element(), 50);

		// Package starts at its 240px default.
		await expect.element(handle).toHaveAttribute("aria-valuenow", "290");
	});

	it("narrows the Version column from the keyboard and keeps it after remount", async () => {
		const first = renderDetail({ hostWidth: 900 });
		const firstHandle = page
			.elementLocator(first.baseElement)
			.getByTestId("environments-detail-column-resizer-version");

		await expect.element(firstHandle).toBeVisible();
		await userEvent.click(firstHandle);
		await userEvent.keyboard("{ArrowLeft}");

		// Version starts at 130px, so a single 16px step lands on the 120px floor.
		await expect.element(firstHandle).toHaveAttribute("aria-valuenow", "120");

		cleanup();
		const second = renderDetail({ hostWidth: 900 });
		const secondHandle = page
			.elementLocator(second.baseElement)
			.getByTestId("environments-detail-column-resizer-version");

		await expect.element(secondHandle).toHaveAttribute("aria-valuenow", "120");
	});
});

describe("EnvironmentDetail — narrow containers", () => {
	it("never scrolls horizontally when the window is narrow", async () => {
		const { baseElement } = renderDetail({ hostHeight: 420, hostWidth: 360 });
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-conda-detail-row").first()).toBeVisible();

		const scroller = baseElement.querySelector('[data-qa-id="environments-conda-detail-table"]')!;

		expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth + 1);
	});
});
