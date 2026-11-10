import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { testManifest } from "@kilo-desktop/kernel/testing";
import type { HostedPlugin } from "@kilo-desktop/kernel/testing/plugin-host";

import { AccountPanel, AiProviderPanel, Dialog } from "../../../contracts";
import { bootAccount, disposeHosts, PROFILE, SIGNED_IN, SIGNED_OUT } from "../test-harness";
import { KiloGatewayAccountPanel } from "./KiloGatewayAccountPanel";

afterEach(disposeHosts);

/** Hosts the Gateway panel outside the Kilo panels, with its own sign-out. */
const gatewayHost: HostedPlugin = {
	manifest: testManifest("acme.providers", {
		contributes: { extensions: { "kilo.shell/dialog": [{ id: "gateway", title: "Gateway" }] } },
	}),
	web: {
		activate: (sdk) => {
			sdk.extensions.implement(Dialog, "gateway", () => (
				<div data-qa-id="hosted-gateway">
					<KiloGatewayAccountPanel />
				</div>
			));
		},
	},
};

const WAITING = {
	...SIGNED_OUT,
	deviceSignIn: {
		status: "waiting" as const,
		code: "ABCD-1234",
		verificationUrl: "https://app.kilo.ai/device",
		expiresIn: 900,
	},
};

async function openAccountPanel(options: Parameters<typeof bootAccount>[0] = {}) {
	const app = await bootAccount(options);
	app.host.renderSlot(AccountPanel);
	return app;
}

async function openGatewayRow(options: Parameters<typeof bootAccount>[0] = {}) {
	const app = await bootAccount(options);
	app.host.renderSlot(AiProviderPanel);
	return app;
}

async function openHostedGateway(options: Parameters<typeof bootAccount>[0] = {}) {
	const app = await bootAccount({ ...options, guests: [gatewayHost] });
	app.host.renderSlot(Dialog);
	return app;
}

describe("Kilo account panel", () => {
	it("shows a signed-out Kilo row with Sign in", async () => {
		const { methods } = await openAccountPanel();

		const row = page.getByTestId("account-kilo-row");
		await expect.element(row.getByText("Not signed in.")).toBeInTheDocument();
		await page.getByTestId("account-kilo-sign-in").click();

		await vi.waitFor(() => expect(methods.signIn).toHaveBeenCalled());
	});

	it("shows the signed-in account's balance, organization and Kilo Pass", async () => {
		const { methods, openExternal } = await openAccountPanel({ account: SIGNED_IN });

		await expect
			.element(page.getByTestId("account-kilo-email"))
			.toHaveTextContent("Signed in as ada@example.com");
		await expect
			.element(page.getByTestId("kilo-account-balance-value"))
			.toHaveTextContent("$12.50");
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

	it("says the account needs the Kilo server when the desktop app can't reach it", async () => {
		await openAccountPanel({ account: { ...SIGNED_OUT, connection: "unavailable" } });

		await expect
			.element(page.getByTestId("account-kilo-status"))
			.toHaveTextContent("Unavailable while the Kilo server isn't running.");
		await expect.element(page.getByTestId("account-kilo-sign-in")).toBeDisabled();
	});

	it("says the account is only available in the desktop app in a browser", async () => {
		await openAccountPanel({
			desktop: false,
			account: { ...SIGNED_OUT, connection: "unavailable" },
		});

		await expect
			.element(page.getByTestId("account-kilo-status"))
			.toHaveTextContent("Available in the desktop app.");
		await expect.element(page.getByTestId("account-kilo-sign-in")).toBeDisabled();
	});

	it("shows the device code to enter in the browser, with copy and cancel", async () => {
		const { methods, writeText, openExternal } = await openAccountPanel({ account: WAITING });

		await expect
			.element(page.getByTestId("kilo-account-device-code"))
			.toHaveTextContent("ABCD-1234");
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
		await page.getByTestId("kilo-account-cancel").click();
		await vi.waitFor(() => expect(methods.cancelSignIn).toHaveBeenCalled());
	});

	it("shows sign-in starting and finishing", async () => {
		const { setAccount, methods } = await openAccountPanel({
			account: { ...SIGNED_OUT, deviceSignIn: { status: "initiating" } },
		});
		await expect.element(page.getByTestId("kilo-account-device-auth")).toBeInTheDocument();
		await page.getByTestId("kilo-account-cancel").click();
		await vi.waitFor(() => expect(methods.cancelSignIn).toHaveBeenCalled());

		setAccount({ ...SIGNED_OUT, deviceSignIn: { status: "finishing" } });
		await expect
			.element(page.getByTestId("kilo-account-device-auth"))
			.toHaveAttribute("data-state", "finishing");
		await expect.element(page.getByTestId("kilo-account-device-code")).not.toBeInTheDocument();
	});

	it("explains a failed sign-in and offers to try again", async () => {
		const { methods } = await openAccountPanel({
			account: { ...SIGNED_OUT, deviceSignIn: { status: "error", error: "The code expired." } },
		});

		await expect.element(page.getByText("The code expired.")).toBeVisible();
		await page.getByTestId("kilo-account-retry").click();
		await vi.waitFor(() => expect(methods.signIn).toHaveBeenCalled());
	});

	it("offers retry and sign-out when the profile can't be loaded", async () => {
		const { methods } = await openAccountPanel({
			account: { ...SIGNED_OUT, signedIn: true, profileError: "Kilo API unavailable" },
		});

		await expect.element(page.getByText("Kilo API unavailable")).toBeVisible();
		await page.getByTestId("kilo-account-profile-retry").click();
		await vi.waitFor(() => expect(methods.refresh).toHaveBeenCalled());
		await page.getByTestId("account-kilo-sign-out").click();
		await vi.waitFor(() => expect(methods.signOut).toHaveBeenCalled());
	});

	it("keeps the signed-in view when an organization switch fails, until dismissed", async () => {
		const { methods, setAccount } = await openAccountPanel({
			account: {
				...SIGNED_IN,
				organizationError: { message: "Not a member.", organizationId: "org-1" },
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
		await expect.element(page.getByTestId("kilo-account-org-error")).not.toBeInTheDocument();
		// Other account updates keep it hidden; the next switch's failure shows again.
		setAccount({
			...SIGNED_IN,
			refreshing: true,
			organizationError: { message: "Not a member.", organizationId: "org-1" },
		});
		await expect.element(page.getByTestId("kilo-account-refresh")).toBeDisabled();
		await expect.element(page.getByTestId("kilo-account-org-error")).not.toBeInTheDocument();
		setAccount({ ...SIGNED_IN, switchingOrganization: true });
		await expect.element(page.getByTestId("kilo-account-org")).toBeDisabled();
		setAccount({
			...SIGNED_IN,
			organizationError: { message: "Not a member.", organizationId: "org-1" },
		});
		await expect.element(page.getByTestId("kilo-account-org-error")).toBeVisible();
	});

	it("offers Kilo Pass to a personal account without one", async () => {
		const { openExternal } = await openAccountPanel({
			account: { ...SIGNED_IN, profile: { ...PROFILE, kiloPass: null } },
		});

		await page.getByTestId("kilo-account-get-pass").click();
		await vi.waitFor(() =>
			expect(openExternal).toHaveBeenCalledWith(
				{ url: "https://kilo.ai/pricing/kilo-pass" },
				expect.anything(),
			),
		);
	});

	it("leaves Kilo Pass out for an organization account", async () => {
		await openAccountPanel({
			account: { ...SIGNED_IN, profile: { ...PROFILE, currentOrgId: "org-1" } },
		});

		await expect.element(page.getByTestId("kilo-account-balance")).toBeInTheDocument();
		await expect.element(page.getByTestId("kilo-account-get-pass")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("kilo-account-pass-bar")).not.toBeInTheDocument();
	});

	it("refreshes the balance on request", async () => {
		const { methods } = await openAccountPanel({ account: SIGNED_IN });

		await page.getByTestId("kilo-account-refresh").click();

		await vi.waitFor(() => expect(methods.refresh).toHaveBeenCalled());
	});

	it("holds the Kilo row in a loading state until the account is known", async () => {
		const { setAccount } = await openAccountPanel({
			account: { ...SIGNED_OUT, connection: "pending", signedIn: null },
		});

		await expect
			.element(page.getByTestId("account-kilo-row"))
			.toHaveAttribute("data-state", "loading");
		// Signed in, profile on its way: the account details are reserved too.
		setAccount({ ...SIGNED_OUT, signedIn: true });
		await expect
			.element(page.getByTestId("kilo-account-settings"))
			.toHaveAttribute("data-state", "loading");
	});
});

describe("Kilo Gateway panel hosted elsewhere", () => {
	const gateway = () => page.getByTestId("hosted-gateway");

	it("invites signing in when signed out", async () => {
		const { methods } = await openHostedGateway();

		await gateway().getByTestId("kilo-account-login").click();

		await vi.waitFor(() => expect(methods.signIn).toHaveBeenCalled());
	});

	it("says Kilo needs the desktop app when the server can't be reached", async () => {
		await openHostedGateway({ account: { ...SIGNED_OUT, connection: "unavailable" } });

		await expect.element(gateway().getByTestId("kilo-account-unavailable")).toBeInTheDocument();
	});

	it("holds its place while the account loads", async () => {
		await openHostedGateway({ account: { ...SIGNED_OUT, connection: "pending", signedIn: null } });

		await expect
			.element(gateway().getByTestId("kilo-account-settings"))
			.toHaveAttribute("data-state", "loading");
	});

	it("signs out from the panel", async () => {
		const { methods } = await openHostedGateway({ account: SIGNED_IN });

		await gateway().getByTestId("kilo-account-logout").click();

		await vi.waitFor(() => expect(methods.signOut).toHaveBeenCalled());
	});

	it("signs out from a profile that can't be loaded", async () => {
		const { methods } = await openHostedGateway({
			account: { ...SIGNED_OUT, signedIn: true, profileError: "Down" },
		});

		await gateway().getByTestId("kilo-account-logout").click();

		await vi.waitFor(() => expect(methods.signOut).toHaveBeenCalled());
	});
});

describe("Kilo Gateway AI provider panel", () => {
	const row = () => page.getByTestId("kilo-providers-row-kilo");

	it("summarises the gateway with Sign in when signed out", async () => {
		const { methods } = await openGatewayRow();

		await expect.element(row()).toHaveAttribute("data-state", "summary");
		await row().getByTestId("kilo-account-login").click();
		await vi.waitFor(() => expect(methods.signIn).toHaveBeenCalled());
	});

	it("opens the account details with Sign out in the row header when signed in", async () => {
		const { methods } = await openGatewayRow({ account: SIGNED_IN });

		await expect.element(row()).toHaveAttribute("data-state", "expanded");
		await expect
			.element(row().getByTestId("kilo-account-email"))
			.toHaveTextContent("ada@example.com");
		await expect.element(row().getByTestId("kilo-account-balance-value")).toBeInTheDocument();
		const header = row().getByTestId("kilo-provider-header-actions");
		await expect.element(row().getByTestId("kilo-account-login")).not.toBeInTheDocument();
		await header.getByTestId("kilo-account-logout").click();
		await vi.waitFor(() => expect(methods.signOut).toHaveBeenCalled());
	});

	it("describes where sign-in stands", async () => {
		const { setAccount } = await openGatewayRow({
			account: { ...SIGNED_OUT, connection: "unavailable" },
		});
		const description = () => row().element().textContent ?? "";

		await vi.waitFor(() =>
			expect(description()).toContain("Unavailable while the Kilo server isn't running."),
		);
		setAccount({ ...SIGNED_OUT, deviceSignIn: { status: "waiting", code: "X" } });
		await vi.waitFor(() => expect(description()).toContain("Finish connecting your Kilo account."));
		setAccount({ ...SIGNED_OUT, signedIn: true, profileError: "Down" });
		await vi.waitFor(() => expect(description()).toContain("its profile could not be loaded"));
	});

	it("holds its shape while the account loads", async () => {
		const { setAccount } = await openGatewayRow({
			account: { ...SIGNED_OUT, connection: "pending", signedIn: null },
		});

		await expect.element(row()).toHaveAttribute("data-state", "loading");
		setAccount({ ...SIGNED_OUT, signedIn: true });
		await expect
			.element(row().getByTestId("kilo-account-settings"))
			.toHaveAttribute("data-state", "loading");
	});
});
