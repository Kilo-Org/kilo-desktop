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

function renderDialog(
	options: {
		find?: (input: CondaRepodataFindInput) => CondaRepodataPackage[];
		truncated?: boolean;
		install?: (input: CondaPackagesInstallInput) => Promise<CondaPackagesInstallResult>;
		previewInstall?: () => Promise<CondaPackagesPreviewResult>;
		installed?: CondaPackage[];
		channels?: string[];
		onClose?: () => void;
		auth?: Partial<SDK["auth"]>;
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
			"conda.packages.previewInstall":
				options.previewInstall ??
				(async () => ({
					upgraded: [],
					downgraded: [],
					added: [],
					removed: [],
					rebuilt: [],
					nothingToDo: true,
				})),
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

afterEach(cleanup);

describe("AddPackageDialog", () => {
	it("searches repodata with the query and selected channels after the debounce", async () => {
		const find = vi.fn((_input: CondaRepodataFindInput) => [pkg("numpy")]);
		const { baseElement } = renderDialog({ find, channels: ["conda-forge"] });
		const screen = page.elementLocator(baseElement);

		await waitForRows(baseElement, 1);
		// Initial search waits for prefixOptions so the channel filter is present.
		expect(find.mock.calls[0]![0]).toMatchObject({ channels: ["conda-forge"], limit: 50 });
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

	it("skips Anaconda in the default channel selection for signed-out users", async () => {
		const find = vi.fn((_input: CondaRepodataFindInput) => [pkg("numpy")]);
		const { baseElement } = renderDialog({ find, channels: ["defaults", "conda-forge"] });
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 1);

		// Anonymous session drops the Anaconda channel from the seeded selection.
		expect(find.mock.calls[0]![0].channels).toEqual(["conda-forge"]);
		const trigger = screen.getByTestId("environments-conda-add-pkg-channels-btn");
		await expect.element(trigger).toHaveAccessibleName("Channels: 1 channel");
		// The signed-out default is not a user customization.
		await expect.element(trigger).not.toHaveAttribute("data-active");
	});

	it("gates the Anaconda channel behind the sign-in modal while signed out", async () => {
		const login = vi.fn(async (): Promise<AuthSession> => ({ status: "anonymous" }));
		const { baseElement } = renderDialog({
			channels: ["defaults", "conda-forge"],
			auth: { login },
		});
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		await userEvent.click(screen.getByTestId("environments-conda-add-pkg-channels-btn"));
		await userEvent.click(page.getByTestId("environments-channel-option-defaults"));

		const modal = page.getByTestId("anaconda-sign-in-dialog");
		await expect.element(modal).toBeVisible();
		expect(login).not.toHaveBeenCalled();

		await userEvent.click(page.getByTestId("anaconda-sign-in-submit"));
		await vi.waitFor(() => {
			expect(login).toHaveBeenCalledOnce();
		});
		// Anonymous result keeps the modal open with the channel unapplied.
		await expect.element(modal).toBeVisible();
	});

	it("applies the Anaconda channel after a successful sign-in", async () => {
		let session: AuthSession = { status: "anonymous" };
		const listeners = new Set<(next: AuthSession) => void>();
		const login = vi.fn(async (): Promise<AuthSession> => {
			session = { status: "authenticated", user: { username: "ada" } };
			for (const listener of listeners) listener(session);
			return session;
		});
		const install = vi.fn(async (_input: CondaPackagesInstallInput) => installResult());
		const { baseElement } = renderDialog({
			install,
			channels: ["defaults", "conda-forge"],
			auth: {
				subscribe(listener) {
					listeners.add(listener);
					listener(session);
					return () => listeners.delete(listener);
				},
				peek: () => session,
				login,
			},
		});
		const screen = page.elementLocator(baseElement);
		await waitForRows(baseElement, 2);

		await userEvent.click(screen.getByTestId("environments-conda-add-pkg-channels-btn"));
		await userEvent.click(page.getByTestId("environments-channel-option-defaults"));
		await userEvent.click(page.getByTestId("anaconda-sign-in-submit"));

		await expect.element(page.getByTestId("anaconda-sign-in-dialog")).not.toBeInTheDocument();

		// Install now sends both channels, with Anaconda applied after the OAuth landed.
		await userEvent.click(screen.getByText("pandas", { exact: true }));
		await userEvent.click(screen.getByTestId("environments-conda-add-pkg-install-btn"));

		await vi.waitFor(() => {
			expect(install).toHaveBeenCalledOnce();
		});
		expect(install.mock.calls[0]![0].channels).toEqual(["conda-forge", "defaults"]);
	});
});
