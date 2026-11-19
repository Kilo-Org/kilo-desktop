import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { formatEnvironmentsErrorMessage } from "../../../contracts/common";
import {
	type CondaEnv,
	type CondaPackage,
	type CondaPackagesListResult,
	type CondaRepodataPackage,
} from "../../../contracts/providers/conda";
import type { CondaClient } from "../../conda";
import { renderWithConda, type EnvironmentsHostOptions } from "../../../test/environments-host";
import { EnvironmentDetail } from "./EnvironmentDetail";

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
	packagesList?: CondaClient["listPackages"];
	packagesInstall?: CondaClient["installPackages"];
	packagesRemove?: CondaClient["removePackages"];
	packagesUpdate?: CondaClient["updatePackages"];
	channelsList?: CondaClient["listChannels"];
	repodataFind?: CondaClient["findRepodata"];
	prefixOptions?: CondaClient["prefixOptions"];
}

function defaultHandlers(
	overrides?: HandlerOverrides | CondaClient["listPackages"],
): NonNullable<EnvironmentsHostOptions["handlers"]> {
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
		"conda.repodata.find": opts.repodataFind ?? (async () => ({ packages: [], truncated: false })),
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

async function renderDetail(
	options: {
		env?: CondaEnv;
		onBack?: () => void;
		packagesList?: CondaClient["listPackages"];
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
	const hostOptions: EnvironmentsHostOptions = {
		handlers: defaultHandlers(handlerOverrides),
	};

	const detail = (
		<>
			<EnvironmentDetail env={env} onBack={onBack} />
		</>
	);

	if (options.hostHeight === undefined && options.hostWidth === undefined) {
		return renderWithConda(detail, hostOptions);
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
			{detail}
		</div>,
		hostOptions,
	);
}

afterEach(() => {
	cleanup();
});

describe("EnvironmentDetail", () => {
	it("renders the environment name and prefix", async () => {
		const { baseElement } = await renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("environments-conda-detail-name"))
			.toHaveTextContent("dev");
		await expect
			.element(screen.getByTestId("environments-conda-detail-prefix"))
			.toHaveTextContent("/opt/conda/envs/dev");
	});

	it("calls onBack when the back button is pressed", async () => {
		const onBack = vi.fn();
		const { baseElement } = await renderDetail({ onBack });
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("environments-conda-detail-back").click();
		expect(onBack).toHaveBeenCalledOnce();
	});

	it("renders directory basename as the name when env.name is empty", async () => {
		const { baseElement } = await renderDetail({
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
		const { baseElement } = await renderDetail({
			packagesList: () => pending,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-loading")).toBeVisible();
		resolve?.({ envName: "dev", packages: [] });
	});

	it("renders a table of packages after loading", async () => {
		const { baseElement } = await renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();
		expect(
			baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-row"]').length,
		).toBe(8);
	});

	it("renders the package list without pagination", async () => {
		const { baseElement } = await renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();
		expect(baseElement.querySelector('[data-qa-id*="pagination"]')).toBeNull();
	});

	it("surfaces backend errors with a retry", async () => {
		let calls = 0;
		const { baseElement } = await renderDetail({
			packagesList: async () => {
				calls += 1;
				if (calls === 1) throw new Error("connection failed");
				return { envName: "dev", packages: MOCK_PACKAGES };
			},
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-error")).toBeVisible();
		await expect.element(screen.getByText(/could not load packages/i)).toBeVisible();

		await userEvent.click(screen.getByRole("button", { name: "Try again" }));
		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();
	});

	it("shows empty state when no packages are installed", async () => {
		const { baseElement } = await renderDetail({
			packagesList: async () => ({ envName: "dev", packages: [] }),
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-empty")).toBeVisible();
		await expect.element(screen.getByText(/no packages installed/i)).toBeVisible();
	});

	it("filters packages by search query", async () => {
		const { baseElement } = await renderDetail();
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
		const { baseElement } = await renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		const searchInput = screen.getByTestId("environments-conda-detail-search");
		await searchInput.fill("nonexistentpackage");

		await expect.element(screen.getByTestId("environments-conda-detail-empty")).toBeVisible();
	});

	it("renders the environment as the page title and subtitle", async () => {
		const { baseElement } = await renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByRole("heading", { level: 1, name: "dev" }))
			.toHaveAttribute("data-qa-id", "environments-conda-detail-name");
		await expect
			.element(screen.getByTestId("environments-conda-detail-prefix"))
			.toHaveTextContent("/opt/conda/envs/dev");
		await expect.element(screen.getByTestId("environments-conda-detail-back")).toBeVisible();
		await expect.element(screen.getByTestId("environments-conda-detail-add-pkg")).toBeVisible();
	});

	it("virtualises long package lists and reaches the last row by scrolling", async () => {
		const manyPackages: CondaPackage[] = Array.from({ length: 300 }, (_, i) => ({
			name: `pkg-${String(i).padStart(3, "0")}`,
			version: "1.0.0",
			build: "py311_0",
			channel: "defaults",
		}));
		const { baseElement } = await renderDetail({
			packagesList: async () => ({ envName: "dev", packages: manyPackages }),
			hostHeight: 480,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-row").first()).toBeVisible();
		const rendered = baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-row"]');
		expect(rendered.length).toBeGreaterThan(0);
		expect(rendered.length).toBeLessThan(manyPackages.length);

		const scroller = baseElement.querySelector(
			'[data-qa-id="environments-conda-detail-table"]',
		)! as HTMLElement;
		scroller.scrollTop = scroller.scrollHeight;
		await expect.element(screen.getByText("pkg-299")).toBeVisible();
	});

	it("sorts packages by version from the view menu", async () => {
		const { baseElement } = await renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		await userEvent.click(screen.getByTestId("environments-conda-detail-view-menu"));
		await userEvent.click(screen.getByRole("menuitem", { name: /Sort by/ }));
		await userEvent.click(screen.getByRole("menuitemradio", { name: "Version" }));

		// Column indices: 0=checkbox, 1=name, 2=version, 3=source, 4=channel, 5=actions
		await vi.waitFor(() => {
			const rows = baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-row"]');
			const versions = Array.from(rows).map(
				(row) => row.querySelectorAll("td")[2]?.textContent ?? "",
			);
			expect(versions).toEqual([...versions].sort((a, b) => a.localeCompare(b)));
			expect(versions[0]).toBe("0.13.2");
		});
	});

	it("shows conda badge for conda packages and pip badge for pypi packages", async () => {
		const { baseElement } = await renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		const badges = baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-source"]');
		const labels = Array.from(badges).map((b) => b.textContent?.trim());

		// The mock data has 7 conda packages and 1 pip package
		expect(labels.filter((l) => l === "conda")).toHaveLength(7);
		expect(labels.filter((l) => l === "pip")).toHaveLength(1);
	});

	it("sorts packages by source from the view menu", async () => {
		const { baseElement } = await renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		await userEvent.click(screen.getByTestId("environments-conda-detail-view-menu"));
		await userEvent.click(screen.getByRole("menuitem", { name: /Sort by/ }));
		await userEvent.click(screen.getByRole("menuitemradio", { name: "Source" }));
		await userEvent.click(screen.getByRole("menuitem", { name: /^Order/ }));
		await userEvent.click(screen.getByRole("menuitemradio", { name: "Descending" }));

		// Descending by source puts the pip package first.
		await vi.waitFor(() => {
			const badges = baseElement.querySelectorAll(
				'[data-qa-id="environments-conda-detail-source"]',
			);
			expect(badges[0]?.textContent?.trim()).toBe("pip");
		});
	});

	it("sorts names descending from the view menu", async () => {
		const { baseElement } = await renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		await userEvent.click(screen.getByTestId("environments-conda-detail-view-menu"));
		await userEvent.click(screen.getByRole("menuitem", { name: /^Order/ }));
		await userEvent.click(screen.getByRole("menuitemradio", { name: "Descending" }));

		await vi.waitFor(() => {
			const rows = baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-row"]');
			const names = Array.from(rows).map((row) => row.querySelectorAll("td")[1]?.textContent ?? "");
			expect(names).toEqual([...names].sort((a, b) => b.localeCompare(a)));
		});
	});

	it("Add Package button opens the add package dialog", async () => {
		const { baseElement } = await renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		const addBtn = screen.getByTestId("environments-conda-detail-add-pkg");
		await addBtn.click();

		await expect.element(screen.getByTestId("environments-conda-add-pkg-dialog")).toBeVisible();
		await expect.element(screen.getByText(/Add packages to/)).toBeVisible();
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
		const { baseElement } = await renderDetail({
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
		const { baseElement } = await renderDetail();
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
		await renderDetail({ handlers: { repodataFind } });

		await vi.waitFor(() => {
			const names = repodataFind.mock.calls.flatMap(
				(call) => (call as unknown as [{ names?: string[] }])[0]?.names ?? [],
			);
			expect(names).toContain("numpy");
			expect(names).not.toContain("requests");
		});
	});

	it("marks upgradable rows and filters to them from the view menu", async () => {
		const { baseElement } = await renderDetail({ handlers: UPGRADE_HANDLERS });
		const screen = page.elementLocator(baseElement);

		const badge = screen.getByTestId("environments-conda-detail-upgrade-badge");
		await expect.element(badge).toBeVisible();
		expect(await badge.all()).toHaveLength(1);
		await expect.element(badge).toHaveAttribute("aria-label", "Update available: 2.5.1 → 2.6.0");
		await expect
			.element(screen.getByTestId("environments-conda-detail-update-all"))
			.toHaveTextContent("Update 1 package");

		await userEvent.click(screen.getByTestId("environments-conda-detail-view-menu"));
		const filter = screen.getByRole("menuitemcheckbox", { name: "Only packages with updates" });
		await userEvent.click(filter);

		await vi.waitFor(() => {
			const rows = baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-row"]');
			expect(rows).toHaveLength(1);
			expect(rows[0]!.textContent).toContain("numpy");
		});

		await userEvent.click(filter);
		await vi.waitFor(() => {
			expect(
				baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-row"]'),
			).toHaveLength(MOCK_PACKAGES.length);
		});
	});

	it("says it couldn't check for updates instead of showing the environment up to date", async () => {
		let signedIn = false;
		const repodataFind = vi.fn(async () => {
			if (!signedIn) {
				throw new Error(
					formatEnvironmentsErrorMessage("NOT_SIGNED_IN", "Sign in to use acme/main", {
						refused: { org: "acme", channel: "acme/main" },
					}),
				);
			}
			return UPGRADE_HANDLERS.repodataFind!(undefined as never);
		});
		const signIn = vi.fn(async () => {
			signedIn = true;
			return { ok: true as const };
		});
		const { baseElement, host } = await renderWithConda(
			<EnvironmentDetail env={MOCK_ENV} onBack={() => {}} />,
			{
				handlers: defaultHandlers({ ...UPGRADE_HANDLERS, repodataFind }),
				anaconda: { signIn },
			},
		);
		const screen = page.elementLocator(baseElement);

		const failure = screen.getByTestId("environments-conda-detail-update-check-error");
		await expect.element(failure).toBeVisible();
		await expect.element(failure.getByText("Couldn't check for updates")).toBeVisible();
		await expect
			.element(
				failure.getByText(
					"acme/main needs an Anaconda account. Sign in to Anaconda, then try again.",
				),
			)
			.toBeVisible();
		expect(screen.getByTestId("environments-conda-detail-update-all").query()).toBeNull();
		await vi.waitFor(() =>
			expect(host.tracked).toContainEqual(
				expect.objectContaining({
					event: "Environment Policy Blocked",
					data: expect.objectContaining({ surface: "ui", errorCode: "NOT_SIGNED_IN" }),
				}),
			),
		);

		await userEvent.click(failure.getByTestId("environments-anaconda-sign-in"));

		await expect
			.element(screen.getByTestId("environments-conda-detail-update-all"))
			.toHaveTextContent("Update 1 package");
		expect(screen.getByTestId("environments-conda-detail-update-check-error").query()).toBeNull();
	});

	it("Update all opens the update sheet with every upgradable package", async () => {
		const { baseElement } = await renderDetail({ handlers: UPGRADE_HANDLERS });
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("environments-conda-detail-upgrade-badge"))
			.toBeVisible();
		await userEvent.click(screen.getByTestId("environments-conda-detail-update-all"));

		const sheet = screen.getByTestId("environments-conda-update-confirm-dialog");
		await expect.element(sheet).toBeVisible();
		expect(await sheet.element().textContent).toContain("Update 1 package in");
	});

	it("per-row Update… opens the update sheet for just that package", async () => {
		const { baseElement } = await renderDetail({ handlers: UPGRADE_HANDLERS });
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("environments-conda-detail-upgrade-badge"))
			.toBeVisible();
		await userEvent.click(screen.getByRole("button", { name: "Actions for numpy" }));
		await userEvent.click(screen.getByRole("menuitem", { name: /Update…/ }));

		const sheet = screen.getByTestId("environments-conda-update-confirm-dialog");
		await expect.element(sheet).toBeVisible();
		const text = (await sheet.element().textContent) ?? "";
		expect(text).toContain("Update 1 package in");
		expect(text).toContain("numpy");
		expect(text).not.toContain("pandas");
	});

	it("shows the Python version badge when python is installed", async () => {
		const { baseElement } = await renderDetail({
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

	it("selecting rows swaps the toolbar for bulk actions; select-all and Clear reset it", async () => {
		const { baseElement } = await renderDetail();
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		await userEvent.click(screen.getByRole("checkbox", { name: "Select numpy" }));
		const bar = screen.getByTestId("environments-conda-detail-bulk-bar");
		await expect.element(bar).toBeVisible();
		expect(await bar.element().textContent).toContain("1 selected");

		await userEvent.click(screen.getByTestId("environments-conda-detail-select-all"));
		await vi.waitFor(async () => {
			expect(await bar.element().textContent).toContain(`${MOCK_PACKAGES.length} selected`);
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
		const { baseElement } = await renderDetail({ handlers: { packagesRemove } });
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
		const { baseElement } = await renderDetail({ handlers: UPGRADE_HANDLERS });
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
		expect(text).toContain("Update 1 package in");
		expect(text).toContain("pandas");
		expect(text).toContain("up to date");
	});

	it("sorts by channel from the view menu", async () => {
		const { baseElement } = await renderDetail();
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		await userEvent.click(screen.getByTestId("environments-conda-detail-view-menu"));
		await userEvent.click(screen.getByRole("menuitem", { name: /Sort by/ }));
		await userEvent.click(screen.getByRole("menuitemradio", { name: "Channel" }));

		await vi.waitFor(() => {
			const channels = Array.from(
				baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-channel"]'),
			).map((cell) => cell.textContent ?? "");
			expect(channels).toEqual([...channels].sort((a, b) => a.localeCompare(b)));
			expect(channels[0]).toBe("conda-forge");
		});
	});
});

describe("EnvironmentDetail — scrolling", () => {
	const manyPackages = Array.from({ length: 40 }, (_, index) => ({
		name: `pkg-${String(index).padStart(2, "0")}`,
		version: "1.0.0",
		build: "py311_0",
		channel: "defaults",
	}));

	it("scrolls the package rows inside the table panel while the toolbar stays put", async () => {
		const { baseElement } = await renderDetail({
			packagesList: async () => ({ envName: "dev", packages: manyPackages }),
			hostHeight: 380,
		});
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-conda-detail-row").first()).toBeVisible();

		const scroller = baseElement.querySelector(
			'[data-qa-id="environments-conda-detail-table"]',
		)! as HTMLElement;
		const search = baseElement.querySelector('[data-qa-id="environments-conda-detail-search"]')!;

		expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
		const searchBefore = search.getBoundingClientRect().top;

		scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
		await vi.waitFor(() => {
			expect(scroller.scrollTop).toBeGreaterThan(0);
		});

		expect(search.getBoundingClientRect().top).toBeCloseTo(searchBefore, 0);
	});
});

describe("EnvironmentDetail — narrow containers", () => {
	it("never scrolls horizontally when the window is narrow", async () => {
		const { baseElement } = await renderDetail({ hostHeight: 420, hostWidth: 360 });
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("environments-conda-detail-row").first()).toBeVisible();

		const scroller = baseElement.querySelector('[data-qa-id="environments-conda-detail-table"]')!;

		expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth + 1);
	});
});
