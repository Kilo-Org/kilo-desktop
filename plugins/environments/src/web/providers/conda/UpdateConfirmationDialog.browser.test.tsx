import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import {
	condaContract,
	type CondaEnv,
	type CondaEnvsCloneInput,
	type CondaEnvsCloneResult,
	type CondaPackageChange,
	type CondaPackagesPreviewInput,
	type CondaPackagesPreviewResult,
	type CondaPackagesUpdateInput,
	type CondaPackagesUpdateResult,
} from "../../../contracts/providers/conda.js";
import { UpdateConfirmationDialog, type UpgradablePackage } from "./UpdateConfirmationDialog.js";

const ENV: CondaEnv = { name: "dev", prefix: "/opt/anaconda3/envs/dev" };

function upgradable(name: string, installed: string, newer: string[] = []): UpgradablePackage {
	return {
		pkg: { name, version: installed, build: "py_0", channel: "conda-forge" },
		latestVersion: newer[0] ?? null,
		availableVersions: newer,
	};
}

function change(
	name: string,
	fromVersion: string | null,
	toVersion: string | null,
): CondaPackageChange {
	return { name, fromVersion, toVersion, channel: "conda-forge" };
}

function emptyPreview(): CondaPackagesPreviewResult {
	return { upgraded: [], downgraded: [], added: [], removed: [], rebuilt: [], nothingToDo: true };
}

function previewWith(partial: Partial<CondaPackagesPreviewResult>): CondaPackagesPreviewResult {
	return { ...emptyPreview(), nothingToDo: false, ...partial };
}

function updateResult(): CondaPackagesUpdateResult {
	return { jobId: "job-1", envName: "dev", updated: [] };
}

function renderDialog(
	options: {
		items?: UpgradablePackage[];
		preview?: (input: CondaPackagesPreviewInput) => Promise<CondaPackagesPreviewResult>;
		update?: (input: CondaPackagesUpdateInput) => Promise<CondaPackagesUpdateResult>;
		clone?: (input: CondaEnvsCloneInput) => Promise<CondaEnvsCloneResult>;
		existingEnvs?: CondaEnv[];
		onClose?: () => void;
		onSuccess?: () => void;
		onUpdatingChange?: (count: number) => void;
	} = {},
) {
	const items = options.items ?? [
		upgradable("numpy", "2.0.0", ["2.1.0", "2.0.1"]),
		upgradable("pandas", "2.2.0", ["2.3.0"]),
	];
	const preview =
		options.preview ?? (async () => previewWith({ upgraded: [change("numpy", "2.0.0", "2.1.0")] }));
	const update = options.update ?? (async () => updateResult());
	const clone =
		options.clone ??
		(async (input: CondaEnvsCloneInput) => ({
			jobId: "job-c",
			environment: { name: input.name, prefix: `/opt/anaconda3/envs/${input.name}` },
		}));

	const sdk = createFakeSdk({
		featureId: "environments",
		channels: condaContract,
		handlers: {
			"conda.envs.list": async () => options.existingEnvs ?? [ENV],
			"conda.envs.clone": clone,
			"conda.packages.preview": preview,
			"conda.packages.update": update,
		},
	});
	const system = createFakeFeatureSystem({ sdks: { environments: sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<UpdateConfirmationDialog
					env={ENV}
					upgradablePackages={items}
					open
					onClose={options.onClose ?? (() => {})}
					onSuccess={options.onSuccess ?? (() => {})}
					{...(options.onUpdatingChange ? { onUpdatingChange: options.onUpdatingChange } : {})}
				/>
			</QueryClientProvider>
		</SdkProvider>,
	);
}

afterEach(cleanup);

describe("UpdateConfirmationDialog", () => {
	it("auto-runs a preview on open with every upgradable package pinned to its latest version", async () => {
		const preview = vi.fn(async (_input: CondaPackagesPreviewInput) =>
			previewWith({
				upgraded: [change("numpy", "2.0.0", "2.1.0"), change("libblas", "3.9.0", "3.9.1")],
				added: [change("libgfortran", null, "5.0.0")],
				removed: [change("legacy-dep", "1.0", null)],
			}),
		);
		const { baseElement } = renderDialog({ preview });
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("environments-conda-update-confirm-dialog"))
			.toBeVisible();
		await vi.waitFor(() => {
			expect(preview).toHaveBeenCalledOnce();
		});
		expect(preview.mock.calls[0]![0]).toEqual({
			name: "dev",
			prefix: "/opt/anaconda3/envs/dev",
			packages: ["numpy=2.1.0", "pandas=2.3.0"],
		});

		// The dependency panel lists only transitive changes — the packages
		// the user chose (numpy) are shown on the left, not repeated here.
		const panel = screen.getByTestId("environments-conda-update-confirm-preview");
		await expect.element(panel).toBeVisible();
		const text = (await panel.element().textContent) ?? "";
		expect(text).toContain("libblas");
		expect(text).toContain("libgfortran");
		expect(text).toContain("legacy-dep");
		expect(text).toContain("3 total changes");
		expect(text).not.toContain("numpy");

		await expect.element(screen.getByTestId("environments-conda-update-confirm-btn")).toBeEnabled();
	});

	it("shows the up-to-date state when the solver has nothing to do", async () => {
		const { baseElement } = renderDialog({ preview: async () => emptyPreview() });
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByTestId("environments-conda-update-confirm-nothing-to-do"))
			.toBeVisible();
		await expect.element(screen.getByTestId("environments-conda-update-confirm-btn")).toBeEnabled();
	});

	it("surfaces solver conflicts with the friendly message and raw detail, and blocks submit", async () => {
		const detail = "The following packages are incompatible\n└─ pin on python =3.11";
		const { baseElement } = renderDialog({
			preview: async () => {
				throw new Error(`[BUSINESS] SOLVE_FAILED: ${detail}`);
			},
		});
		const screen = page.elementLocator(baseElement);

		const card = screen.getByTestId("environments-conda-update-confirm-error");
		await expect.element(card).toBeVisible();
		const text = (await card.element().textContent) ?? "";
		expect(text).toContain("Could not resolve a compatible set of packages.");
		expect(text).toContain("pin on python =3.11");
		await expect
			.element(screen.getByTestId("environments-conda-update-confirm-btn"))
			.toBeDisabled();
	});

	it("clears the solver error card when the user unchecks all packages", async () => {
		const detail = "The following packages are incompatible\n└─ pin on python =3.11";
		const { baseElement } = renderDialog({
			preview: async () => {
				throw new Error(`[BUSINESS] SOLVE_FAILED: ${detail}`);
			},
		});
		const screen = page.elementLocator(baseElement);

		// Wait for the error to appear.
		await expect
			.element(screen.getByTestId("environments-conda-update-confirm-error"))
			.toBeVisible();

		// Uncheck all — "Nothing to update" should replace the error.
		await userEvent.click(screen.getByTestId("environments-conda-update-confirm-select-all"));

		await expect
			.element(screen.getByTestId("environments-conda-update-confirm-nothing-selected"))
			.toBeVisible();
		expect(await screen.getByTestId("environments-conda-update-confirm-error").all()).toHaveLength(
			0,
		);
	});

	it("renders already up-to-date packages without a checkbox and keeps them out of the solve", async () => {
		const preview = vi.fn(async (_input: CondaPackagesPreviewInput) => emptyPreview());
		const { baseElement } = renderDialog({
			items: [upgradable("numpy", "2.0.0", ["2.1.0"]), upgradable("requests", "2.32.3")],
			preview,
		});
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("up to date")).toBeVisible();
		expect(
			await screen.getByRole("checkbox", { name: "Include numpy in update" }).all(),
		).toHaveLength(1);
		expect(
			await screen.getByRole("checkbox", { name: "Include requests in update" }).all(),
		).toHaveLength(0);

		await vi.waitFor(() => {
			expect(preview).toHaveBeenCalledOnce();
		});
		expect(preview.mock.calls[0]![0].packages).toEqual(["numpy=2.1.0"]);
		expect(await screen.getByText(/Update 1 Package in/).element().textContent).toContain(
			"Update 1 Package",
		);
	});

	it("unchecking a package marks the preview stale and auto re-solves without it", async () => {
		const preview = vi.fn(async (_input: CondaPackagesPreviewInput) =>
			previewWith({ upgraded: [change("libblas", "3.9.0", "3.9.1")] }),
		);
		const { baseElement } = renderDialog({ preview });
		const screen = page.elementLocator(baseElement);

		await vi.waitFor(() => {
			expect(preview).toHaveBeenCalledOnce();
		});
		await userEvent.click(screen.getByRole("checkbox", { name: "Include pandas in update" }));

		await expect
			.element(screen.getByTestId("environments-conda-update-confirm-preview-btn"))
			.toHaveTextContent("Pending…");
		// Auto-preview debounces for 2 s before re-solving.
		await vi.waitFor(
			() => {
				expect(preview).toHaveBeenCalledTimes(2);
			},
			{ timeout: 5000 },
		);
		expect(preview.mock.calls[1]![0].packages).toEqual(["numpy=2.1.0"]);
		expect(await screen.getByText(/Update 1 Package in/).element().textContent).toContain(
			"Update 1 Package",
		);
	});

	it("with Auto off, a stale preview shows the refresh overlay until the user re-runs it", async () => {
		const preview = vi.fn(async (_input: CondaPackagesPreviewInput) =>
			previewWith({ upgraded: [change("libblas", "3.9.0", "3.9.1")] }),
		);
		const { baseElement } = renderDialog({ preview });
		const screen = page.elementLocator(baseElement);

		await vi.waitFor(() => {
			expect(preview).toHaveBeenCalledOnce();
		});
		await userEvent.click(screen.getByTestId("environments-conda-update-confirm-auto-check"));
		await userEvent.click(screen.getByRole("checkbox", { name: "Include pandas in update" }));

		await expect
			.element(screen.getByTestId("environments-conda-update-confirm-stale"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("environments-conda-update-confirm-preview-btn"))
			.toHaveTextContent("Preview");

		await userEvent.click(screen.getByTestId("environments-conda-update-confirm-refresh-btn"));
		await vi.waitFor(() => {
			expect(preview).toHaveBeenCalledTimes(2);
		});
		expect(preview.mock.calls[1]![0].packages).toEqual(["numpy=2.1.0"]);
		await expect
			.element(screen.getByTestId("environments-conda-update-confirm-preview"))
			.toBeVisible();
	});

	it("changing a package's target version re-pins the spec sent to the solver", async () => {
		const preview = vi.fn(async (_input: CondaPackagesPreviewInput) => emptyPreview());
		const { baseElement } = renderDialog({ preview });
		const screen = page.elementLocator(baseElement);

		await vi.waitFor(() => {
			expect(preview).toHaveBeenCalledOnce();
		});
		await userEvent.click(screen.getByTestId("environments-conda-update-confirm-auto-check"));
		await userEvent.click(screen.getByRole("combobox", { name: "Version for numpy" }));
		await userEvent.click(screen.getByRole("option", { name: "2.0.1" }));
		await userEvent.click(screen.getByTestId("environments-conda-update-confirm-refresh-btn"));

		await vi.waitFor(() => {
			expect(preview).toHaveBeenCalledTimes(2);
		});
		expect(preview.mock.calls[1]![0].packages).toEqual(["numpy=2.0.1", "pandas=2.3.0"]);
	});

	it("shows a single-version badge instead of a picker when only one newer version exists", async () => {
		const { baseElement } = renderDialog({ preview: async () => emptyPreview() });
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByRole("combobox", { name: "Version for numpy" })).toBeVisible();
		expect(await screen.getByRole("combobox", { name: "Version for pandas" }).all()).toHaveLength(
			0,
		);
		await expect.element(screen.getByText("2.3.0", { exact: true })).toBeVisible();
	});

	it("the header checkbox unselects and reselects every updatable package", async () => {
		const { baseElement } = renderDialog({ preview: async () => emptyPreview() });
		const screen = page.elementLocator(baseElement);
		const selectAll = screen.getByTestId("environments-conda-update-confirm-select-all");

		await expect.element(selectAll).toBeChecked();
		await userEvent.click(selectAll);

		await expect
			.element(screen.getByTestId("environments-conda-update-confirm-nothing-selected"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("environments-conda-update-confirm-btn"))
			.toBeDisabled();
		await expect
			.element(screen.getByRole("checkbox", { name: "Include numpy in update" }))
			.not.toBeChecked();

		await userEvent.click(selectAll);
		await expect
			.element(screen.getByRole("checkbox", { name: "Include numpy in update" }))
			.toBeChecked();
		await expect
			.element(screen.getByRole("checkbox", { name: "Include pandas in update" }))
			.toBeChecked();
	});

	it("filters the package list by name without changing what is selected", async () => {
		const preview = vi.fn(async (_input: CondaPackagesPreviewInput) => emptyPreview());
		const { baseElement } = renderDialog({ preview });
		const screen = page.elementLocator(baseElement);

		await userEvent.fill(screen.getByPlaceholder("Search packages…"), "pan");
		await expect.element(screen.getByText("pandas", { exact: true })).toBeVisible();
		expect(await screen.getByText("numpy", { exact: true }).all()).toHaveLength(0);
		expect(await screen.getByText(/Update 2 Packages in/).element().textContent).toContain(
			"Update 2 Packages",
		);
	});

	it("filters the dependency panel by category and by name", async () => {
		const { baseElement } = renderDialog({
			preview: async () =>
				previewWith({
					upgraded: [change("libblas", "3.9.0", "3.9.1")],
					added: [change("libgfortran", null, "5.0.0")],
				}),
		});
		const screen = page.elementLocator(baseElement);
		const panel = screen.getByTestId("environments-conda-update-confirm-preview");
		await expect.element(panel).toBeVisible();

		await userEvent.click(screen.getByTestId("environments-conda-update-confirm-filter-added"));
		let text = (await panel.element().textContent) ?? "";
		expect(text).toContain("libgfortran");
		expect(text).not.toContain("libblas");

		await userEvent.click(screen.getByTestId("environments-conda-update-confirm-filter-all"));
		await userEvent.fill(screen.getByPlaceholder("Filter dependencies…"), "blas");
		text = (await panel.element().textContent) ?? "";
		expect(text).toContain("libblas");
		expect(text).not.toContain("libgfortran");
	});

	it("submits the pinned specs in the background, closes, and reports the in-flight count", async () => {
		let finish!: (value: CondaPackagesUpdateResult) => void;
		const update = vi.fn(
			(_input: CondaPackagesUpdateInput) =>
				new Promise<CondaPackagesUpdateResult>((resolve) => {
					finish = resolve;
				}),
		);
		const onClose = vi.fn();
		const onSuccess = vi.fn();
		const onUpdatingChange = vi.fn();
		const { baseElement } = renderDialog({
			preview: async () => emptyPreview(),
			update,
			onClose,
			onSuccess,
			onUpdatingChange,
		});
		const screen = page.elementLocator(baseElement);

		const submit = screen.getByTestId("environments-conda-update-confirm-btn");
		await expect.element(submit).toBeEnabled();
		await userEvent.click(submit);

		expect(onClose).toHaveBeenCalledOnce();
		expect(onSuccess).toHaveBeenCalledOnce();
		expect(onUpdatingChange).toHaveBeenCalledWith(2);
		await vi.waitFor(() => {
			expect(update).toHaveBeenCalledOnce();
		});
		expect(update.mock.calls[0]![0]).toEqual({
			name: "dev",
			prefix: "/opt/anaconda3/envs/dev",
			packages: ["numpy=2.1.0", "pandas=2.3.0"],
		});

		finish(updateResult());
		await vi.waitFor(() => {
			expect(onUpdatingChange).toHaveBeenCalledWith(-2);
		});
	});

	it("resets the in-flight count when the background update fails", async () => {
		const onUpdatingChange = vi.fn();
		const { baseElement } = renderDialog({
			preview: async () => emptyPreview(),
			update: async () => {
				throw new Error("[BUSINESS] SOLVE_FAILED: boom");
			},
			onUpdatingChange,
		});
		const screen = page.elementLocator(baseElement);

		const submit = screen.getByTestId("environments-conda-update-confirm-btn");
		await expect.element(submit).toBeEnabled();
		await userEvent.click(submit);

		await vi.waitFor(() => {
			expect(onUpdatingChange).toHaveBeenCalledWith(-2);
		});
	});

	it("clones the environment before updating when backup is enabled", async () => {
		const order: string[] = [];
		const clone = vi.fn(async (input: CondaEnvsCloneInput) => {
			order.push("clone");
			return {
				jobId: "job-c",
				environment: { name: input.name, prefix: `/opt/anaconda3/envs/${input.name}` },
			};
		});
		const update = vi.fn(async (_input: CondaPackagesUpdateInput) => {
			order.push("update");
			return updateResult();
		});
		const { baseElement } = renderDialog({ preview: async () => emptyPreview(), clone, update });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-conda-update-confirm-backup-check"));
		await expect
			.element(screen.getByTestId("environments-conda-update-confirm-backup-name"))
			.toHaveValue("dev-backup");

		const submit = screen.getByTestId("environments-conda-update-confirm-btn");
		expect(await submit.element().textContent).toContain("Back up & Update 2 Packages");
		await userEvent.click(submit);

		await vi.waitFor(() => {
			expect(update).toHaveBeenCalledOnce();
		});
		expect(clone.mock.calls[0]![0]).toEqual({
			sourceName: "dev",
			sourcePrefix: "/opt/anaconda3/envs/dev",
			name: "dev-backup",
		});
		expect(order).toEqual(["clone", "update"]);
	});

	it("does not touch the environment when the backup clone fails", async () => {
		const update = vi.fn(async (_input: CondaPackagesUpdateInput) => updateResult());
		const onUpdatingChange = vi.fn();
		const { baseElement } = renderDialog({
			preview: async () => emptyPreview(),
			clone: async () => {
				throw new Error("[BUSINESS] ENV_EXISTS: already exists");
			},
			update,
			onUpdatingChange,
		});
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-conda-update-confirm-backup-check"));
		await userEvent.click(screen.getByTestId("environments-conda-update-confirm-btn"));

		await vi.waitFor(() => {
			expect(onUpdatingChange).toHaveBeenCalledWith(-2);
		});
		expect(update).not.toHaveBeenCalled();
	});

	it("rejects a backup name that collides with an existing environment or is malformed", async () => {
		const { baseElement } = renderDialog({
			preview: async () => emptyPreview(),
			existingEnvs: [ENV, { name: "dev-backup", prefix: "/opt/anaconda3/envs/dev-backup" }],
		});
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-conda-update-confirm-backup-check"));
		await expect
			.element(screen.getByText(/An environment named "dev-backup" already exists/))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("environments-conda-update-confirm-btn"))
			.toBeDisabled();

		const nameInput = screen.getByTestId("environments-conda-update-confirm-backup-name");
		await userEvent.fill(nameInput, "has space");
		await expect.element(screen.getByText(/Name must start with a letter or digit/)).toBeVisible();

		await userEvent.fill(nameInput, "dev-safe");
		await expect.element(screen.getByTestId("environments-conda-update-confirm-btn")).toBeEnabled();

		await userEvent.clear(nameInput);
		await expect
			.element(screen.getByTestId("environments-conda-update-confirm-btn"))
			.toBeDisabled();
	});

	it("Cancel closes without starting an update", async () => {
		const update = vi.fn(async (_input: CondaPackagesUpdateInput) => updateResult());
		const onClose = vi.fn();
		const { baseElement } = renderDialog({ preview: async () => emptyPreview(), update, onClose });
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onClose).toHaveBeenCalledOnce();
		expect(update).not.toHaveBeenCalled();
	});
});
