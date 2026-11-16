import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { ShellHost } from "@kilo-desktop/plugin-shell/testing";

import {
	openAccountPage as openPage,
	SIGNED_IN,
	type AnacondaHostOptions,
} from "../test/anaconda-host";

const WAIT = { timeout: 10_000 };

const hosts: ShellHost[] = [];
afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.main.stop()));
});

async function openAccountPage(options: AnacondaHostOptions = {}) {
	const account = await openPage(options);
	hosts.push(account.host);
	return account;
}

describe("the Anaconda panel on the Account page", () => {
	it("sits in its own frame on kilo.shell's Account page", async () => {
		await openAccountPage();

		await expect
			.element(
				page
					.getByTestId("account-panel-kilo.anaconda/anaconda")
					.getByTestId("account-anaconda-row"),
				WAIT,
			)
			.toBeInTheDocument();
	});

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

		// v2's kilo.shell always frames its own Kilo account, so the page is never empty ("account-none").
		await expect
			.element(page.getByTestId("account-panel-kilo.shell/kilo"), WAIT)
			.toBeInTheDocument();
		expect(page.getByTestId("account-anaconda-row").query()).toBeNull();
		expect(page.getByTestId("account-panel-kilo.anaconda/anaconda").query()).toBeNull();
	});
});
