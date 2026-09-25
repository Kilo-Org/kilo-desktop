import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import type { AuthSession, SDK } from "@kilo-desktop/feature-sdk";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import {
	condaContract,
	type CondaEnvsCreateInput,
	type CondaEnvsCreateResult,
	type CondaRepodataFindInput,
	type CondaRepodataFindResult,
	type CondaRepodataPackage,
} from "../../../contracts/providers/conda.js";
import { CreateEnvironmentDialog } from "./CreateEnvironmentDialog.js";

function pkg(name: string, versions: string[] = []): CondaRepodataPackage {
	return {
		name,
		version: versions[0] ?? "1.0.0",
		build: 0,
		channel: "https://conda.anaconda.org/conda-forge",
		summary: "",
		home: "",
		versions: versions.map((version) => ({ version, size: 1000 })),
	};
}

function pkgWithSizes(
	name: string,
	versions: { version: string; size: number }[],
): CondaRepodataPackage {
	return {
		name,
		version: versions[0]?.version ?? "1.0.0",
		build: 0,
		channel: "https://conda.anaconda.org/conda-forge",
		summary: "",
		home: "",
		versions,
	};
}

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

function renderDialog(
	options: {
		find?: () => CondaRepodataPackage[];
		/** Full control over the search response, e.g. to page by `limit`. */
		search?: (input: CondaRepodataFindInput) => CondaRepodataFindResult;
		create?: (input: CondaEnvsCreateInput) => CondaEnvsCreateResult;
		channels?: string[];
		envsDirs?: string[];
		auth?: Partial<SDK["auth"]>;
	} = {},
) {
	const find = options.find ?? (() => [pkg("numpy", ["1.26.4", "1.25.0"]), pkg("pandas")]);
	const create: (input: CondaEnvsCreateInput) => CondaEnvsCreateResult =
		options.create ?? (() => ({ jobId: "job-1", environment: { name: "x", prefix: "/x" } }));
	const sdk = createFakeSdk({
		featureId: "environments",
		channels: condaContract,
		handlers: {
			"conda.envs.list": async () => [],
			"conda.envs.prefixOptions": async () => ({
				envsDirs: options.envsDirs ?? ["/opt/anaconda3/envs"],
				channels: options.channels ?? ["defaults", "conda-forge"],
			}),
			"conda.repodata.find": async (input: CondaRepodataFindInput) =>
				options.search ? options.search(input) : { packages: find(), truncated: false },
			"conda.envs.create": async (input: CondaEnvsCreateInput) => create(input),
		},
		auth: options.auth ?? {},
	});
	const system = createFakeFeatureSystem({ sdks: { environments: sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<CreateEnvironmentDialog open onClose={() => {}} />
			</QueryClientProvider>
		</SdkProvider>,
	);
}

afterEach(cleanup);

describe("CreateEnvironmentDialog (modal)", () => {
	it("renders the manual create modal with the package grid populated", async () => {
		const { baseElement } = renderDialog();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("environments-create-dialog")).toBeVisible();
		// As the first test in the file this one absorbs browser and module warm-up,
		// which outran the default matcher window on CI even though the grid renders
		// fine, hence the explicit timeout.
		const rows = screen.getByTestId("environments-create-package-row");
		await expect.element(rows.first(), { timeout: 10_000 }).toBeVisible();
	});

	it("selecting a package adds it to the Selected Packages sidebar", async () => {
		const { baseElement } = renderDialog();
		const screen = page.elementLocator(baseElement);
		const panel = screen.getByRole("complementary", { name: "Selected packages" });
		await expect
			.element(screen.getByTestId("environments-create-package-row").first(), { timeout: 10_000 })
			.toBeVisible();
		await expect.element(panel).not.toBeInTheDocument();

		await userEvent.click(screen.getByText("numpy", { exact: true }));

		await expect.element(panel).toBeVisible();
		await expect
			.element(screen.getByTestId("environments-create-selected-count"))
			.toHaveTextContent("1");
		const item = screen.getByTestId("environments-create-selected-item");
		await expect.element(item).toBeVisible();
		expect(await item.element().textContent).toContain("numpy");
	});

	it("builds a create payload with pinned version and python spec", async () => {
		const create = vi.fn((_input: CondaEnvsCreateInput): CondaEnvsCreateResult => ({
			jobId: "j",
			environment: { name: "env", prefix: "/p" },
		}));
		const { baseElement } = renderDialog({
			find: () => [pkg("numpy", ["1.26.4", "1.25.0"]), pkg("python", ["3.13.1", "3.11.9"])],
			create,
		});
		const screen = page.elementLocator(baseElement);

		// Pin numpy@1.25.0 on its row, then select it.
		await userEvent.click(screen.getByRole("combobox", { name: "Version for numpy" }));
		await userEvent.click(screen.getByRole("option", { name: "1.25.0" }));
		await userEvent.click(screen.getByText("numpy", { exact: true }));

		// Choose a specific Python version derived from repodata.
		await userEvent.click(screen.getByTestId("environments-create-python"));
		await userEvent.click(screen.getByRole("option", { name: "3.11.9" }));

		await userEvent.fill(screen.getByTestId("environments-create-name"), "myenv");
		await userEvent.click(screen.getByTestId("environments-create-submit"));

		await vi.waitFor(() => {
			expect(create).toHaveBeenCalledOnce();
		});
		const payload = create.mock.calls[0]![0] as CondaEnvsCreateInput & { packages?: string[] };
		expect(payload.name).toBe("myenv");
		expect(payload.packages).toContain("numpy=1.25.0");
		expect(payload.packages).toContain("python=3.11.9");
	});

	it("keeps the dialog open after a successful create and shows an inline confirmation", async () => {
		const { baseElement } = renderDialog();
		const screen = page.elementLocator(baseElement);

		await userEvent.fill(screen.getByTestId("environments-create-name"), "myenv");
		await userEvent.click(screen.getByTestId("environments-create-submit"));

		const success = screen.getByTestId("environments-create-success");
		await expect.element(success).toBeVisible();
		expect(await success.element().textContent).toContain("myenv was created.");
		await expect.element(screen.getByTestId("environments-create-dialog")).toBeVisible();
		// Form state is preserved so the user can review what was created.
		await expect.element(screen.getByTestId("environments-create-name")).toHaveValue("myenv");
	});

	it("opens the channel chooser popover from the Channels button", async () => {
		const { baseElement } = renderDialog();
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-create-channels-button"));
		const chooser = page.getByTestId("environments-channel-chooser");
		await expect.element(chooser).toBeVisible();
		await expect
			.element(chooser.getByRole("menuitemcheckbox", { name: /conda-forge/ }))
			.toBeVisible();
		await expect.element(chooser.getByRole("menuitemcheckbox", { name: /Anaconda/ })).toBeVisible();
	});

	it("offers the product channel selector when conda reports no configured channels", async () => {
		const { baseElement } = renderDialog({ channels: [] });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-create-channels-button"));
		const chooser = page.getByTestId("environments-channel-chooser");
		await expect
			.element(chooser.getByRole("menuitemcheckbox", { name: /conda-forge/ }))
			.toBeVisible();
		await expect.element(chooser.getByRole("menuitemcheckbox", { name: /Anaconda/ })).toBeVisible();
		await expect.element(chooser.getByText("No channels configured.")).not.toBeInTheDocument();
	});

	it("gates the Anaconda channel behind the sign-in modal while signed out", async () => {
		const login = vi.fn(async (): Promise<AuthSession> => ({ status: "anonymous" }));
		const { baseElement } = renderDialog({ auth: { login } });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-create-channels-button"));
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
		const create = vi.fn((_input: CondaEnvsCreateInput): CondaEnvsCreateResult => ({
			jobId: "j",
			environment: { name: "env", prefix: "/p" },
		}));
		const { baseElement } = renderDialog({
			create,
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

		await userEvent.click(screen.getByTestId("environments-create-channels-button"));
		await userEvent.click(page.getByTestId("environments-channel-option-defaults"));
		await userEvent.click(page.getByTestId("anaconda-sign-in-submit"));

		await expect.element(page.getByTestId("anaconda-sign-in-dialog")).not.toBeInTheDocument();

		// The reactive session update must ungate the channel: toggling it now
		// goes through selection directly instead of re-opening the sign-in modal.
		await userEvent.click(screen.getByTestId("environments-create-channels-button"));
		await userEvent.click(page.getByTestId("environments-channel-option-defaults"));
		await expect
			.element(page.getByTestId("environments-channel-option-defaults"))
			.toHaveAttribute("aria-checked", "false");
		await userEvent.click(page.getByTestId("environments-channel-option-defaults"));
		await expect
			.element(page.getByTestId("environments-channel-option-defaults"))
			.toHaveAttribute("aria-checked", "true");

		await userEvent.fill(screen.getByTestId("environments-create-name"), "myenv");
		await userEvent.click(screen.getByTestId("environments-create-submit"));

		await vi.waitFor(() => {
			expect(create).toHaveBeenCalledOnce();
		});
		const payload = create.mock.calls[0]![0];
		expect(payload.channels).toEqual(["conda-forge", "defaults"]);
	});

	it("leaves the Anaconda channel unselected for signed-out users on create", async () => {
		const create = vi.fn((_input: CondaEnvsCreateInput): CondaEnvsCreateResult => ({
			jobId: "j",
			environment: { name: "env", prefix: "/p" },
		}));
		const { baseElement } = renderDialog({ create });
		const screen = page.elementLocator(baseElement);

		await userEvent.fill(screen.getByTestId("environments-create-name"), "myenv");
		await userEvent.click(screen.getByTestId("environments-create-submit"));

		await vi.waitFor(() => {
			expect(create).toHaveBeenCalledOnce();
		});
		expect(create.mock.calls[0]![0].channels).toEqual(["conda-forge"]);
	});

	it("shows validation error when name is empty and submit is clicked", async () => {
		const { baseElement } = renderDialog();
		const screen = page.elementLocator(baseElement);

		// Name is empty by default, button should be disabled
		await expect.element(screen.getByTestId("environments-create-submit")).toBeDisabled();
	});

	it("shows 'No packages available' when the package search is empty", async () => {
		const { baseElement } = renderDialog({ find: () => [] });
		const screen = page.elementLocator(baseElement);

		await vi.waitFor(async () => {
			await expect.element(screen.getByText("No packages available")).toBeVisible();
		});
	});

	it("shows 'No results for ...' when search returns empty", async () => {
		const { baseElement } = renderDialog({ find: () => [] });
		const screen = page.elementLocator(baseElement);

		await userEvent.fill(screen.getByTestId("environments-create-package-search"), "nonexistent");

		await vi.waitFor(async () => {
			await expect.element(screen.getByText(/No results for/)).toBeVisible();
		});
	});

	it("removes a package from the selected sidebar", async () => {
		const { baseElement } = renderDialog();
		const screen = page.elementLocator(baseElement);

		// Select numpy
		await userEvent.click(screen.getByText("numpy", { exact: true }));
		await expect
			.element(screen.getByTestId("environments-create-selected-count"))
			.toHaveTextContent("1");

		// Remove it via the sidebar X button; the emptied panel closes.
		await userEvent.click(screen.getByRole("button", { name: "Remove numpy" }));
		await expect
			.element(screen.getByRole("complementary", { name: "Selected packages" }))
			.not.toBeInTheDocument();
	});

	it("deselects a package by clicking the row again", async () => {
		const { baseElement } = renderDialog();
		const screen = page.elementLocator(baseElement);

		// Select numpy via the package row
		const numpyRow = screen.getByTestId("environments-create-package-row").first();
		await userEvent.click(numpyRow);
		await expect
			.element(screen.getByTestId("environments-create-selected-count"))
			.toHaveTextContent("1");

		// Click the same grid row to deselect — use the first package row
		// (which is numpy) to avoid the sidebar duplicate.
		await userEvent.click(screen.getByTestId("environments-create-package-row").first());
		await expect
			.element(screen.getByRole("complementary", { name: "Selected packages" }))
			.not.toBeInTheDocument();
	});

	it("displays packages without version list using a plain text version", async () => {
		const { baseElement } = renderDialog({
			find: () => [pkg("simple-pkg")],
		});
		const screen = page.elementLocator(baseElement);

		await vi.waitFor(async () => {
			await expect.element(screen.getByText("simple-pkg")).toBeVisible();
		});
		// The version text should show — no Select combobox for this package.
		await expect.element(screen.getByText("1.0.0")).toBeVisible();
	});

	it("loads more results when the list is scrolled to the end", async () => {
		const all = Array.from({ length: 120 }, (_, i) =>
			pkg(`pkg-${String(i).padStart(3, "0")}`, ["1.0.0"]),
		);
		const search = vi.fn((input: CondaRepodataFindInput) => ({
			packages: all.slice(0, input.limit),
			truncated: input.limit < all.length,
		}));
		const { baseElement } = renderDialog({ search });
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("environments-create-package-row").first(), { timeout: 10_000 })
			.toBeVisible();
		const packageSearches = () => search.mock.calls.map(([input]) => input).filter((i) => !i.names);
		expect(packageSearches()[0]?.limit).toBe(50);
		expect(
			baseElement.querySelectorAll('[data-qa-id="environments-create-package-row"]'),
		).toHaveLength(50);

		const scroller = baseElement.querySelector(
			'[data-qa-id="environments-create-package-results"]',
		)! as HTMLElement;
		scroller.scrollTop = scroller.scrollHeight;

		await expect.element(screen.getByText("pkg-099")).toBeInTheDocument();
		expect(packageSearches().map((input) => input.limit)).toContain(100);
		// No pager: the list simply grows.
		expect(baseElement.querySelector('[data-qa-id*="package-next"]')).toBeNull();
	});

	it("asks the user to refine the search once the result cap is reached", async () => {
		const pkgs = Array.from({ length: 5 }, (_, i) => pkg(`pkg-${i}`, ["1.0.0"]));
		const { baseElement } = renderDialog({
			search: () => ({ packages: pkgs, truncated: true }),
		});
		const screen = page.elementLocator(baseElement);
		await expect
			.element(screen.getByTestId("environments-create-package-row").first(), { timeout: 10_000 })
			.toBeVisible();

		// Keep scrolling to the end: each batch widens the request until the cap.
		await vi.waitFor(
			() => {
				const scroller = baseElement.querySelector(
					'[data-qa-id="environments-create-package-results"]',
				)! as HTMLElement;
				scroller.scrollTop = scroller.scrollHeight;
				expect(
					baseElement.querySelector('[data-qa-id="environments-create-package-refine-hint"]'),
				).not.toBeNull();
			},
			{ timeout: 10_000, interval: 100 },
		);
		await expect
			.element(screen.getByTestId("environments-create-package-refine-hint"))
			.toHaveTextContent("Refine your search to see more results");
	});

	it("sends channels and prefix when location differs from default", async () => {
		const create = vi.fn((_input: CondaEnvsCreateInput): CondaEnvsCreateResult => ({
			jobId: "j",
			environment: { name: "env", prefix: "/custom/myenv" },
		}));
		const { baseElement } = renderDialog({ create, auth: authenticatedAuth });
		const screen = page.elementLocator(baseElement);

		// Change location to a custom path
		await userEvent.clear(screen.getByTestId("environments-create-location"));
		await userEvent.fill(screen.getByTestId("environments-create-location"), "/custom");
		await userEvent.fill(screen.getByTestId("environments-create-name"), "myenv");
		await userEvent.click(screen.getByTestId("environments-create-submit"));

		await vi.waitFor(() => {
			expect(create).toHaveBeenCalledOnce();
		});
		const payload = create.mock.calls[0]![0];
		expect(payload.prefix).toBe("/custom/myenv");
		expect(payload.channels).toEqual(["conda-forge", "defaults"]);
	});

	it("filters the Python version list via the picker search box", async () => {
		const { baseElement } = renderDialog({
			find: () => [pkg("python", ["3.13.1", "3.12.4", "3.11.9"])],
		});
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-create-python"));
		await expect.element(screen.getByRole("option", { name: "3.11.9" })).toBeVisible();

		await userEvent.fill(screen.getByTestId("environments-create-python-search"), "3.13");

		await expect.element(screen.getByRole("option", { name: "3.13.1" })).toBeVisible();
		await vi.waitFor(async () => {
			expect(await screen.getByRole("option", { name: "3.11.9" }).all()).toHaveLength(0);
		});
	});

	it("shows the package size column for the latest version by default", async () => {
		const { baseElement } = renderDialog({
			find: () => [
				pkgWithSizes("numpy", [
					{ version: "1.26.4", size: 1_500_000 },
					{ version: "1.25.0", size: 1_200_000 },
				]),
			],
		});
		const screen = page.elementLocator(baseElement);

		await vi.waitFor(async () => {
			await expect
				.element(screen.getByTestId("environments-create-package-size-numpy"))
				.toBeVisible();
		});
		await expect
			.element(screen.getByTestId("environments-create-package-size-numpy"))
			.toHaveTextContent("1.4 MB");
	});

	it("updates the size column when a different version is pinned", async () => {
		const { baseElement } = renderDialog({
			find: () => [
				pkgWithSizes("numpy", [
					{ version: "1.26.4", size: 1_500_000 },
					{ version: "1.25.0", size: 512_000 },
				]),
			],
		});
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("environments-create-package-size-numpy"), { timeout: 10_000 })
			.toHaveTextContent("1.4 MB");

		await userEvent.click(screen.getByRole("combobox", { name: "Version for numpy" }));
		await userEvent.click(screen.getByRole("option", { name: "1.25.0" }));

		await expect
			.element(screen.getByTestId("environments-create-package-size-numpy"))
			.toHaveTextContent("500.0 KB");
	});

	it("shows an em-dash for the size when a package has no versions", async () => {
		const { baseElement } = renderDialog({
			find: () => [pkg("simple-pkg")],
		});
		const screen = page.elementLocator(baseElement);

		await vi.waitFor(async () => {
			await expect
				.element(screen.getByTestId("environments-create-package-size-simple-pkg"))
				.toBeVisible();
		});
		await expect
			.element(screen.getByTestId("environments-create-package-size-simple-pkg"))
			.toHaveTextContent("—");
	});

	it("shows all merged location dirs in the dropdown with default first", async () => {
		const { baseElement } = renderDialog({
			envsDirs: ["/opt/anaconda3/envs", "/opt/miniconda3/envs", "/home/user/.conda/envs"],
		});
		const screen = page.elementLocator(baseElement);

		// Location input should pre-fill with the first (default) dir —
		// the highest-priority distribution.
		await expect
			.element(screen.getByTestId("environments-create-location"))
			.toHaveValue("/opt/anaconda3/envs");

		// Open the suggestion dropdown by focusing the input.
		await userEvent.click(screen.getByTestId("environments-create-location"));

		await expect.element(screen.getByText("/opt/miniconda3/envs")).toBeVisible();
		await expect.element(screen.getByText("/home/user/.conda/envs")).toBeVisible();

		// The first entry should have the "default" badge.
		await expect.element(screen.getByText("default")).toBeVisible();
	});

	it("sends correct prefix when a non-default location is selected", async () => {
		const create = vi.fn((_input: CondaEnvsCreateInput): CondaEnvsCreateResult => ({
			jobId: "j",
			environment: { name: "myenv", prefix: "/home/user/.conda/envs/myenv" },
		}));
		const { baseElement } = renderDialog({
			create,
			envsDirs: ["/opt/anaconda3/envs", "/home/user/.conda/envs"],
		});
		const screen = page.elementLocator(baseElement);

		// Open suggestions and pick the non-default dir.
		await userEvent.click(screen.getByTestId("environments-create-location"));
		await userEvent.click(screen.getByText("/home/user/.conda/envs"));

		await expect
			.element(screen.getByTestId("environments-create-location"))
			.toHaveValue("/home/user/.conda/envs");

		await userEvent.fill(screen.getByTestId("environments-create-name"), "myenv");
		await userEvent.click(screen.getByTestId("environments-create-submit"));

		await vi.waitFor(() => {
			expect(create).toHaveBeenCalledOnce();
		});
		const payload = create.mock.calls[0]![0];
		expect(payload.prefix).toBe("/home/user/.conda/envs/myenv");
	});
});
