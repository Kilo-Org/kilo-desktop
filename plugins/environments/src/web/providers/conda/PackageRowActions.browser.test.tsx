import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
	type CondaEnv,
	type CondaPackage,
	type CondaPackagesRemoveInput,
	type CondaPackagesRemoveResult,
} from "../../../contracts/providers/conda.js";
import { renderWithConda, type EnvironmentsHostOptions } from "../../../test/environments-host.js";
import { BulkRemoveConfirmation } from "./BulkRemoveConfirmation.js";
import { PackageRowActions } from "./PackageRowActions.js";
import { RemovePackageConfirmation } from "./RemovePackageConfirmation.js";

const ENV: CondaEnv = { name: "dev", prefix: "/opt/anaconda3/envs/dev" };
const NUMPY: CondaPackage = {
	name: "numpy",
	version: "2.0.0",
	build: "py_0",
	channel: "conda-forge",
};
const PANDAS: CondaPackage = {
	name: "pandas",
	version: "2.2.0",
	build: "py_0",
	channel: "conda-forge",
};

type RemoveHandler = (input: CondaPackagesRemoveInput) => Promise<CondaPackagesRemoveResult>;

async function renderWithSdk(ui: React.ReactElement, remove?: RemoveHandler) {
	const hostOptions: EnvironmentsHostOptions = {
		handlers: {
			"conda.packages.remove":
				remove ??
				(async (input: CondaPackagesRemoveInput) => ({
					jobId: "job-1",
					envName: "dev",
					removed: input.packages,
				})),
		},
	};
	return renderWithConda(<>{ui}</>, hostOptions);
}

afterEach(cleanup);

describe("PackageRowActions", () => {
	it("delegates Update… to the parent when an update is available", async () => {
		const onUpdate = vi.fn();
		const { baseElement } = await renderWithSdk(
			<PackageRowActions env={ENV} pkg={NUMPY} hasUpdate onUpdate={onUpdate} />,
		);
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-conda-detail-row-actions"));
		await userEvent.click(screen.getByRole("menuitem", { name: /Update…/ }));

		expect(onUpdate).toHaveBeenCalledWith(NUMPY);
	});

	it("disables Update… when the package is already at the latest version", async () => {
		const onUpdate = vi.fn();
		const { baseElement } = await renderWithSdk(
			<PackageRowActions env={ENV} pkg={NUMPY} hasUpdate={false} onUpdate={onUpdate} />,
		);
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-conda-detail-row-actions"));
		const item = screen.getByRole("menuitem", { name: /Update…/ });
		await expect.element(item).toHaveAttribute("aria-disabled", "true");
		expect(onUpdate).not.toHaveBeenCalled();
	});

	it("opens the remove confirmation from the Remove action", async () => {
		const { baseElement } = await renderWithSdk(
			<PackageRowActions env={ENV} pkg={NUMPY} hasUpdate onUpdate={() => {}} />,
		);
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-conda-detail-row-actions"));
		await userEvent.click(screen.getByRole("menuitem", { name: /Remove/ }));

		await expect.element(screen.getByTestId("environments-conda-remove-pkg-dialog")).toBeVisible();
	});
});

describe("RemovePackageConfirmation", () => {
	it("removes the package from the env and closes on success", async () => {
		const remove = vi.fn(async (input: CondaPackagesRemoveInput) => ({
			jobId: "job-1",
			envName: "dev",
			removed: input.packages,
		}));
		const onOpenChange = vi.fn();
		const { baseElement } = await renderWithSdk(
			<RemovePackageConfirmation env={ENV} pkg={NUMPY} open onOpenChange={onOpenChange} />,
			remove,
		);
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-conda-remove-pkg-confirm-btn"));

		await vi.waitFor(() => {
			expect(remove).toHaveBeenCalledOnce();
		});
		expect(remove.mock.calls[0]![0]).toEqual({
			name: "dev",
			prefix: "/opt/anaconda3/envs/dev",
			packages: ["numpy"],
		});
		await vi.waitFor(() => {
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});
	});

	it("shows the friendly error and stays open when removal fails", async () => {
		const onOpenChange = vi.fn();
		const { baseElement } = await renderWithSdk(
			<RemovePackageConfirmation env={ENV} pkg={NUMPY} open onOpenChange={onOpenChange} />,
			async () => {
				throw new Error("SOLVE_FAILED: conflict");
			},
		);
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-conda-remove-pkg-confirm-btn"));

		await expect.element(screen.getByTestId("environments-conda-remove-pkg-error")).toBeVisible();
		expect(onOpenChange).not.toHaveBeenCalled();
	});

	it("does not close while the removal is in flight", async () => {
		let finish!: (value: CondaPackagesRemoveResult) => void;
		const onOpenChange = vi.fn();
		const { baseElement } = await renderWithSdk(
			<RemovePackageConfirmation env={ENV} pkg={NUMPY} open onOpenChange={onOpenChange} />,
			() =>
				new Promise<CondaPackagesRemoveResult>((resolve) => {
					finish = resolve;
				}),
		);
		const screen = page.elementLocator(baseElement);

		await userEvent.click(screen.getByTestId("environments-conda-remove-pkg-confirm-btn"));
		await expect.element(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
		await userEvent.keyboard("{Escape}");
		expect(onOpenChange).not.toHaveBeenCalled();

		finish({ jobId: "job-1", envName: "dev", removed: ["numpy"] });
		await vi.waitFor(() => {
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});
	});
});

describe("BulkRemoveConfirmation", () => {
	it("lists every package and removes them all in one request", async () => {
		const remove = vi.fn(async (input: CondaPackagesRemoveInput) => ({
			jobId: "job-1",
			envName: "dev",
			removed: input.packages,
		}));
		const onOpenChange = vi.fn();
		const onSuccess = vi.fn();
		const { baseElement } = await renderWithSdk(
			<BulkRemoveConfirmation
				env={ENV}
				packages={[NUMPY, PANDAS]}
				open
				onOpenChange={onOpenChange}
				onSuccess={onSuccess}
			/>,
			remove,
		);
		const screen = page.elementLocator(baseElement);

		const dialog = screen.getByTestId("environments-conda-bulk-remove-dialog");
		await expect.element(dialog).toBeVisible();
		const text = (await dialog.element().textContent) ?? "";
		expect(text).toContain("Remove 2 packages?");
		expect(text).toContain("numpy");
		expect(text).toContain("pandas");

		await userEvent.click(screen.getByTestId("environments-conda-bulk-remove-confirm-btn"));

		await vi.waitFor(() => {
			expect(remove).toHaveBeenCalledOnce();
		});
		expect(remove.mock.calls[0]![0].packages).toEqual(["numpy", "pandas"]);
		await vi.waitFor(() => {
			expect(onOpenChange).toHaveBeenCalledWith(false);
			expect(onSuccess).toHaveBeenCalledOnce();
		});
	});

	it("shows the friendly error and keeps the selection when removal fails", async () => {
		const onSuccess = vi.fn();
		const { baseElement } = await renderWithSdk(
			<BulkRemoveConfirmation
				env={ENV}
				packages={[NUMPY]}
				open
				onOpenChange={() => {}}
				onSuccess={onSuccess}
			/>,
			async () => {
				throw new Error("SOLVE_FAILED: conflict");
			},
		);
		const screen = page.elementLocator(baseElement);

		expect(
			await screen.getByTestId("environments-conda-bulk-remove-dialog").element().textContent,
		).toContain("Remove 1 package?");
		await userEvent.click(screen.getByTestId("environments-conda-bulk-remove-confirm-btn"));

		await expect.element(screen.getByTestId("environments-conda-bulk-remove-error")).toBeVisible();
		expect(onSuccess).not.toHaveBeenCalled();
	});
});
