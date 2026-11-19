import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { KILO_TERMS_VERSION, type AccountState } from "@kilo-desktop/plugin-core/contracts";

import { SidebarNotice } from "../../contracts";
import {
	bootAccount,
	disposeHosts,
	renderOnboardingStep,
	SIGNED_IN,
	SIGNED_OUT,
} from "./test-harness";

afterEach(disposeHosts);

describe("welcome and terms", () => {
	it("needs the terms accepted before Get started, then records the acceptance", async () => {
		const { host, accept } = await bootAccount({ termsAccepted: false });
		const next = vi.fn();
		renderOnboardingStep(host, "welcome", next);

		await expect.element(page.getByTestId("onboarding-welcome")).toBeVisible();
		await expect.element(page.getByTestId("onboarding-get-started")).toBeDisabled();
		await page.getByTestId("onboarding-accept-terms").click();
		await page.getByTestId("onboarding-get-started").click();

		await vi.waitFor(() => expect(accept).toHaveBeenCalledWith(KILO_TERMS_VERSION));
		await vi.waitFor(() => expect(next).toHaveBeenCalled());
		expect(host.renderer.contextKeys.get("kilo.core/termsAccepted")).toBe(true);
	});

	it("stays on the step and says so when the acceptance can't be saved", async () => {
		const { host } = await bootAccount({ termsAccepted: false, acceptFails: true });
		const next = vi.fn();
		renderOnboardingStep(host, "welcome", next);

		await page.getByTestId("onboarding-accept-terms").click();
		await page.getByTestId("onboarding-get-started").click();

		await expect
			.element(page.getByTestId("onboarding-terms-error"))
			.toHaveTextContent("Could not save your acceptance. Try again.");
		expect(next).not.toHaveBeenCalled();
		await expect.element(page.getByTestId("onboarding-get-started")).toBeEnabled();
	});
});

describe("onboarding sign-in", () => {
	async function openSignInStep(account: AccountState) {
		const app = await bootAccount({ account });
		const next = vi.fn();
		renderOnboardingStep(app.host, "sign-in", next);
		return { ...app, next };
	}

	it("shows the device code while the person approves in the browser", async () => {
		const { setAccount, methods } = await openSignInStep(SIGNED_OUT);

		await expect.element(page.getByRole("heading", { name: "Sign in to Kilo" })).toBeVisible();
		setAccount({
			...SIGNED_OUT,
			deviceSignIn: {
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

	it("starts sign-in from the step, which can be skipped meanwhile", async () => {
		const { methods } = await openSignInStep(SIGNED_OUT);

		await expect.element(page.getByTestId("onboarding-skip")).toBeVisible();
		await expect.element(page.getByTestId("onboarding-continue")).not.toBeInTheDocument();
		await page.getByTestId("kilo-account-login").click();

		await vi.waitFor(() => expect(methods.signIn).toHaveBeenCalled());
	});

	it("continues once signed in", async () => {
		const { next } = await openSignInStep(SIGNED_IN);

		await expect.element(page.getByRole("heading", { name: "Signed in to Kilo" })).toBeVisible();
		await expect
			.element(page.getByTestId("onboarding-signed-in").getByText("Signed in as Ada Lovelace"))
			.toBeVisible();
		await expect.element(page.getByTestId("onboarding-skip")).not.toBeInTheDocument();
		await page.getByTestId("onboarding-continue").click();

		expect(next).toHaveBeenCalled();
	});

	it("says it is connecting while the account is unknown", async () => {
		await openSignInStep({ ...SIGNED_OUT, connection: "pending", signedIn: null });

		await expect.element(page.getByTestId("onboarding-connecting")).toBeVisible();
	});

	it("offers to try again after a failed sign-in", async () => {
		const { methods } = await openSignInStep({
			...SIGNED_OUT,
			deviceSignIn: { status: "error", error: "Denied." },
		});

		await expect.element(page.getByText("Denied.")).toBeVisible();
		await page.getByTestId("kilo-account-retry").click();
		await vi.waitFor(() => expect(methods.signIn).toHaveBeenCalled());
	});

	it("opens the approval page and copies its code and link while waiting", async () => {
		const { openExternal, writeText } = await openSignInStep({
			...SIGNED_OUT,
			deviceSignIn: {
				status: "waiting",
				code: "ABCD-1234",
				verificationUrl: "https://app.kilo.ai/device",
				expiresIn: 900,
			},
		});

		await page.getByTestId("kilo-account-copy-code").click();
		await vi.waitFor(() =>
			expect(writeText).toHaveBeenCalledWith({ text: "ABCD-1234" }, expect.anything()),
		);
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
	async function renderSidebar(options: Parameters<typeof bootAccount>[0] = {}) {
		const app = await bootAccount(options);
		app.host.renderSlot(SidebarNotice);
		return app;
	}

	it("offers sign-in and opens Settings → Account to finish it", async () => {
		const { methods, openSettings } = await renderSidebar();

		await page.getByTestId("sidebar-kilo-login").click();

		await vi.waitFor(() => expect(methods.signIn).toHaveBeenCalled());
		await vi.waitFor(() =>
			expect(openSettings).toHaveBeenCalledWith({ section: "kilo.shell/account" }),
		);
	});

	it("shows the signed-in account with Settings and Sign out", async () => {
		const { methods, openSettings } = await renderSidebar({ account: SIGNED_IN });

		await page.getByTestId("sidebar-kilo-account").click();
		await page.getByTestId("sidebar-kilo-logout").click();
		await vi.waitFor(() => expect(methods.signOut).toHaveBeenCalled());

		await page.getByTestId("sidebar-kilo-account").click();
		await page.getByTestId("sidebar-kilo-settings").click();
		await vi.waitFor(() => expect(openSettings).toHaveBeenCalledWith({}));
	});

	it("says signing in is under way, and when the account can't be loaded", async () => {
		const { setAccount, openSettings } = await renderSidebar({
			account: { ...SIGNED_OUT, deviceSignIn: { status: "waiting", code: "X" } },
		});
		await expect.element(page.getByTestId("sidebar-kilo-signing-in")).toBeVisible();

		setAccount({ ...SIGNED_OUT, signedIn: true, profileError: "Kilo API unavailable" });
		await page.getByTestId("sidebar-kilo-profile-error").click();
		await vi.waitFor(() =>
			expect(openSettings).toHaveBeenCalledWith({ section: "kilo.shell/account" }),
		);

		setAccount({ ...SIGNED_OUT, connection: "pending", signedIn: null });
		await expect.element(page.getByTestId("sidebar-kilo-account-loading")).toBeVisible();
	});

	it("hides when the Kilo server can't be reached", async () => {
		await renderSidebar({ account: { ...SIGNED_OUT, connection: "unavailable" } });

		await expect.element(page.getByTestId("test-sidebar")).toBeInTheDocument();
		await expect.element(page.getByTestId("sidebar-kilo-login")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("sidebar-kilo-account")).not.toBeInTheDocument();
	});

	it("falls back to Sign in after a failed sign-in", async () => {
		await renderSidebar({
			account: { ...SIGNED_OUT, deviceSignIn: { status: "error", error: "Denied." } },
		});

		await expect.element(page.getByTestId("sidebar-kilo-login")).toBeVisible();
	});
});
