import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { KernelError } from "@kilo-desktop/kernel";

import type { TerminalProfile } from "../contracts";
import { renderTerminalSettings } from "../test/terminal-host";

const WAIT = { timeout: 5_000 };

const FISH: TerminalProfile = {
	id: "detected:fish",
	label: "fish",
	path: "/opt/homebrew/bin/fish",
	args: [],
	source: "detected",
	available: true,
};
const ZSH: TerminalProfile = { ...FISH, id: "detected:zsh", label: "zsh", path: "/bin/zsh" };
const MISSING_NU: TerminalProfile = {
	id: "nu",
	label: "Nushell",
	path: "/nowhere/nu",
	args: [],
	source: "custom",
	available: false,
};

const openDefaultSelect = () => page.getByTestId("terminal-default-profile").click();

describe("Terminal settings", () => {
	it("offers Automatic and the shells found, with missing ones disabled", async () => {
		await renderTerminalSettings({ profiles: [FISH, ZSH, MISSING_NU] });

		await expect.element(page.getByRole("heading", { name: "Terminal" })).toBeVisible();
		await expect
			.element(page.getByTestId("terminal-default-profile"))
			.toMatchTextContent(/Automatic/);
		await openDefaultSelect();
		await expect.element(page.getByTestId("terminal-profile-option-automatic")).toBeVisible();
		await expect
			.element(page.getByTestId("terminal-profile-option-detected:fish"))
			.toMatchTextContent(/fish/);
		await expect.element(page.getByTestId("terminal-profile-option-detected:zsh")).toBeVisible();
		const missing = page.getByTestId("terminal-profile-option-nu");
		await expect.element(missing).toMatchTextContent(/Not found/);
		await expect.element(missing).toHaveAttribute("data-disabled");
	});

	it("saves the chosen default straight away, and Automatic as none", async () => {
		const host = await renderTerminalSettings({ profiles: [FISH, ZSH] });

		await openDefaultSelect();
		await page.getByTestId("terminal-profile-option-detected:zsh").click();
		await vi.waitFor(
			() => expect(host.updateSettings).toHaveBeenCalledWith({ defaultProfileId: "detected:zsh" }),
			WAIT,
		);
		await expect.element(page.getByTestId("terminal-default-profile")).toMatchTextContent(/zsh/);

		await openDefaultSelect();
		await page.getByTestId("terminal-profile-option-automatic").click();
		await vi.waitFor(
			() => expect(host.updateSettings).toHaveBeenLastCalledWith({ defaultProfileId: null }),
			WAIT,
		);
	});

	it("says when the default shell can't be found and Automatic is used", async () => {
		await renderTerminalSettings({
			profiles: [FISH, MISSING_NU],
			settings: {
				defaultProfileId: "nu",
				customProfiles: [{ id: "nu", label: "Nushell", path: "/nowhere/nu" }],
			},
		});

		await expect
			.element(page.getByTestId("terminal-default-missing"))
			.toMatchTextContent(/Nushell wasn't found, so new terminals start a shell automatically./);
	});

	it("adds a custom profile with one save, after the draft is complete", async () => {
		const host = await renderTerminalSettings({ profiles: [FISH] });

		await expect.element(page.getByTestId("terminal-custom-profiles-empty")).toBeVisible();
		await page.getByTestId("terminal-add-profile").click();
		await expect.element(page.getByRole("heading", { name: "Add profile" })).toBeVisible();
		await expect.element(page.getByTestId("terminal-profile-save")).toBeDisabled();
		await userEvent.fill(page.getByTestId("terminal-profile-label").element(), "Login zsh");
		await userEvent.fill(page.getByTestId("terminal-profile-path").element(), "zsh");
		await userEvent.fill(page.getByTestId("terminal-profile-args").element(), "-l");
		expect(host.updateSettings).not.toHaveBeenCalled();

		await page.getByTestId("terminal-profile-save").click();
		await vi.waitFor(() => expect(host.updateSettings).toHaveBeenCalledOnce(), WAIT);
		expect(host.updateSettings).toHaveBeenCalledWith({
			customProfiles: [{ id: expect.any(String), label: "Login zsh", path: "zsh", args: ["-l"] }],
		});
		await expect
			.element(page.getByRole("heading", { name: "Add profile" }))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByTestId("terminal-custom-profile").first())
			.toMatchTextContent(/Login zsh/);
	});

	it("shows what's wrong with a draft and keeps Save disabled", async () => {
		const host = await renderTerminalSettings();

		await page.getByTestId("terminal-add-profile").click();
		await userEvent.fill(page.getByTestId("terminal-profile-label").element(), "Broken");
		await userEvent.fill(page.getByTestId("terminal-profile-path").element(), "bin/zsh");
		await expect
			.element(page.getByText("Use an absolute path or a bare name found on PATH."))
			.toBeVisible();
		await expect
			.element(page.getByTestId("terminal-profile-path"))
			.toHaveAttribute("aria-invalid", "true");
		await expect.element(page.getByTestId("terminal-profile-save")).toBeDisabled();
		expect(host.updateSettings).not.toHaveBeenCalled();
	});

	it("uses a detected shell's install for a profile", async () => {
		const host = await renderTerminalSettings();

		await page.getByTestId("terminal-add-profile").click();
		await userEvent.fill(page.getByTestId("terminal-profile-label").element(), "Bash, no login");
		await page.getByTestId("terminal-profile-kind-source").click();
		await page.getByTestId("terminal-profile-source").click();
		await page.getByTestId("terminal-profile-source-git-bash").click();
		await page.getByTestId("terminal-profile-save").click();
		await vi.waitFor(
			() =>
				expect(host.updateSettings).toHaveBeenCalledWith({
					customProfiles: [{ id: expect.any(String), label: "Bash, no login", source: "git-bash" }],
				}),
			WAIT,
		);
	});

	it("edits and removes custom profiles", async () => {
		const host = await renderTerminalSettings({
			profiles: [FISH, MISSING_NU],
			settings: {
				defaultProfileId: null,
				customProfiles: [{ id: "nu", label: "Nushell", path: "/nowhere/nu" }],
			},
		});
		const row = page.getByTestId("terminal-custom-profile");
		await expect.element(row).toMatchTextContent(/\/nowhere\/nu/);
		await expect.element(row).toMatchTextContent(/Not found/);

		await page.getByRole("button", { name: "Edit Nushell" }).click();
		await expect.element(page.getByTestId("terminal-profile-path")).toHaveValue("/nowhere/nu");
		await userEvent.fill(page.getByTestId("terminal-profile-path").element(), "nu");
		await page.getByTestId("terminal-profile-save").click();
		await vi.waitFor(
			() =>
				expect(host.updateSettings).toHaveBeenCalledWith({
					customProfiles: [{ id: "nu", label: "Nushell", path: "nu" }],
				}),
			WAIT,
		);

		await page.getByRole("button", { name: "Remove Nushell" }).click();
		await vi.waitFor(
			() => expect(host.updateSettings).toHaveBeenLastCalledWith({ customProfiles: [] }),
			WAIT,
		);
		await expect.element(page.getByTestId("terminal-custom-profiles-empty")).toBeVisible();
	});

	it("looks for shells again only when asked", async () => {
		const host = await renderTerminalSettings({ profiles: [FISH] });
		await expect.element(page.getByTestId("terminal-rescan")).toBeVisible();
		expect(host.refreshProfiles).not.toHaveBeenCalled();

		await page.getByTestId("terminal-rescan").click();
		await vi.waitFor(() => expect(host.refreshProfiles).toHaveBeenCalledOnce(), WAIT);
	});

	it("says why settings couldn't be saved", async () => {
		await renderTerminalSettings({
			profiles: [FISH],
			updateSettings: () => {
				throw new KernelError("BUSINESS", "Settings are read-only.");
			},
		});

		await openDefaultSelect();
		await page.getByTestId("terminal-profile-option-detected:fish").click();
		await expect.element(page.getByText("Settings are read-only.")).toBeVisible();
	});

	it("explains that shells run only in the desktop app", async () => {
		await renderTerminalSettings({ withoutMain: true });

		await expect.element(page.getByTestId("terminal-settings-unavailable")).toBeVisible();
		await expect.element(page.getByTestId("terminal-default-profile")).not.toBeInTheDocument();
	});
});
