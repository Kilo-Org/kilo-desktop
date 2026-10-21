import { describe, expect, it, vi } from "vitest";

import { createFakeSdk } from "@kilo-desktop/testing";

import { anacondaAccountContract, type AnacondaAccountSession } from "../contracts/schemas.js";
import { createAnacondaAccountCapability } from "./anaconda-account-capability.js";

const SIGNED_IN: AnacondaAccountSession = {
	status: "authenticated",
	user: { email: "ada@anaconda.com" },
};

function setup(
	handlers: {
		get?: () => Promise<AnacondaAccountSession>;
		refresh?: () => Promise<AnacondaAccountSession>;
		login?: () => Promise<AnacondaAccountSession>;
		logout?: () => Promise<AnacondaAccountSession>;
		cancel?: () => Promise<undefined>;
	} = {},
) {
	const track = vi.fn(async () => {});
	const focusMainWindow = vi.fn(async () => {});
	const sdk = createFakeSdk({
		featureId: "anaconda-account",
		channels: anacondaAccountContract,
		handlers: {
			"session.get": handlers.get ?? (async () => ({ status: "anonymous" })),
			"login.cancel": handlers.cancel ?? (async () => undefined),
			"session.refresh": handlers.refresh ?? (async () => ({ status: "anonymous" })),
			login: handlers.login ?? (async () => SIGNED_IN),
			logout: handlers.logout ?? (async () => ({ status: "anonymous" })),
		},
		telemetry: { track },
		shell: { focusMainWindow },
	});
	return { sdk, track, focusMainWindow, account: createAnacondaAccountCapability(sdk) };
}

describe("createAnacondaAccountCapability", () => {
	it("resolves the session lazily on first subscribe and notifies subscribers", async () => {
		const get = vi.fn(async () => SIGNED_IN);
		const { account } = setup({ get });
		expect(get).not.toHaveBeenCalled();

		const listener = vi.fn();
		account.subscribe(listener);

		expect(listener).toHaveBeenCalledWith({ status: "anonymous" });
		await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(SIGNED_IN));
		expect(account.peek()).toEqual(SIGNED_IN);
	});

	it("follows anaconda-account.changed events and ignores malformed payloads", async () => {
		const { sdk, account } = setup();
		const listener = vi.fn();
		account.subscribe(listener);

		sdk.events.emit("changed", SIGNED_IN);
		expect(account.peek()).toEqual(SIGNED_IN);

		sdk.events.emit("changed", { status: "bogus" });
		expect(account.peek()).toEqual(SIGNED_IN);
	});

	it("stops following events once the last subscriber leaves", () => {
		const { sdk, account } = setup();
		const unsubscribe = account.subscribe(() => {});
		unsubscribe();

		sdk.events.emit("changed", SIGNED_IN);

		expect(account.peek()).toEqual({ status: "anonymous" });
	});

	it("keeps the anonymous cache when the backend is unreachable", async () => {
		const { account } = setup({ get: async () => Promise.reject(new Error("no backend")) });
		account.subscribe(() => {});
		await expect(account.getSession()).rejects.toThrow();
		expect(account.peek()).toEqual({ status: "anonymous" });
	});

	it("refresh re-checks the key in main and updates the cache", async () => {
		const { account } = setup({ refresh: async () => SIGNED_IN });

		await expect(account.refresh()).resolves.toEqual(SIGNED_IN);
		expect(account.peek()).toEqual(SIGNED_IN);
	});

	it("signs in, updates the cache, and tracks Anaconda Logged In", async () => {
		const { account, track } = setup();

		await expect(account.signIn()).resolves.toEqual({ ok: true });

		expect(account.peek()).toEqual(SIGNED_IN);
		expect(track).toHaveBeenCalledWith(expect.objectContaining({ event: "Anaconda Logged In" }));
	});

	it("brings the app back to the front after a completed sign-in", async () => {
		const { account, focusMainWindow } = setup();

		await account.signIn();

		expect(focusMainWindow).toHaveBeenCalledTimes(1);
	});

	it("leaves focus alone when sign-in fails or on sign-out", async () => {
		const failing = setup({ login: async () => ({ status: "error", reason: "Port in use" }) });
		const signedIn = setup({ get: async () => SIGNED_IN });

		await failing.account.signIn();
		await signedIn.account.signOut();

		expect(failing.focusMainWindow).not.toHaveBeenCalled();
		expect(signedIn.focusMainWindow).not.toHaveBeenCalled();
	});

	it("still reports success when focusing the window fails", async () => {
		const { account, focusMainWindow } = setup();
		focusMainWindow.mockRejectedValueOnce(new Error("no window"));

		await expect(account.signIn()).resolves.toEqual({ ok: true });
	});

	it("reports sign-in failures without tracking or throwing", async () => {
		const failing = setup({ login: async () => ({ status: "error", reason: "Port in use" }) });
		const incomplete = setup({ login: async () => ({ status: "anonymous" }) });
		const throwing = setup({ login: async () => Promise.reject(new Error("ipc down")) });

		await expect(failing.account.signIn()).resolves.toEqual({ ok: false, reason: "Port in use" });
		await expect(incomplete.account.signIn()).resolves.toEqual({
			ok: false,
			reason: "Anaconda sign-in did not complete.",
		});
		await expect(throwing.account.signIn()).resolves.toMatchObject({ ok: false });
		expect(failing.track).not.toHaveBeenCalled();
	});

	it("reports a cancelled sign-in as cancelled, without focusing or tracking", async () => {
		let endLogin: (session: AnacondaAccountSession) => void = () => {};
		const cancel = vi.fn(async () => {
			endLogin({ status: "anonymous" });
			return undefined;
		});
		const { account, track, focusMainWindow } = setup({
			login: () =>
				new Promise((resolve) => {
					endLogin = resolve;
				}),
			cancel,
		});

		const pending = account.signIn();
		await account.cancelSignIn();

		await expect(pending).resolves.toEqual({
			ok: false,
			reason: "Sign-in was cancelled.",
			cancelled: true,
		});
		expect(cancel).toHaveBeenCalledTimes(1);
		expect(track).not.toHaveBeenCalled();
		expect(focusMainWindow).not.toHaveBeenCalled();
	});

	it("does not treat a later sign-in as cancelled", async () => {
		const { account } = setup();
		await account.cancelSignIn();

		await expect(account.signIn()).resolves.toEqual({ ok: true });
	});

	it("signs out and tracks Anaconda Logged Out", async () => {
		const { account, track } = setup({ get: async () => SIGNED_IN });
		await account.getSession();

		await expect(account.signOut()).resolves.toEqual({ ok: true });

		expect(account.peek()).toEqual({ status: "anonymous" });
		expect(track).toHaveBeenCalledWith(expect.objectContaining({ event: "Anaconda Logged Out" }));
	});
});
