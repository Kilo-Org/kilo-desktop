import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { Onboarding } from "@kilo-desktop/plugin-shell/contracts";

import { KILO_TERMS_VERSION, type IdentityState } from "../contracts";
import { renderApp, SIGNED_IN, SIGNED_OUT } from "../test/harness";

describe("welcome and terms", () => {
	it("needs the terms accepted before Get started, then records the acceptance", async () => {
		const { accept } = await renderApp({ termsAccepted: false, onboarding: true });

		await expect.element(page.getByTestId("onboarding-welcome")).toBeVisible();
		await expect.element(page.getByTestId("onboarding-get-started")).toBeDisabled();
		await page.getByTestId("onboarding-accept-terms").click();
		await page.getByTestId("onboarding-get-started").click();

		await vi.waitFor(() => expect(accept).toHaveBeenCalledWith(KILO_TERMS_VERSION));
		await expect.element(page.getByRole("heading", { name: "Sign in to Kilo" })).toBeVisible();
	});
});

describe("onboarding sign-in", () => {
	it("shows the device code while the person approves in the browser", async () => {
		const { setIdentity, methods } = await renderApp({ onboarding: true });
		await page.getByTestId("onboarding-accept-terms").click();
		await page.getByTestId("onboarding-get-started").click();

		await expect.element(page.getByRole("heading", { name: "Sign in to Kilo" })).toBeVisible();
		setIdentity({
			...SIGNED_OUT,
			deviceAuth: {
				status: "waiting",
				code: "ABCD-1234",
				verificationUrl: "https://app.kilo.ai/device",
				expiresIn: 900,
			},
		});

		await expect.element(page.getByText("ABCD-1234")).toBeVisible();
		await page.getByRole("button", { name: /cancel/i }).click();
		await vi.waitFor(() => expect(methods.cancelSignIn).toHaveBeenCalled());
	});
});

describe("onboarding sign-in states", () => {
	async function openSignInStep(identity: IdentityState) {
		const app = await renderApp({ onboarding: true, identity });
		await page.getByTestId("onboarding-accept-terms").click();
		await page.getByTestId("onboarding-get-started").click();
		return app;
	}

	it("starts sign-in from the step", async () => {
		const { methods } = await openSignInStep(SIGNED_OUT);

		await page.getByTestId("kilo-account-login").click();

		await vi.waitFor(() => expect(methods.signIn).toHaveBeenCalled());
	});

	it("continues once signed in, finishing onboarding", async () => {
		const { host } = await openSignInStep(SIGNED_IN);

		await expect.element(page.getByRole("heading", { name: "Signed in to Kilo" })).toBeVisible();
		await expect.element(page.getByTestId("onboarding-signed-in")).toBeVisible();
		await page.getByTestId("onboarding-continue").click();
		// The shell's closing step follows.
		await expect.element(page.getByRole("heading", { name: "You're all set" })).toBeVisible();
		await page.getByTestId("onboarding-continue").click();

		await expect.element(page.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
		expect(host.main.kernelSdk.domains.get(Onboarding)!.getState().outcome).toBe("completed");
	});

	it("says it is connecting while the account is unknown", async () => {
		await openSignInStep({ ...SIGNED_OUT, connection: "pending", authenticated: null });

		await expect.element(page.getByTestId("onboarding-connecting")).toBeVisible();
	});

	it("offers to try again after a failed sign-in", async () => {
		const { methods } = await openSignInStep({
			...SIGNED_OUT,
			deviceAuth: { status: "error", error: "Denied." },
		});

		await expect.element(page.getByText("Denied.")).toBeVisible();
		await page.getByTestId("kilo-account-retry").click();
		await vi.waitFor(() => expect(methods.signIn).toHaveBeenCalled());
	});

	it("opens the approval page and copies its link while waiting", async () => {
		const { openExternal, writeText } = await openSignInStep({
			...SIGNED_OUT,
			deviceAuth: {
				status: "waiting",
				code: "ABCD-1234",
				verificationUrl: "https://app.kilo.ai/device",
				expiresIn: 900,
			},
		});

		await page.getByTestId("kilo-account-copy-url").click();
		await vi.waitFor(() =>
			expect(writeText).toHaveBeenCalledWith(
				{ text: "https://app.kilo.ai/device" },
				expect.anything(),
			),
		);
		await page.getByTestId("kilo-account-open-browser").click();
		await vi.waitFor(() =>
			expect(openExternal).toHaveBeenCalledWith(
				{ url: "https://app.kilo.ai/device" },
				expect.anything(),
			),
		);
	});
});

describe("sidebar account", () => {
	it("offers sign-in and opens Account settings to finish it", async () => {
		const { methods } = await renderApp();

		await page.getByTestId("sidebar-kilo-login").click();

		await vi.waitFor(() => expect(methods.signIn).toHaveBeenCalled());
		await expect.element(page.getByTestId("account-page")).toBeVisible();
	});

	it("shows the signed-in account with Settings and Sign out", async () => {
		const { methods } = await renderApp({ identity: SIGNED_IN });

		await page.getByTestId("sidebar-kilo-account").click();
		await page.getByTestId("sidebar-kilo-logout").click();
		await vi.waitFor(() => expect(methods.signOut).toHaveBeenCalled());

		await page.getByTestId("sidebar-kilo-account").click();
		await page.getByTestId("sidebar-kilo-settings").click();
		await expect.element(page.getByTestId("settings-section-account")).toBeVisible();
	});

	it("says signing in is under way, and when the account can't be loaded", async () => {
		const { setIdentity } = await renderApp({
			identity: { ...SIGNED_OUT, deviceAuth: { status: "waiting", code: "X" } },
		});
		await expect.element(page.getByTestId("sidebar-kilo-signing-in")).toBeVisible();

		setIdentity({ ...SIGNED_OUT, authenticated: true, profileError: "Kilo API unavailable" });
		await expect.element(page.getByTestId("sidebar-kilo-profile-error")).toBeVisible();

		setIdentity({ ...SIGNED_OUT, connection: "pending", authenticated: null });
		await expect.element(page.getByTestId("sidebar-kilo-account-loading")).toBeVisible();
	});
});

describe("Account settings", () => {
	it("is the Kilo panel on kilo.shell's Account page, under General", async () => {
		await renderApp({ path: "/settings/account" });

		await expect
			.element(page.getByTestId("account-panel-kilo.account/kilo").getByTestId("account-kilo-row"))
			.toBeInTheDocument();
		const general = page.getByTestId("settings-group-general").element().parentElement!;
		expect(general.contains(page.getByTestId("settings-section-account").element())).toBe(true);
	});

	it("shows a signed-out Kilo row with Sign in", async () => {
		const { methods } = await renderApp({ path: "/settings/account" });

		const row = page.getByTestId("account-kilo-row");
		await expect.element(row.getByText("Not signed in.")).toBeInTheDocument();
		await page.getByTestId("account-kilo-sign-in").click();

		await vi.waitFor(() => expect(methods.signIn).toHaveBeenCalled());
	});

	it("shows the signed-in account's balance, organization and Kilo Pass", async () => {
		const { methods, openExternal } = await renderApp({
			identity: SIGNED_IN,
			path: "/settings/account",
		});

		await expect.element(page.getByTestId("account-kilo-email")).toBeInTheDocument();
		expect(page.getByTestId("account-kilo-email").element().textContent).toBe(
			"Signed in as ada@example.com",
		);
		await expect.element(page.getByTestId("kilo-account-balance-value")).toBeInTheDocument();
		expect(page.getByTestId("kilo-account-balance-value").element().textContent).toBe("$12.50");
		await expect.element(page.getByTestId("kilo-account-pass-bar")).toBeInTheDocument();
		await page.getByTestId("kilo-account-top-up").click();
		await vi.waitFor(() =>
			expect(openExternal).toHaveBeenCalledWith(
				{ url: "https://app.kilo.ai/credits" },
				expect.anything(),
			),
		);

		await page.getByTestId("kilo-account-org").click();
		await page.getByRole("option", { name: /Analytical Engines/ }).click();
		await vi.waitFor(() =>
			expect(methods.setOrganization).toHaveBeenCalledWith(
				{ organizationId: "org-1" },
				expect.anything(),
			),
		);
	});
});
