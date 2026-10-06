import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import type { AuthSession, SDK } from "@kilo-desktop/feature-sdk";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import {
	condaContract,
	type CondaEnv,
	type CondaPackage,
	type CondaPackagesInstallInput,
	type CondaPackagesInstallResult,
	type CondaPackagesPreviewInput,
	type CondaPackagesPreviewResult,
	type CondaRepodataFindInput,
	type CondaRepodataPackage,
} from "../../../contracts/providers/conda.js";
import { AddPackageDialog } from "./AddPackageDialog.js";

const AUTHENTICATED_SESSION: AuthSession = {
	status: "authenticated",
	user: { username: "ada" },
};

const authenticatedAuth: Partial<SDK["auth"]> = {
	subscribe(listener) {
		listener(AUTHENTICATED_SESSION);
		return () => undefined;
	},
	peek: () => AUTHENTICATED_SESSION,
};

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

function solvedPreview(): CondaPackagesPreviewResult {
	return {
		upgraded: [],
		downgraded: [],
		added: [],
		removed: [],
		rebuilt: [],
		nothingToDo: true,
	};
}

function renderDialog(
	options: {
		find?: (input: CondaRepodataFindInput) => CondaRepodataPackage[];
		truncated?: boolean;
		install?: (input: CondaPackagesInstallInput) => Promise<CondaPackagesInstallResult>;
		previewInstall?: (input: CondaPackagesPreviewInput) => Promise<CondaPackagesPreviewResult>;
		installed?: CondaPackage[];
		channels?: string[];
		onClose?: () => void;
		auth?: Partial<SDK["auth"]>;
	} = {},
) {
	const find = options.find ?? (() => [pkg("numpy", ["2.1.0", "2.0.0"]), pkg("pandas")]);
	const install = options.install ?? (async () => installResult());
	const previewInstall = options.previewInstall ?? (async () => solvedPreview());
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
			"conda.packages.previewInstall": previewInstall,
		},
		auth: options.auth ?? {},
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

/**
 * The install button is locked until the debounced solver preview returns a
 * solution. The preview debounce is 1500 ms, so poll with a generous timeout.
 */
async function waitForInstallEnabled(baseElement: HTMLElement) {
	await vi.waitFor(
		() => {
			const btn = baseElement.querySelector(
				'[data-qa-id="environments-conda-add-pkg-install-btn"]',
			);
			expect(btn).not.toBeNull();
			expect(btn).not.toBeDisabled();
		},
		{ timeout: 3000 },
	);
}

afterEach(cleanup);

describe("AddPackageDialog", () => {
	it("searches repodata with the query and selected channels after the debounce", async () => {
		const find = vi.fn((_input: CondaRepodataFindInput) => [pkg("numpy")]);
		const { baseElement } = renderDialog({ find, channels: ["conda-forge"] });
		const screen = page.elementLocator(baseElement);

		await waitForRows(baseElement, 1);
		// Initial search waits for prefixOptions so the channel filter is present.
		expect(find.mock.calls[0]![0]).toMatchObject({
			channels: ["conda-forge", "defaults"],
			limit: 50,
		});
		expect(find.mock.calls[0]![0].query).toBeUndefined();

		await userEvent.fill(screen.getByTestId("environments-conda-add-pkg-search"), "num");

		await vi.waitFor(() => {
			expect(find.mock.calls.at(-1)![0]).toMatchObject({
				query: "num",
				channels: ["conda-forge", "defaults"],
			});
		});
	});

	it("shows an empty-state message when the search has no results", async () => {
		const { baseElement } = renderDialog({ find: () => [] });
		const screen = page.elementLocator(baseElement);

		await userEvent.fill(screen.getByTestId("environments-conda-add-pkg-search"), "nothing");
		await expect.element(screen.getByText("No results for “nothing”")).toBeVisible();
	});

	it("dedupes repodata rows by name", async () => {
		const { baseElement } = renderDialog({
			find: () => [pkg("numpy", ["2.1.0"]), pkg("numpy", ["2.0.0"]), pkg("pandas")],
		});

		await waitForRows(baseElement, 2);
	});

	it("selects a package into the sidebar and removes it again", async () => {
		const { baseElement } = renderDialog();
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);
		const panel = screen.getByRole("complementary", { name: "Selected packages" });
		await expect.element(panel).not.toBeInTheDocument();

		await userEvent.click(screen.getByText("pandas", { exact: true }));
		await expect.element(panel).toBeVisible();
		await expect
			.element(screen.getByTestId("environments-conda-add-pkg-selected-count"))
			.toHaveTextContent("1");
		expect(
			await screen.getByTestId("environments-conda-add-pkg-install-btn").element().textContent,
		).toContain("Install 1 package");

		await userEvent.click(screen.getByRole("button", { name: "Remove pandas" }));
		await expect
			.element(screen.getByRole("complementary", { name: "Selected packages" }))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("environments-conda-add-pkg-install-btn"))
			.toBeDisabled();
	});

	it("lists the solver's other dependency changes by category and filters them", async () => {
		const { baseElement } = renderDialog({
			previewInstall: async () => ({
				upgraded: [{ name: "libblas", fromVersion: "3.9.0", toVersion: "3.9.1", channel: "cf" }],
				downgraded: [],
				added: [
					{ name: "pandas", fromVersion: null, toVersion: "1.0.0", channel: "cf" },
					{ name: "libgfortran", fromVersion: null, toVersion: "5.0.0", channel: "cf" },
				],
				removed: [],
				rebuilt: [],
				nothingToDo: false,
			}),
		});
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		await userEvent.click(screen.getByText("pandas", { exact: true }));

		const changes = screen.getByRole("region", { name: "Dependency changes" });
		const list = changes.getByTestId("environments-conda-add-pkg-preview-list");
		await expect.element(list, { timeout: 5_000 }).toBeVisible();
		await expect
			.element(changes.getByTestId("environments-conda-add-pkg-preview-count"))
			.toHaveTextContent("2");
		const text = list.element().textContent ?? "";
		expect(text).toContain("Upgradedlibblas3.9.03.9.1");
		expect(text).toContain("Addedlibgfortran5.0.0");
		// The user's own pick is not a dependency change.
		expect(list.element().textContent).not.toContain("pandas");

		const filter = changes.getByRole("button", { name: "Filter dependency changes: All" });
		await userEvent.click(filter);
		await userEvent.click(page.getByRole("menuitemradio", { name: /Added/ }));

		await vi.waitFor(() => {
			expect(list.element().textContent).not.toContain("libblas");
		});
		expect(list.element().textContent).toContain("libgfortran");
		await expect
			.element(changes.getByRole("button", { name: "Filter dependency changes: Added" }))
			.toHaveAttribute("data-active");
	});

	it("retries a failed dependency preview from the solver error card", async () => {
		let attempt = 0;
		const previewInstall = vi.fn(async (): Promise<CondaPackagesPreviewResult> => {
			attempt += 1;
			if (attempt === 1) throw new Error("SOLVE_FAILED: conflict");
			return {
				upgraded: [],
				downgraded: [],
				added: [],
				removed: [],
				rebuilt: [],
				nothingToDo: true,
			};
		});
		const { baseElement } = renderDialog({ previewInstall });
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		await userEvent.click(screen.getByText("pandas", { exact: true }));
		const card = screen.getByTestId("environments-conda-add-pkg-preview-error");
		await expect.element(card, { timeout: 5_000 }).toBeVisible();
		await userEvent.click(card.getByRole("button", { name: "Try again" }));

		await vi.waitFor(() => {
			expect(previewInstall).toHaveBeenCalledTimes(2);
		});
		await expect.element(screen.getByText("No other packages change.")).toBeVisible();
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

		await waitForInstallEnabled(baseElement);
		await userEvent.click(screen.getByTestId("environments-conda-add-pkg-install-btn"));

		await vi.waitFor(() => {
			expect(install).toHaveBeenCalledOnce();
		});
		expect(install.mock.calls[0]![0]).toEqual({
			name: "dev",
			prefix: "/opt/anaconda3/envs/dev",
			packages: ["numpy=2.0.0", "pandas"],
			channels: ["conda-forge", "defaults"],
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

		await waitForInstallEnabled(baseElement);
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
			.element(screen.getByRole("complementary", { name: "Selected packages" }))
			.not.toBeInTheDocument();
	});

	it("grows the result list on scroll instead of paginating", async () => {
		const many = Array.from({ length: 80 }, (_, i) => pkg(`pkg-${String(i).padStart(2, "0")}`));
		const find = vi.fn((input: CondaRepodataFindInput) => many.slice(0, input.limit));
		const { baseElement } = renderDialog({ find, truncated: true });
		const screen = page.elementLocator(baseElement);

		await waitForRows(baseElement, 50);
		const scroller = baseElement.querySelector(
			'[data-qa-id="environments-conda-add-pkg-results"]',
		)! as HTMLElement;
		scroller.scrollTop = scroller.scrollHeight;

		await expect.element(screen.getByText("pkg-79", { exact: true })).toBeInTheDocument();
		expect(find.mock.calls.map(([input]) => input.limit)).toEqual(
			expect.arrayContaining([50, 100]),
		);
		expect(screen.getByRole("button", { name: "Next page" }).elements()).toHaveLength(0);
	});

	it("keeps the dialog open and shows the friendly error when install fails", async () => {
		const onClose = vi.fn();
		const { baseElement } = renderDialog({
			onClose,
			install: async () => {
				throw new Error("SOLVE_FAILED: conflict");
			},
		});
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		await userEvent.click(screen.getByText("pandas", { exact: true }));
		await waitForInstallEnabled(baseElement);
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
		await waitForInstallEnabled(baseElement);
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
		await waitForInstallEnabled(baseElement);
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
		await waitForInstallEnabled(baseElement);
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

	it("opens the channel chooser popover and toggles the selection into the search", async () => {
		const find = vi.fn((_input: CondaRepodataFindInput) => [pkg("numpy")]);
		const { baseElement } = renderDialog({
			find,
			channels: ["defaults", "conda-forge"],
			auth: authenticatedAuth,
		});
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 1);

		const trigger = screen.getByTestId("environments-conda-add-pkg-channels-btn");
		await expect.element(trigger).toHaveAccessibleName("Channels: All channels");
		await expect.element(trigger).not.toHaveAttribute("data-active");
		await userEvent.click(trigger);
		await expect.element(page.getByTestId("environments-channel-chooser")).toBeVisible();

		// Toggle Anaconda off — the search must re-run with only conda-forge.
		await userEvent.click(page.getByTestId("environments-channel-option-defaults"));

		await expect.element(trigger).toHaveAccessibleName("Channels: 1 channel");
		await expect.element(trigger).toHaveAttribute("data-active");
		await vi.waitFor(() => {
			expect(find.mock.calls.at(-1)![0].channels).toEqual(["conda-forge"]);
		});
	});
	it("keeps the install button disabled until the solver returns a solution", async () => {
		let resolvePreview!: (value: CondaPackagesPreviewResult) => void;
		const previewInstall = vi.fn(
			() =>
				new Promise<CondaPackagesPreviewResult>((resolve) => {
					resolvePreview = resolve;
				}),
		);
		const { baseElement } = renderDialog({ previewInstall });
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		await userEvent.click(screen.getByText("pandas", { exact: true }));

		// Wait for the debounced solve to be dispatched (it stays pending).
		await vi.waitFor(() => expect(previewInstall).toHaveBeenCalled(), { timeout: 3000 });

		// A package is selected but the solver has not returned yet: locked.
		await expect
			.element(screen.getByTestId("environments-conda-add-pkg-install-btn"))
			.toBeDisabled();

		resolvePreview(solvedPreview());

		// Solver returned a solution: the button unlocks.
		await waitForInstallEnabled(baseElement);
	});

	it("re-locks the install button when the selection changes until the solver re-solves", async () => {
		const gate = { release: () => {} };
		let solveCount = 0;
		const previewInstall = vi.fn(
			() =>
				new Promise<CondaPackagesPreviewResult>((resolve) => {
					solveCount += 1;
					if (solveCount === 1) {
						// First solve resolves immediately so the button can enable.
						resolve(solvedPreview());
					} else {
						// Hold the second solve pending so we can assert the re-lock.
						gate.release = () => resolve(solvedPreview());
					}
				}),
		);
		const { baseElement } = renderDialog({ previewInstall });
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		await userEvent.click(screen.getByText("numpy", { exact: true }));
		await waitForInstallEnabled(baseElement);

		// Change the selection: the prior solution is now stale, so the button
		// must re-lock until the solver returns for the new specs.
		await userEvent.click(screen.getByText("pandas", { exact: true }));
		await expect
			.element(screen.getByTestId("environments-conda-add-pkg-install-btn"))
			.toBeDisabled();

		await vi.waitFor(() => expect(solveCount).toBe(2), { timeout: 3000 });
		gate.release();
		await waitForInstallEnabled(baseElement);
	});

	it("re-locks the install button when the channel selection changes until the solver re-solves", async () => {
		const gate = { release: () => {} };
		let solveCount = 0;
		const channelsByCall: (string[] | undefined)[] = [];
		const previewInstall = vi.fn(
			(input: CondaPackagesPreviewInput) =>
				new Promise<CondaPackagesPreviewResult>((resolve) => {
					solveCount += 1;
					channelsByCall.push(input.channels);
					if (solveCount === 1) {
						// First solve resolves immediately so the button can enable.
						resolve(solvedPreview());
					} else {
						// Hold the re-solve pending so we can assert the re-lock.
						gate.release = () => resolve(solvedPreview());
					}
				}),
		);
		const { baseElement } = renderDialog({
			previewInstall,
			channels: ["defaults", "conda-forge"],
			auth: authenticatedAuth,
		});
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		await userEvent.click(screen.getByText("numpy", { exact: true }));
		await waitForInstallEnabled(baseElement);

		// Toggle a channel off. The solver resolves against channels too, so the
		// prior solution is now stale and Install must re-lock until the solver
		// re-solves for the new channel set.
		await userEvent.click(screen.getByTestId("environments-conda-add-pkg-channels-btn"));
		await userEvent.click(page.getByTestId("environments-channel-option-defaults"));
		await expect
			.element(screen.getByTestId("environments-conda-add-pkg-install-btn"))
			.toBeDisabled();

		// The re-solve must run with the narrowed channel set before Install re-enables.
		await vi.waitFor(() => expect(solveCount).toBe(2), { timeout: 3000 });
		expect(channelsByCall[1]).toEqual(["conda-forge"]);
		gate.release();
		await waitForInstallEnabled(baseElement);
	});

	it("ignores a stale in-flight solve that lands during the debounce after the selection changed", async () => {
		// Each solve stays pending until we resolve it.
		const resolvers: ((value: CondaPackagesPreviewResult) => void)[] = [];
		const previewInstall = vi.fn(
			() =>
				new Promise<CondaPackagesPreviewResult>((resolve) => {
					resolvers.push(resolve);
				}),
		);
		const { baseElement } = renderDialog({ previewInstall });
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		// Selection A dispatches the first (still pending) solve.
		await userEvent.click(screen.getByText("numpy", { exact: true }));
		await vi.waitFor(() => expect(resolvers).toHaveLength(1), { timeout: 3000 });

		// Change to selection B. The re-solve for B is still inside its 1500ms
		// debounce, so no second solve has dispatched yet.
		await userEvent.click(screen.getByText("pandas", { exact: true }));
		expect(resolvers).toHaveLength(1);

		// The stale solve for selection A lands during that debounce window. It
		// must NOT unlock Install for the new, unvalidated selection B. Give the
		// stale result time to flush through React, then assert the button stayed
		// locked — polling assertions could pass on a transient re-lock, so read
		// the settled state directly.
		resolvers[0]!(solvedPreview());
		await new Promise((resolve) => setTimeout(resolve, 300));
		const installBtn = baseElement.querySelector(
			'[data-qa-id="environments-conda-add-pkg-install-btn"]',
		);
		expect(installBtn?.hasAttribute("disabled")).toBe(true);

		// Once the debounced solve for B dispatches and resolves, Install unlocks.
		await vi.waitFor(() => expect(resolvers).toHaveLength(2), { timeout: 3000 });
		resolvers[1]!(solvedPreview());
		await waitForInstallEnabled(baseElement);
	});

	it("keeps the install button disabled when the solver cannot find a solution", async () => {
		const previewInstall = vi.fn(async () => {
			throw new Error("SOLVE_FAILED: package conflict");
		});
		const install = vi.fn(async () => installResult());
		const { baseElement } = renderDialog({ previewInstall, install });
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		await userEvent.click(screen.getByText("pandas", { exact: true }));

		// The solver reports no solution: the button must never enable.
		await vi.waitFor(() => expect(previewInstall).toHaveBeenCalled(), { timeout: 3000 });
		await expect
			.element(screen.getByTestId("environments-conda-add-pkg-install-btn"))
			.toBeDisabled();

		// Force a click anyway — install must not be attempted.
		await userEvent.click(screen.getByTestId("environments-conda-add-pkg-install-btn"), {
			force: true,
		});
		expect(install).not.toHaveBeenCalled();
	});
});
