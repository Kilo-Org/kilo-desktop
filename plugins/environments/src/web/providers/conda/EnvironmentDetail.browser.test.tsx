import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import {
	condaContract,
	type CondaEnv,
	type CondaPackage,
	type CondaPackagesListResult,
	type CondaService,
} from "../../../contracts/providers/conda.js";
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

function defaultHandlers(
	packagesListHandler?: CondaService["conda.packages.list"],
): Record<string, (...args: never[]) => Promise<unknown>> {
	return {
		"conda.envs.list": async () => [],
		"conda.envs.create": async () => {
			throw new Error("not implemented in test");
		},
		"conda.envs.delete": async () => {
			throw new Error("not implemented in test");
		},
		"conda.packages.list":
			packagesListHandler ??
			(async (): Promise<CondaPackagesListResult> => ({
				envName: "dev",
				packages: MOCK_PACKAGES,
			})),
		"conda.packages.install": async () => {
			throw new Error("not implemented in test");
		},
		"conda.packages.remove": async () => {
			throw new Error("not implemented in test");
		},
		"conda.channels.list": async () => {
			throw new Error("not implemented in test");
		},
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
	} = {},
) {
	const env = options.env ?? MOCK_ENV;
	const onBack = options.onBack ?? (() => {});
	const sdk = createFakeSdk({
		featureId: "environments",
		channels: condaContract,
		handlers: defaultHandlers(options.packagesList),
	});
	const system = createFakeFeatureSystem({ sdks: { environments: sdk } });
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<EnvironmentDetail env={env} onBack={onBack} />
			</QueryClientProvider>
		</SdkProvider>,
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
		await expect.element(screen.getByText("1 - 8 of 8 items")).toBeVisible();
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
		await expect.element(screen.getByText("1 - 20 of 45 items")).toBeVisible();

		// Navigate to page 2
		const nextButton = screen.getByRole("button", { name: "Next page" });
		await nextButton.click();
		await expect.element(screen.getByText("21 - 40 of 45 items")).toBeVisible();

		// Navigate to last page
		const lastButton = screen.getByRole("button", { name: "Last page" });
		await lastButton.click();
		await expect.element(screen.getByText("41 - 45 of 45 items")).toBeVisible();

		// Navigate back to first
		const firstButton = screen.getByRole("button", { name: "First page" });
		await firstButton.click();
		await expect.element(screen.getByText("1 - 20 of 45 items")).toBeVisible();
	});

	it("sorts packages by version when version header is clicked", async () => {
		const { baseElement } = renderDetail();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-conda-detail-table")).toBeVisible();

		// Click version header to sort by version ascending
		const versionButton = screen.getByRole("button", { name: /version/i });
		await versionButton.click();

		// Extract displayed versions and verify ascending order
		const rows = baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-row"]');
		const versions = Array.from(rows).map(
			(row) => row.querySelectorAll("td")[1]?.textContent ?? "",
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
		const rows = baseElement.querySelectorAll('[data-qa-id="environments-conda-detail-row"]');
		const names = Array.from(rows).map((row) => row.querySelectorAll("td")[0]?.textContent ?? "");
		const sortedDesc = [...names].sort((a, b) => b.localeCompare(a));
		expect(names).toEqual(sortedDesc);
	});
});
