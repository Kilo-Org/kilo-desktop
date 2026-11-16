import { afterEach, describe, expect, it, vi } from "vitest";

import { KernelIdentity } from "@kilo-desktop/kernel";

import { ANACONDA_SIGNED_IN_KEY } from "../contracts";
import {
	bootAnacondaMain as boot,
	recordingLogger,
	SIGNED_IN,
	stopAnacondaMains,
	WAIT,
} from "./test-boot";

afterEach(stopAnacondaMains);

const ownMessages = (messages: unknown[][]) =>
	messages.filter(([message]) => !String(message).startsWith("[kilo.anaconda] Contribution"));

describe("kilo.anaconda in main", () => {
	it("starts anonymous and resolves the session only when asked", async () => {
		const host = await boot({ apiKey: "stored-key" });

		expect(host.account.getState()).toEqual({
			session: { status: "anonymous" },
			signingIn: false,
		});
		expect(host.fetch).not.toHaveBeenCalled();

		await expect(host.account.methods.session(undefined)).resolves.toEqual(SIGNED_IN);
		expect(host.fetch).toHaveBeenCalledWith(
			"https://anaconda.test/api/auth/sessions/whoami",
			expect.objectContaining({ headers: { Authorization: "Bearer stored-key" } }),
		);
		expect(host.account.getState().session).toEqual(SIGNED_IN);
	});

	it("adopts the key origin left in the Anaconda keyring, so a signed-in user stays signed in", async () => {
		const host = await boot({ apiKey: "origin-key" });

		await expect(host.account.methods.refresh(undefined)).resolves.toEqual(SIGNED_IN);
		await expect(host.ownAccount().methods.apiKey(undefined)).resolves.toBe("origin-key");
	});

	it("gives the API key only to kilo.anaconda in main and refuses other plugins", async () => {
		const host = await boot({ apiKey: "secret" });

		await expect(host.ownAccount().methods.apiKey(undefined)).resolves.toBe("secret");
		await expect(host.localInferenceAccount().methods.apiKey(undefined)).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
			message: "Only kilo.anaconda, in the main process, can read the Anaconda API key.",
		});
		await expect(host.strangerAccount().methods.apiKey(undefined)).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		await expect(host.account.methods.apiKey(undefined)).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		await expect(host.strangerAccount().methods.siteDomain(undefined)).resolves.toBe(
			"anaconda.test",
		);
	});

	it("never gives the API key to a window, even one claiming to be kilo.anaconda", async () => {
		const host = await boot({ apiKey: "secret" });

		await expect(host.windowAccount().methods.apiKey(undefined)).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		await expect(host.windowAccount().methods.siteDomain(undefined)).resolves.toBe("anaconda.test");
	});

	it("signs in through the browser, stores the key, focuses the app and reports it once", async () => {
		const host = await boot();
		const changed = vi.fn();
		host.account.on("changed", changed);

		const first = host.account.methods.signIn(undefined);
		await vi.waitFor(() => expect(host.account.getState().signingIn).toBe(true), WAIT);
		await vi.waitFor(() => expect(host.login).toHaveBeenCalled(), WAIT);
		const second = host.account.methods.signIn(undefined);
		await vi.waitFor(() => expect(host.authorize.authorizer.reopen).toHaveBeenCalled(), WAIT);
		host.authorize.complete();

		await expect(first).resolves.toEqual({ ok: true });
		await expect(second).resolves.toEqual({ ok: true });
		expect(host.login).toHaveBeenCalledTimes(1);
		expect(host.credentials.saveApiKey).toHaveBeenCalledWith("new-key");
		expect(host.account.getState()).toEqual({ session: SIGNED_IN, signingIn: false });
		expect(changed).toHaveBeenCalled();
		await vi.waitFor(() => expect(host.focusMain).toHaveBeenCalledTimes(1), WAIT);
		await vi.waitFor(() => expect(host.events()).toEqual(["Anaconda Logged In"]), WAIT);
		expect(host.tracked[0]!.data).toEqual({});
	});

	it("reports a cancelled sign-in as cancelled, without focusing or tracking", async () => {
		const host = await boot();

		const pending = host.account.methods.signIn(undefined);
		await vi.waitFor(() => expect(host.login).toHaveBeenCalled(), WAIT);
		await host.account.methods.cancelSignIn(undefined);

		await expect(pending).resolves.toEqual({
			ok: false,
			reason: "Sign-in was cancelled.",
			cancelled: true,
		});
		expect(host.account.getState().signingIn).toBe(false);
		expect(host.focusMain).not.toHaveBeenCalled();
		await host.main.flush();
		expect(host.events()).toEqual([]);
	});

	it("does not treat a later sign-in as cancelled", async () => {
		const host = await boot();
		await host.account.methods.cancelSignIn(undefined);

		const pending = host.account.methods.signIn(undefined);
		await vi.waitFor(() => expect(host.login).toHaveBeenCalled(), WAIT);
		host.authorize.complete();

		await expect(pending).resolves.toEqual({ ok: true });
	});

	it("reports sign-in failures with their reason", async () => {
		const failing = await boot({
			login: async () => Promise.reject(new Error("Port 8000 is in use.")),
		});
		await expect(failing.account.methods.signIn(undefined)).resolves.toEqual({
			ok: false,
			reason: "Port 8000 is in use.",
		});

		const rejected = await boot({
			login: async () => ({ access_token: "t", token_type: "bearer", raw: {} as never }),
			fetch: async () => new Response("", { status: 401 }),
		});
		await expect(rejected.account.methods.signIn(undefined)).resolves.toEqual({
			ok: false,
			reason: "Anaconda sign-in did not complete.",
		});
		await failing.main.flush();
		expect(failing.events()).toEqual([]);
	});

	it("signs out, deletes the key and reports it", async () => {
		const host = await boot({ apiKey: "stored-key" });
		await host.account.methods.session(undefined);

		await expect(host.account.methods.signOut(undefined)).resolves.toEqual({ ok: true });

		expect(host.credentials.deleteApiKey).toHaveBeenCalledTimes(1);
		expect(host.account.getState().session).toEqual({ status: "anonymous" });
		await vi.waitFor(() => expect(host.events()).toEqual(["Anaconda Logged Out"]), WAIT);
	});

	it("reports a sign-out the keyring refuses", async () => {
		const host = await boot({ apiKey: "stored-key" });
		host.credentials.deleteApiKey.mockRejectedValueOnce(
			new Error("The Anaconda keyring is read-only."),
		);

		await expect(host.account.methods.signOut(undefined)).resolves.toEqual({
			ok: false,
			reason: "The Anaconda keyring is read-only.",
		});
		await host.main.flush();
		expect(host.events()).toEqual([]);
	});

	it("sends nothing to telemetry without consent", async () => {
		const host = await boot({ consent: false });

		const pending = host.account.methods.signIn(undefined);
		await vi.waitFor(() => expect(host.login).toHaveBeenCalled(), WAIT);
		host.authorize.complete();
		await expect(pending).resolves.toEqual({ ok: true });
		await expect(host.account.methods.signOut(undefined)).resolves.toEqual({ ok: true });

		await host.main.flush();
		expect(host.events()).toEqual([]);
	});

	describe("the linked account", () => {
		const linked = (host: Awaited<ReturnType<typeof boot>>) =>
			host.main.kernelSdk.domainObjects.get(KernelIdentity)!.getState().linked;

		it("adds the signed-in Anaconda account to the identity once the session resolves", async () => {
			const host = await boot({ apiKey: "stored-key" });
			expect(linked(host)).toEqual([]);

			await host.account.methods.session(undefined);

			await vi.waitFor(
				() =>
					expect(linked(host)).toEqual([
						{
							id: "u1",
							email: "ada@anaconda.com",
							attributes: {},
							source: "kilo.anaconda/anaconda",
						},
					]),
				WAIT,
			);
		});

		it("falls back to the email, then the username, and is absent without either", async () => {
			const respond = (profile: Record<string, string>) => async () =>
				new Response(JSON.stringify({ passport: { profile } }), { status: 200 });

			const byEmail = await boot({ apiKey: "k", fetch: respond({ email: "ada@anaconda.com" }) });
			await byEmail.account.methods.session(undefined);
			await vi.waitFor(
				() =>
					expect(linked(byEmail)).toEqual([
						expect.objectContaining({ id: "ada@anaconda.com", email: "ada@anaconda.com" }),
					]),
				WAIT,
			);

			const byName = await boot({ apiKey: "k", fetch: respond({ username: "ada" }) });
			await byName.account.methods.session(undefined);
			await vi.waitFor(
				() =>
					expect(linked(byName)).toEqual([
						{ id: "ada", attributes: {}, source: "kilo.anaconda/anaconda" },
					]),
				WAIT,
			);

			const nobody = await boot({ apiKey: "k", fetch: respond({}) });
			await expect(nobody.account.methods.session(undefined)).resolves.toMatchObject({
				status: "authenticated",
			});
			await nobody.main.flush();
			expect(linked(nobody)).toEqual([]);
		});

		it("is removed when the account signs out", async () => {
			const host = await boot({ apiKey: "stored-key" });
			await host.account.methods.session(undefined);
			await vi.waitFor(() => expect(linked(host)).toHaveLength(1), WAIT);

			await host.account.methods.signOut(undefined);

			await vi.waitFor(() => expect(linked(host)).toEqual([]), WAIT);
		});
	});

	describe("the anacondaSignedIn context key", () => {
		const signedIn = (host: Awaited<ReturnType<typeof boot>>) =>
			host.main.kernelSdk.context.get(ANACONDA_SIGNED_IN_KEY);

		it("is false until a resolve finds a signed-in account, and follows sign-in and sign-out", async () => {
			const host = await boot();
			expect(signedIn(host)).toBe(false);

			await host.account.methods.session(undefined);
			expect(signedIn(host)).toBe(false);

			const pending = host.account.methods.signIn(undefined);
			await vi.waitFor(() => expect(host.login).toHaveBeenCalled(), WAIT);
			host.authorize.complete();
			await pending;
			expect(signedIn(host)).toBe(true);

			await host.account.methods.signOut(undefined);
			expect(signedIn(host)).toBe(false);
		});

		it("turns true when a stored key resolves", async () => {
			const host = await boot({ apiKey: "stored-key" });
			expect(signedIn(host)).toBe(false);

			await host.account.methods.refresh(undefined);

			expect(signedIn(host)).toBe(true);
		});
	});

	describe("without the plugins it works with", () => {
		it("activates without kilo.shell, kilo.local-inference or telemetry consent, saying nothing", async () => {
			const { logger, warnings, errors } = recordingLogger();
			const host = await boot({
				apiKey: "stored-key",
				withoutShell: true,
				withoutLocalInference: true,
				consent: false,
				logger,
			});

			await expect(host.account.methods.session(undefined)).resolves.toEqual(SIGNED_IN);
			await expect(host.account.methods.signOut(undefined)).resolves.toEqual({ ok: true });
			expect(host.catalogContribution()).toBeUndefined();
			expect(ownMessages(warnings)).toEqual([]);
			expect(ownMessages(errors)).toEqual([]);
		});
	});
});
