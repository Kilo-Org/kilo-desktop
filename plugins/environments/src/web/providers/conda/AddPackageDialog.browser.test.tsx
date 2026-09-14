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
	type CondaPackagesInstallInput,
	type CondaPackagesInstallResult,
	type CondaRepodataFindInput,
	type CondaRepodataPackage,
} from "../../../contracts/providers/conda.js";
import { AddPackageDialog } from "./AddPackageDialog.js";

const ENV: CondaEnv = { name: "dev", prefix: "/opt/anaconda3/envs/dev" };

function pkg(name: string, versions: string[] = ["1.0.0"]): CondaRepodataPackage {
	return {
		name,
		version: versions[0] ?? "1.0.0",
		build: 0,
		channel: "conda-forge",
		summary: "",
		home: "",
		versions: versions.map((version, i) => ({ version, size: 1024 * (i + 1) })),
	};
}

function installResult(): CondaPackagesInstallResult {
	return { jobId: "job-1", envName: "dev", installed: [] };
}

function renderDialog(
	options: {
		find?: (input: CondaRepodataFindInput) => CondaRepodataPackage[];
		truncated?: boolean;
		install?: (input: CondaPackagesInstallInput) => Promise<CondaPackagesInstallResult>;
		installed?: CondaPackage[];
		channels?: string[];
		onClose?: () => void;
	} = {},
) {
	const find = options.find ?? (() => [pkg("numpy", ["2.1.0", "2.0.0"]), pkg("pandas")]);
	const install = options.install ?? (async () => installResult());
	const onClose = options.onClose ?? (() => {});

	const sdk = createFakeSdk({
		featureId: "environments",
		channels: condaContract,
		handlers: {
			"conda.envs.prefixOptions": async () => ({
				envsDirs: ["/opt/anaconda3/envs"],
				channels: options.channels ?? ["defaults", "conda-forge"],
			}),
			"conda.packages.list": async () => ({
				envName: "dev",
				packages: options.installed ?? [],
			}),
			"conda.repodata.find": async (input: CondaRepodataFindInput) => ({
				packages: find(input),
				truncated: options.truncated ?? false,
			}),
			"conda.packages.install": install,
			"conda.packages.previewInstall": async () => ({
				upgraded: [],
				downgraded: [],
				added: [],
				removed: [],
				rebuilt: [],
				nothingToDo: true,
			}),
		},
	});
	const system = createFakeFeatureSystem({ sdks: { environments: sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<AddPackageDialog env={ENV} open onClose={onClose} />
			</QueryClientProvider>
		</SdkProvider>,
	);
}

/** Resolve once `predicate` holds; the dialog debounces search by 200 ms. */
async function waitForRows(baseElement: HTMLElement, count: number) {
	await vi.waitFor(() => {
		const rows = baseElement.querySelectorAll('[data-qa-id="environments-conda-add-pkg-row"]');
		expect(rows).toHaveLength(count);
	});
}

afterEach(cleanup);

describe("AddPackageDialog", () => {
	it("searches repodata with the query and selected channels after the debounce", async () => {
		const find = vi.fn((_input: CondaRepodataFindInput) => [pkg("numpy")]);
		const { baseElement } = renderDialog({ find, channels: ["conda-forge"] });
		const screen = page.elementLocator(baseElement);

		await waitForRows(baseElement, 1);
		// Initial search waits for prefixOptions so the channel filter is present.
		expect(find.mock.calls[0]![0]).toMatchObject({ channels: ["conda-forge"], limit: 200 });
		expect(find.mock.calls[0]![0].query).toBeUndefined();

		await userEvent.fill(screen.getByTestId("environments-conda-add-pkg-search"), "num");

		await vi.waitFor(() => {
			expect(find.mock.calls.at(-1)![0]).toMatchObject({ query: "num", channels: ["conda-forge"] });
		});
	});

	it("shows an empty-state message when the search has no results", async () => {
		const { baseElement } = renderDialog({ find: () => [] });
		const screen = page.elementLocator(baseElement);

		await userEvent.fill(screen.getByTestId("environments-conda-add-pkg-search"), "nothing");
		await expect.element(screen.getByText('No results for "nothing"')).toBeVisible();
	});

	it("dedupes repodata rows by name and notes when results were truncated", async () => {
		const { baseElement } = renderDialog({
			find: () => [pkg("numpy", ["2.1.0"]), pkg("numpy", ["2.0.0"]), pkg("pandas")],
			truncated: true,
		});
		const screen = page.elementLocator(baseElement);

		await waitForRows(baseElement, 2);
		await expect.element(screen.getByText(/Showing the first 2 packages/)).toBeVisible();
	});

	it("selects a package into the sidebar and removes it again", async () => {
		const { baseElement } = renderDialog();
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		await userEvent.click(screen.getByText("pandas", { exact: true }));
		await expect
			.element(screen.getByTestId("environments-conda-add-pkg-selected-count"))
			.toHaveTextContent("1");
		expect(
			await screen.getByTestId("environments-conda-add-pkg-install-btn").element().textContent,
		).toContain("Install 1 Package");

		await userEvent.click(screen.getByRole("button", { name: "Remove pandas" }));
		await expect
			.element(screen.getByTestId("environments-conda-add-pkg-selected-count"))
			.toHaveTextContent("0");
		await expect
			.element(screen.getByTestId("environments-conda-add-pkg-install-btn"))
			.toBeDisabled();
	});

	it("installs pinned specs for the chosen versions and closes on success", async () => {
		const install = vi.fn(async (_input: CondaPackagesInstallInput) => installResult());
		const onClose = vi.fn();
		const { baseElement } = renderDialog({ install, onClose, channels: ["conda-forge"] });
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		// Pin numpy to the older version, leave pandas on latest.
		await userEvent.click(screen.getByRole("combobox", { name: "Version for numpy" }));
		await userEvent.click(screen.getByRole("option", { name: "2.0.0" }));
		await userEvent.click(screen.getByText("numpy", { exact: true }));
		await userEvent.click(screen.getByText("pandas", { exact: true }));

		expect(
			await screen.getByTestId("environments-conda-add-pkg-selected-list").element().textContent,
		).toContain("numpy2.0.0");

		await userEvent.click(screen.getByTestId("environments-conda-add-pkg-install-btn"));

		await vi.waitFor(() => {
			expect(install).toHaveBeenCalledOnce();
		});
		expect(install.mock.calls[0]![0]).toEqual({
			name: "dev",
			prefix: "/opt/anaconda3/envs/dev",
			packages: ["numpy=2.0.0", "pandas"],
			channels: ["conda-forge"],
		});
		await vi.waitFor(() => {
			expect(onClose).toHaveBeenCalledOnce();
		});
	});

	it("re-pins an already-selected package when its row version changes", async () => {
		const install = vi.fn(async (_input: CondaPackagesInstallInput) => installResult());
		const { baseElement } = renderDialog({ install });
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		// Select first, then change the version — the sidebar entry must follow.
		await userEvent.click(screen.getByText("numpy", { exact: true }));
		await userEvent.click(screen.getByRole("combobox", { name: "Version for numpy" }));
		await userEvent.click(screen.getByRole("option", { name: "2.0.0" }));

		await userEvent.click(screen.getByTestId("environments-conda-add-pkg-install-btn"));
		await vi.waitFor(() => {
			expect(install).toHaveBeenCalledOnce();
		});
		expect(install.mock.calls[0]![0].packages).toEqual(["numpy=2.0.0"]);
	});

	it("greys out already-installed packages and refuses to select them", async () => {
		const { baseElement } = renderDialog({
			installed: [{ name: "numpy", version: "1.9.0", build: "py_0", channel: "conda-forge" }],
		});
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		const rows = Array.from(
			baseElement.querySelectorAll<HTMLElement>('[data-qa-id="environments-conda-add-pkg-row"]'),
		);
		const numpyRow = rows.find((row) => row.textContent?.includes("numpy"))!;
		expect(numpyRow.getAttribute("aria-disabled")).toBe("true");
		await expect
			.element(screen.getByTestId("environments-conda-add-pkg-row-installed"))
			.toBeVisible();
		expect(numpyRow.textContent).toContain("1.9.0");

		numpyRow.click();
		await expect
			.element(screen.getByTestId("environments-conda-add-pkg-selected-count"))
			.toHaveTextContent("0");
	});

	it("paginates results 20 per page", async () => {
		const many = Array.from({ length: 25 }, (_, i) => pkg(`pkg-${String(i).padStart(2, "0")}`));
		const { baseElement } = renderDialog({ find: () => many });
		const screen = page.elementLocator(baseElement);

		await waitForRows(baseElement, 20);
		await expect.element(screen.getByText("1–20 of 25")).toBeVisible();

		await userEvent.click(screen.getByRole("button", { name: "Next page" }));
		await waitForRows(baseElement, 5);
		await expect.element(screen.getByText("21–25 of 25")).toBeVisible();
		await expect.element(screen.getByText("pkg-24", { exact: true })).toBeVisible();
		await expect.element(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
	});

	it("keeps the dialog open and shows the friendly error when install fails", async () => {
		const onClose = vi.fn();
		const { baseElement } = renderDialog({
			onClose,
			install: async () => {
				throw new Error("[BUSINESS] SOLVE_FAILED: conflict");
			},
		});
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		await userEvent.click(screen.getByText("pandas", { exact: true }));
		await userEvent.click(screen.getByTestId("environments-conda-add-pkg-install-btn"));

		await expect.element(screen.getByTestId("environments-conda-add-pkg-error")).toBeVisible();
		await expect.element(screen.getByTestId("environments-conda-add-pkg-dialog")).toBeVisible();
		expect(onClose).not.toHaveBeenCalled();
	});

	it("hands a running install to the background and closes when asked", async () => {
		let finish!: (value: CondaPackagesInstallResult) => void;
		const install = vi.fn(
			() =>
				new Promise<CondaPackagesInstallResult>((resolve) => {
					finish = resolve;
				}),
		);
		const onClose = vi.fn();
		const { baseElement } = renderDialog({ install, onClose });
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		await userEvent.click(screen.getByText("pandas", { exact: true }));
		await userEvent.click(screen.getByTestId("environments-conda-add-pkg-install-btn"));

		await expect.element(screen.getByTestId("environments-conda-add-pkg-background")).toBeVisible();
		await userEvent.click(screen.getByTestId("environments-conda-add-pkg-background"));

		expect(onClose).toHaveBeenCalledOnce();
		// The job itself is not cancelled — the toast adopts the same promise.
		expect(install).toHaveBeenCalledOnce();
		finish(installResult());
	});

	it("backgrounds a running install instead of blocking Cancel", async () => {
		let finish!: (value: CondaPackagesInstallResult) => void;
		const install = vi.fn(
			() =>
				new Promise<CondaPackagesInstallResult>((resolve) => {
					finish = resolve;
				}),
		);
		const onClose = vi.fn();
		const { baseElement } = renderDialog({ install, onClose });
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		await userEvent.click(screen.getByText("pandas", { exact: true }));
		await userEvent.click(screen.getByTestId("environments-conda-add-pkg-install-btn"));
		await expect.element(screen.getByTestId("environments-conda-add-pkg-background")).toBeVisible();

		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect(onClose).toHaveBeenCalledOnce();
		finish(installResult());
	});

	it("locks the version selector while an install is pending so it can't drift from what was submitted", async () => {
		let finish!: (value: CondaPackagesInstallResult) => void;
		const install = vi.fn(
			() =>
				new Promise<CondaPackagesInstallResult>((resolve) => {
					finish = resolve;
				}),
		);
		const { baseElement } = renderDialog({ install });
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		await userEvent.click(screen.getByText("numpy", { exact: true }));
		await userEvent.click(screen.getByTestId("environments-conda-add-pkg-install-btn"));
		await expect.element(screen.getByTestId("environments-conda-add-pkg-background")).toBeVisible();

		const versionSelect = screen.getByRole("combobox", { name: "Version for numpy" });
		await expect.element(versionSelect).toBeDisabled();

		// Attempting to open/change it while pending must not alter what's already in-flight.
		await userEvent.click(versionSelect, { force: true });
		await expect.element(screen.getByRole("option", { name: "2.0.0" })).not.toBeInTheDocument();
		// numpy was selected at its default (latest), so the spec is unpinned.
		expect((install.mock.calls[0] as unknown as [CondaPackagesInstallInput])[0].packages).toEqual([
			"numpy",
		]);

		finish(installResult());
	});

	it("opens the Channels dialog and applies the chosen channel set to the search", async () => {
		const find = vi.fn((_input: CondaRepodataFindInput) => [pkg("numpy")]);
		const { baseElement } = renderDialog({ find, channels: ["defaults", "conda-forge"] });
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 1);

		expect(
			await screen.getByTestId("environments-conda-add-pkg-channels-btn").element().textContent,
		).toContain("All channels");
		await userEvent.click(screen.getByTestId("environments-conda-add-pkg-channels-btn"));
		await expect.element(screen.getByTestId("environments-channels-dialog")).toBeVisible();

		await userEvent.click(screen.getByRole("checkbox", { name: "defaults defaults" }));
		await userEvent.click(screen.getByTestId("environments-channels-confirm"));

		await vi.waitFor(async () => {
			expect(
				await screen.getByTestId("environments-conda-add-pkg-channels-btn").element().textContent,
			).toContain("1 channel");
		});
		await vi.waitFor(() => {
			expect(find.mock.calls.at(-1)![0].channels).toEqual(["conda-forge"]);
		});
	});
});
