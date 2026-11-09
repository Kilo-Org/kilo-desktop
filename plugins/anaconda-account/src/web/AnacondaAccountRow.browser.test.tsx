import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { DomainProvider, PluginEntry, PluginSdk } from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";
import { accountTestPlugin } from "@kilo-desktop/plugin-account/testing";
import { renderShell, type ShellHost } from "@kilo-desktop/plugin-shell/testing";

import manifest from "../../plugin.json";
import {
	ANACONDA_ACCOUNT_DEFINITIONS,
	AnacondaAccount,
	type AnacondaAccountResult,
	type AnacondaAccountSession,
} from "../contracts/index.js";
import { anacondaAccountWebEntry } from "./index.js";

const WAIT = { timeout: 10_000 };

const SIGNED_IN: AnacondaAccountSession = {
	status: "authenticated",
	user: { email: "dev@anaconda.com", username: "dev" },
};

/** A stand-in for kilo.flags with the model catalog flag on or off. */
const flagsPlugin = (catalog: boolean) => ({
	manifest: testManifest("kilo.flags", { contextKeys: [{ id: "flag:*", scope: "global" }] }),
	main: {
		activate(sdk: PluginSdk) {
			sdk.context.set("flag:local-model-catalog", catalog);
		},
	},
});

/** Stands in for kilo.anaconda-account's main entry: an account the test drives. */
function fakeAccountMain(options: {
	session: AnacondaAccountSession;
	refresh?: () => Promise<AnacondaAccountSession>;
	signIn?: (provider: DomainProvider<typeof AnacondaAccount>) => Promise<AnacondaAccountResult>;
}) {
	let provider: DomainProvider<typeof AnacondaAccount> | undefined;
	const setSession = (session: AnacondaAccountSession) =>
		provider!.update((state) => ({ ...state, session }));
	const methods = {
		session: vi.fn(async () => provider!.state.session),
		refresh: vi.fn(options.refresh ?? (async () => provider!.state.session)),
		signIn: vi.fn(async () => {
			if (options.signIn) return options.signIn(provider!);
			setSession(SIGNED_IN);
			return { ok: true as const };
		}),
		cancelSignIn: vi.fn(),
		signOut: vi.fn(async () => {
			setSession({ status: "anonymous" });
			return { ok: true as const };
		}),
		apiKey: vi.fn(async () => null),
		siteDomain: vi.fn(async () => "anaconda.com"),
	};
	const entry: PluginEntry = {
		activate(sdk) {
			provider = sdk.domains.provide(AnacondaAccount, {
				initialState: { session: options.session, signingIn: false },
				methods,
			});
		},
	};
	return { entry, methods, provider: () => provider! };
}

const hosts: ShellHost[] = [];
afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.main.stop()));
});

async function openAccountPage(
	options: {
		session?: AnacondaAccountSession;
		refresh?: () => Promise<AnacondaAccountSession>;
		signIn?: (provider: DomainProvider<typeof AnacondaAccount>) => Promise<AnacondaAccountResult>;
		catalog?: boolean;
		withAccountPlugin?: boolean;
	} = {},
) {
	const account = fakeAccountMain({
		session: options.session ?? { status: "anonymous" },
		...(options.refresh ? { refresh: options.refresh } : {}),
		...(options.signIn ? { signIn: options.signIn } : {}),
	});
	const host = await renderShell(
		[
			accountTestPlugin,
			flagsPlugin(options.catalog ?? true),
			...(options.withAccountPlugin === false
				? []
				: [
						{
							manifest,
							definitions: ANACONDA_ACCOUNT_DEFINITIONS,
							main: account.entry,
							web: anacondaAccountWebEntry,
						},
					]),
		],
		{ desktop: true },
	);
	hosts.push(host);
	window.location.hash = "#/settings/account";
	await expect.element(page.getByTestId("account-kilo-row")).toBeInTheDocument();
	return account;
}

describe("the Anaconda row on the Account page", () => {
	it("shows the signed-in email and signs out", async () => {
		const { methods } = await openAccountPage({ session: SIGNED_IN });

		await expect
			.element(page.getByTestId("account-anaconda-email"), WAIT)
			.toHaveTextContent("Signed in as dev@anaconda.com");
		await page.getByTestId("account-anaconda-sign-out").click();

		await vi.waitFor(() => expect(methods.signOut).toHaveBeenCalledTimes(1), WAIT);
		await expect
			.element(page.getByTestId("account-anaconda-status"), WAIT)
			.toHaveTextContent("Not signed in.");
	});

	it("signs in from the not-signed-in state", async () => {
		const { methods } = await openAccountPage();

		await expect
			.element(page.getByTestId("account-anaconda-status"), WAIT)
			.toHaveTextContent("Not signed in.");
		await page.getByTestId("account-anaconda-sign-in").click();

		await vi.waitFor(() => expect(methods.signIn).toHaveBeenCalledTimes(1), WAIT);
		await expect
			.element(page.getByTestId("account-anaconda-email"), WAIT)
			.toHaveTextContent("Signed in as dev@anaconda.com");
	});

	it("re-checks the stored key when the row mounts", async () => {
		const { methods } = await openAccountPage({ session: SIGNED_IN });

		await expect
			.element(page.getByTestId("account-anaconda-email"), WAIT)
			.toHaveTextContent("Signed in as dev@anaconda.com");
		expect(methods.refresh).toHaveBeenCalledTimes(1);
	});

	it("shows the session error reason", async () => {
		await openAccountPage({ session: { status: "error", reason: "Keyring unavailable" } });

		await expect
			.element(page.getByTestId("account-anaconda-status"), WAIT)
			.toHaveTextContent("Keyring unavailable");
	});

	it("stays loading until the session resolves", async () => {
		await openAccountPage({ refresh: () => new Promise(() => {}) });

		await expect
			.element(page.getByTestId("account-anaconda-row"), WAIT)
			.toHaveAttribute("data-state", "loading");
	});

	it("offers Cancel while waiting for the browser and ends the sign-in quietly", async () => {
		let endSignIn: () => void = () => {};
		const { methods } = await openAccountPage({
			signIn: (provider) => {
				provider.update((state) => ({ ...state, signingIn: true }));
				return new Promise((resolve) => {
					endSignIn = () => {
						provider.update((state) => ({ ...state, signingIn: false }));
						resolve({ ok: false, reason: "Sign-in was cancelled.", cancelled: true });
					};
				});
			},
		});
		methods.cancelSignIn.mockImplementation(() => endSignIn());

		await page.getByTestId("account-anaconda-sign-in").click();
		await expect
			.element(page.getByTestId("account-anaconda-sign-in"), WAIT)
			.toHaveTextContent("Waiting for browser…");
		await page.getByTestId("account-anaconda-cancel-sign-in").click();

		await vi.waitFor(() => expect(methods.cancelSignIn).toHaveBeenCalledTimes(1), WAIT);
		await expect
			.element(page.getByTestId("account-anaconda-sign-in"), WAIT)
			.toHaveTextContent("Sign in");
		expect(page.getByTestId("account-anaconda-cancel-sign-in").query()).toBeNull();
		expect(page.getByText("Could not sign in to Anaconda").query()).toBeNull();
	});

	it("toasts a failed sign-in", async () => {
		await openAccountPage({
			signIn: async () => ({ ok: false, reason: "Port 8000 is in use." }),
		});

		await page.getByTestId("account-anaconda-sign-in").click();

		await expect.element(page.getByText("Could not sign in to Anaconda"), WAIT).toBeVisible();
		await expect.element(page.getByText("Port 8000 is in use."), WAIT).toBeVisible();
	});

	it("toasts a failed sign-out", async () => {
		const { methods } = await openAccountPage({ session: SIGNED_IN });
		methods.signOut.mockResolvedValueOnce({ ok: false, reason: "Keyring is read-only." } as never);

		await page.getByTestId("account-anaconda-sign-out").click();

		await expect.element(page.getByText("Could not sign out of Anaconda"), WAIT).toBeVisible();
	});

	it("is absent while the model catalog flag is off", async () => {
		await openAccountPage({ catalog: false });

		await expect.element(page.getByTestId("account-kilo-row"), WAIT).toBeVisible();
		expect(page.getByTestId("account-anaconda-row").query()).toBeNull();
		expect(page.getByTestId("account-panel-kilo.anaconda-account/anaconda").query()).toBeNull();
	});

	it("is absent when kilo.anaconda-account is not installed", async () => {
		await openAccountPage({ withAccountPlugin: false });

		await expect.element(page.getByTestId("account-kilo-row"), WAIT).toBeVisible();
		expect(page.getByTestId("account-anaconda-row").query()).toBeNull();
	});
});
