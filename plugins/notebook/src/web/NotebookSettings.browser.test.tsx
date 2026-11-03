import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KernelError } from "@kilo-desktop/kernel";

import { bootNotebookHost, SIGNED_OUT } from "../test/notebook-host.js";

const WAIT = { timeout: 5_000 };

describe("Notebooks settings", () => {
	it("shows both settings with their values", async () => {
		const host = await bootNotebookHost({
			settings: { autoCreateEnvironmentFile: true, trustNewNotebooks: false },
		});
		host.renderSettings();

		await expect.element(page.getByRole("heading", { name: "Notebooks" })).toBeVisible();
		await expect
			.element(page.getByRole("switch", { name: "Automatically create environment.yml" }))
			.toBeChecked();
		await expect
			.element(page.getByRole("switch", { name: "Trust new notebooks" }))
			.not.toBeChecked();
	});

	it("asks a signed-out person to sign in instead of showing the settings", async () => {
		const host = await bootNotebookHost({ identity: SIGNED_OUT });
		host.renderSettings();

		await expect.element(page.getByTestId("kilo-auth-gate-signin")).toBeVisible();
		await expect
			.element(page.getByText("Notebooks requires a Kilo account. Sign in to continue."))
			.toBeVisible();
		await expect
			.element(page.getByRole("switch", { name: "Trust new notebooks" }))
			.not.toBeInTheDocument();
	});

	it("saves each toggle as its own setting", async () => {
		const updates: unknown[] = [];
		const host = await bootNotebookHost({
			notebooks: {
				updateSettings: (patch) => {
					updates.push(patch);
					return {
						autoCreateEnvironmentFile: patch.autoCreateEnvironmentFile ?? true,
						trustNewNotebooks: patch.trustNewNotebooks ?? true,
					};
				},
			},
		});
		host.renderSettings();

		await page.getByRole("switch", { name: "Trust new notebooks" }).click();
		await vi.waitFor(() => expect(updates[0]).toEqual({ trustNewNotebooks: true }), WAIT);
		await expect.element(page.getByRole("switch", { name: "Trust new notebooks" })).toBeChecked();

		await page.getByRole("switch", { name: "Automatically create environment.yml" }).click();
		await vi.waitFor(() => expect(updates[1]).toEqual({ autoCreateEnvironmentFile: false }), WAIT);
	});

	it("says why a setting could not be saved", async () => {
		const host = await bootNotebookHost({
			notebooks: {
				updateSettings: () => {
					throw new KernelError("BUSINESS", "Settings are read-only.");
				},
			},
		});
		host.renderSettings();

		await page.getByRole("switch", { name: "Trust new notebooks" }).click();
		await expect.element(page.getByText("Settings are read-only.")).toBeVisible();
	});
});
