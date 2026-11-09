import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { testManifest } from "@kilo-desktop/kernel/testing";
import type { GuestPlugin } from "@kilo-desktop/plugin-shell/testing";

import { AccountPanel } from "../../contracts";
import { PROFILE, renderApp, SIGNED_IN, SIGNED_OUT } from "../../test/harness";
import { KiloGatewayAccountPanel } from "./KiloGatewayAccountPanel";
import { KiloGatewayProviderDisclosure } from "./KiloGatewayProviderCard";

/** Hosts the Gateway provider row the way AI Providers does. */
const providerRowHost: GuestPlugin = {
	manifest: testManifest("acme.ai-providers", {
		contributes: { extensions: { "kilo.account/account-panel": [{ id: "row" }] } },
	}),
	web: {
		activate: (sdk) => {
			sdk.extensions.implement(AccountPanel, "row", KiloGatewayProviderDisclosure);
		},
	},
};

/** Hosts the Gateway panel the way AI Providers will (step 4b), with its own sign-out. */
const providersHost: GuestPlugin = {
	manifest: testManifest("acme.providers", {
		contributes: { extensions: { "kilo.account/account-panel": [{ id: "gateway" }] } },
	}),
	web: {
		activate: (sdk) => {
			sdk.extensions.implement(AccountPanel, "gateway", () => <KiloGatewayAccountPanel />);
		},
	},
};

const WAITING = {
	...SIGNED_OUT,
	deviceAuth: {
		status: "waiting" as const,
		code: "ABCD-1234",
		verificationUrl: "https://app.kilo.ai/device",
		expiresIn: 900,
	},
};

const openAccount = (options: Parameters<typeof renderApp>[0] = {}) =>
	renderApp({ ...options, path: "/settings/account" });

describe("Kilo account on the Account page", () => {
	it("says the account needs the Kilo agent when the desktop app can't reach it", async () => {
		await openAccount({ identity: { ...SIGNED_OUT, connection: "unavailable" } });

		await expect
			.element(page.getByTestId("account-kilo-status"))
			.toHaveTextContent("Unavailable while the Kilo agent isn't running.");
		await expect.element(page.getByTestId("account-kilo-sign-in")).toBeDisabled();
	});

	it("says the account is only available in the desktop app in a browser", async () => {
		await openAccount({ desktop: false, identity: { ...SIGNED_OUT, connection: "unavailable" } });

		await expect.element(page.getByTestId("account-kilo-row")).toBeInTheDocument();
		expect(page.getByTestId("account-kilo-status").element().textContent).toBe(
			"Available in the desktop app.",
		);
		await expect.element(page.getByTestId("account-kilo-sign-in")).toBeDisabled();
	});

	it("shows the device code to enter in the browser, with copy and cancel", async () => {
		const { methods, writeText } = await openAccount({ identity: WAITING });

		await expect.element(page.getByTestId("kilo-account-device-code")).toBeInTheDocument();
		expect(page.getByTestId("kilo-account-device-code").element().textContent).toContain(
			"ABCD-1234",
		);
		await page.getByTestId("kilo-account-copy-code").click();
		await vi.waitFor(() =>
			expect(writeText).toHaveBeenCalledWith({ text: "ABCD-1234" }, expect.anything()),
		);
		await page.getByTestId("kilo-account-cancel").click();
		await vi.waitFor(() => expect(methods.cancelSignIn).toHaveBeenCalled());
	});

	it("shows sign-in starting and finishing", async () => {
		const { setIdentity } = await openAccount({
			identity: { ...SIGNED_OUT, deviceAuth: { status: "initiating" } },
		});
		await expect.element(page.getByTestId("kilo-account-device-auth")).toBeInTheDocument();
		await expect.element(page.getByTestId("kilo-account-cancel")).toBeVisible();

		setIdentity({ ...SIGNED_OUT, deviceAuth: { status: "finishing" } });
		await expect.element(page.getByTestId("kilo-account-device-auth")).toBeInTheDocument();
		await expect.element(page.getByTestId("kilo-account-device-code")).not.toBeInTheDocument();
	});

	it("explains a failed sign-in and offers to try again", async () => {
		const { methods } = await openAccount({
			identity: { ...SIGNED_OUT, deviceAuth: { status: "error", error: "The code expired." } },
		});

		await expect.element(page.getByText("The code expired.")).toBeVisible();
		await page.getByTestId("kilo-account-retry").click();
		await vi.waitFor(() => expect(methods.signIn).toHaveBeenCalled());
	});

	it("offers retry and sign-out when the profile can't be loaded", async () => {
		const { methods } = await openAccount({
			identity: { ...SIGNED_OUT, authenticated: true, profileError: "Kilo API unavailable" },
		});

		await expect.element(page.getByText("Kilo API unavailable")).toBeVisible();
		await page.getByTestId("kilo-account-profile-retry").click();
		await vi.waitFor(() => expect(methods.refresh).toHaveBeenCalled());
		await page.getByTestId("account-kilo-sign-out").click();
		await vi.waitFor(() => expect(methods.signOut).toHaveBeenCalled());
	});

	it("keeps the signed-in view when an organization switch fails", async () => {
		const { methods } = await openAccount({
			identity: {
				...SIGNED_IN,
				orgError: { message: "Not a member.", organizationId: "org-1" },
			},
		});

		await expect.element(page.getByText("Not a member.")).toBeVisible();
		await expect.element(page.getByTestId("kilo-account-balance")).toBeInTheDocument();
		await page.getByTestId("kilo-account-org-retry").click();
		await vi.waitFor(() =>
			expect(methods.setOrganization).toHaveBeenCalledWith(
				{ organizationId: "org-1" },
				expect.anything(),
			),
		);
		await page.getByTestId("kilo-account-org-dismiss").click();
		await vi.waitFor(() => expect(methods.dismissOrgError).toHaveBeenCalled());
	});

	it("offers Kilo Pass to a personal account without one", async () => {
		const { openExternal } = await openAccount({
			identity: { ...SIGNED_IN, profile: { ...PROFILE, kiloPass: null } },
		});

		await page.getByTestId("kilo-account-get-pass").click();
		await vi.waitFor(() =>
			expect(openExternal).toHaveBeenCalledWith(
				{ url: "https://kilo.ai/pricing/kilo-pass" },
				expect.anything(),
			),
		);
	});

	it("refreshes the balance on request", async () => {
		const { methods } = await openAccount({ identity: SIGNED_IN });

		await page.getByTestId("kilo-account-refresh").click();

		await vi.waitFor(() => expect(methods.refresh).toHaveBeenCalled());
	});

	it("holds the page in a loading state until the account is known", async () => {
		await openAccount({ identity: { ...SIGNED_OUT, connection: "pending", authenticated: null } });

		await expect.element(page.getByTestId("account-page")).toHaveAttribute("data-state", "loading");
	});

	it("draws no frame for a contributed panel that renders nothing", async () => {
		const empty: GuestPlugin = {
			manifest: testManifest("acme.empty", {
				contributes: { extensions: { "kilo.account/account-panel": [{ id: "nothing" }] } },
			}),
			web: {
				activate: (sdk) => {
					sdk.extensions.implement(AccountPanel, "nothing", () => null);
				},
			},
		};
		await openAccount({ guests: [empty] });

		const frame = page.getByTestId("account-panel-acme.empty/nothing");
		await expect.element(frame).toBeInTheDocument();
		await expect.element(frame).not.toBeVisible();
	});
});

describe("Kilo Gateway panel hosted elsewhere", () => {
	const gateway = () => page.getByTestId("account-panel-acme.providers/gateway");

	it("invites signing in when signed out", async () => {
		const { methods } = await openAccount({ guests: [providersHost] });

		await gateway().getByTestId("kilo-account-login").click();

		await vi.waitFor(() => expect(methods.signIn).toHaveBeenCalled());
	});

	it("says Kilo needs the desktop app when the server can't be reached", async () => {
		await openAccount({
			guests: [providersHost],
			identity: { ...SIGNED_OUT, connection: "unavailable" },
		});

		await expect.element(gateway().getByTestId("kilo-account-unavailable")).toBeInTheDocument();
	});

	it("holds its place while the account loads", async () => {
		await openAccount({
			guests: [providersHost],
			identity: { ...SIGNED_OUT, connection: "pending", authenticated: null },
		});

		await expect
			.element(gateway().getByTestId("kilo-account-settings"))
			.toHaveAttribute("data-state", "loading");
	});

	it("signs out from the panel", async () => {
		const { methods } = await openAccount({ guests: [providersHost], identity: SIGNED_IN });

		await gateway().getByTestId("kilo-account-logout").click();

		await vi.waitFor(() => expect(methods.signOut).toHaveBeenCalled());
	});
});

describe("Kilo Gateway provider row", () => {
	const row = () => page.getByTestId("kilo-providers-row-kilo");

	it("summarises the gateway with Sign in when signed out", async () => {
		const { methods } = await openAccount({ guests: [providerRowHost] });

		await expect.element(row()).toHaveAttribute("data-state", "summary");
		await row().getByTestId("kilo-account-login").click();
		await vi.waitFor(() => expect(methods.signIn).toHaveBeenCalled());
	});

	it("opens the account details with Sign out in the row header when signed in", async () => {
		await openAccount({ guests: [providerRowHost], identity: SIGNED_IN });

		await expect.element(row()).toHaveAttribute("data-state", "expanded");
		await expect.element(row().getByTestId("kilo-account-balance-value")).toBeInTheDocument();
		const header = row().getByTestId("kilo-provider-header-actions");
		await expect.element(header.getByTestId("kilo-account-logout")).toBeVisible();
		await expect.element(row().getByTestId("kilo-account-login")).not.toBeInTheDocument();
	});

	it("describes where sign-in stands", async () => {
		const { setIdentity } = await openAccount({
			guests: [providerRowHost],
			identity: { ...SIGNED_OUT, connection: "unavailable" },
		});
		const description = () => row().element().textContent ?? "";

		await vi.waitFor(() =>
			expect(description()).toContain("Unavailable while the Kilo agent isn't running."),
		);
		setIdentity({ ...SIGNED_OUT, deviceAuth: { status: "waiting", code: "X" } });
		await vi.waitFor(() => expect(description()).toContain("Finish connecting your Kilo account."));
		setIdentity({ ...SIGNED_OUT, authenticated: true, profileError: "Down" });
		await vi.waitFor(() => expect(description()).toContain("its profile could not be loaded"));
	});

	it("holds its shape while the account loads", async () => {
		await openAccount({
			guests: [providerRowHost],
			identity: { ...SIGNED_OUT, connection: "pending", authenticated: null },
		});

		await expect.element(row()).toHaveAttribute("data-state", "loading");
	});
});

describe("sidebar account entry", () => {
	it("hides when the Kilo server can't be reached", async () => {
		await renderApp({ identity: { ...SIGNED_OUT, connection: "unavailable" } });

		await expect.element(page.getByTestId("app-sidebar")).toBeVisible();
		await expect.element(page.getByTestId("sidebar-kilo-login")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("sidebar-kilo-account")).not.toBeInTheDocument();
	});

	it("falls back to Sign in after a failed sign-in", async () => {
		await renderApp({
			identity: { ...SIGNED_OUT, deviceAuth: { status: "error", error: "Denied." } },
		});

		await expect.element(page.getByTestId("sidebar-kilo-login")).toBeVisible();
	});
});
