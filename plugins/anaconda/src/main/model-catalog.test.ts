import { afterEach, describe, expect, it, vi } from "vitest";

import { bootAnacondaMain as boot, recordingLogger, stopAnacondaMains, WAIT } from "./test-boot";

afterEach(stopAnacondaMains);

const SIGN_IN_FIRST =
	"Sign in to your Anaconda account (Settings → Account) to view the model catalog.";
const forbidden = () => new Response("", { status: 403 });
const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
const whoamiBody = { passport: { user_id: "u1", profile: { email: "ada@anaconda.com" } } };

/** Answers whoami as signed in, and the catalog routes with `catalog`. */
function anacondaServer(catalog: (url: string) => Response) {
	return async (input: string | URL | Request) => {
		const url = String(input);
		return url.endsWith("/api/auth/sessions/whoami") ? json(whoamiBody) : catalog(url);
	};
}

const apiModel = {
	model_uuid: "llama",
	name: "Llama 3.1 8B Instruct",
	description: "A compact instruction-tuned language model.",
	num_parameters: 8_000_000_000,
	model_type: "LlamaForConditionalGeneration",
	trained_for: "text-generation",
	library_name: "transformers",
	license: "llama3.1",
	context_window_size: 131_072,
	source: { name: "Meta" },
	tags: [{ name: "chat" }],
	quantized_files: [
		{
			file_uuid: "llama-q4",
			format: "gguf",
			quant_method: "Q4_K_M",
			size_bytes: 4_900_000_000,
			sha256: "a".repeat(64),
			published: true,
		},
	],
};

describe("kilo.anaconda's model catalog", () => {
	describe("access", () => {
		it("is resolving until the session is resolved, which only showing the catalog does", async () => {
			const host = await boot({ apiKey: "stored-key" });
			const catalog = host.catalog();

			expect(catalog.access()).toEqual({ status: "resolving" });
			expect(host.fetch).not.toHaveBeenCalled();

			await catalog.resolveAccess!();

			expect(catalog.access()).toEqual({ status: "signed-in", accountKey: "u1" });
			expect(host.account.getState().session.status).toBe("authenticated");
		});

		it("is signed out when there is no key, and calls back on that first resolve", async () => {
			const host = await boot();
			const catalog = host.catalog();
			const onChange = vi.fn();
			catalog.subscribe!(onChange);

			await catalog.resolveAccess!();

			expect(catalog.access()).toEqual({ status: "signed-out" });
			expect(onChange).toHaveBeenCalledTimes(1);

			await catalog.resolveAccess!();
			await host.account.methods.session(undefined);
			expect(onChange).toHaveBeenCalledTimes(1);
		});

		it("uses the email as the account key when there is no user id", async () => {
			const host = await boot({
				apiKey: "k",
				fetch: async () => json({ passport: { profile: { email: "ada@anaconda.com" } } }),
			});

			await host.catalog().resolveAccess!();

			expect(host.catalog().access()).toEqual({
				status: "signed-in",
				accountKey: "ada@anaconda.com",
			});
		});

		it("reports a session that could not be resolved", async () => {
			const host = await boot({
				apiKey: "k",
				fetch: async () => new Response("", { status: 500 }),
			});

			await host.catalog().resolveAccess!();

			expect(host.catalog().access()).toEqual({
				status: "error",
				reason: "whoami request failed (500)",
			});
		});

		it("calls back when the account signs in, signs out or its key rotates", async () => {
			const host = await boot();
			const catalog = host.catalog();
			const onChange = vi.fn();
			const stop = catalog.subscribe!(onChange);
			await catalog.resolveAccess!();
			onChange.mockClear();

			const pending = catalog.signIn!();
			await vi.waitFor(() => expect(host.login).toHaveBeenCalled(), WAIT);
			host.authorize.complete();
			await expect(pending).resolves.toEqual({ ok: true });
			expect(onChange).toHaveBeenCalled();
			expect(catalog.access()).toEqual({ status: "signed-in", accountKey: "u1" });

			onChange.mockClear();
			await host.credentials.saveApiKey("rotated-key");
			await host.account.methods.refresh(undefined);
			expect(onChange).toHaveBeenCalledTimes(1);

			onChange.mockClear();
			await host.account.methods.signOut(undefined);
			expect(onChange).toHaveBeenCalledTimes(1);
			expect(catalog.access()).toEqual({ status: "signed-out" });

			stop();
			await host.account.methods.refresh(undefined);
			await host.credentials.saveApiKey("again");
			await host.account.methods.refresh(undefined);
			expect(onChange).toHaveBeenCalledTimes(1);
		});
	});

	describe("the Anaconda key", () => {
		it("fetches the catalog from the account's site with its API key", async () => {
			const host = await boot({ apiKey: "anaconda-key", fetch: async () => forbidden() });

			await expect(host.catalog().list()).rejects.toMatchObject({
				message: "Your Anaconda account does not have access to the model catalog.",
			});
			expect(host.fetch).toHaveBeenCalledWith(
				"https://anaconda.test/api/ai/model/models",
				expect.objectContaining({
					headers: expect.objectContaining({ Authorization: "Bearer anaconda-key" }),
				}),
			);
		});

		it("asks to sign in when the account has no key", async () => {
			const host = await boot({ fetch: async () => forbidden() });

			await expect(host.catalog().list()).rejects.toMatchObject({ message: SIGN_IN_FIRST });
			expect(host.fetch).not.toHaveBeenCalled();
		});

		it("asks to sign in, with a warning, when the key can't be read", async () => {
			const { logger, warnings } = recordingLogger();
			const host = await boot({ apiKey: "k", fetch: async () => forbidden(), logger });
			host.credentials.getApiKey.mockRejectedValueOnce(new Error("Keychain locked."));

			await expect(host.catalog().list()).rejects.toMatchObject({ message: SIGN_IN_FIRST });
			expect(host.fetch).not.toHaveBeenCalled();
			expect(warnings.flat().join("\n")).toContain(
				"Could not read the Anaconda API key: Keychain locked.",
			);
		});

		it("falls back to anaconda.com when the site can't be read", async () => {
			const host = await boot({ apiKey: "k", fetch: async () => forbidden() });
			host.credentials.getSiteDomain.mockRejectedValueOnce(new Error("Broken config."));

			await expect(host.catalog().list()).rejects.toThrow();
			expect(host.fetch).toHaveBeenCalledWith(
				"https://anaconda.com/api/ai/model/models",
				expect.anything(),
			);
		});
	});

	it("lists the catalog's models", async () => {
		const host = await boot({
			apiKey: "k",
			fetch: async () => json({ result: { data: [apiModel], total: 1 } }),
		});

		const catalog = await host.catalog().list();

		expect(catalog.total).toBe(1);
		expect(catalog.models[0]).toMatchObject({
			id: "llama",
			name: "Llama 3.1 8B Instruct",
			quantizations: [{ id: "llama-q4", method: "Q4_K_M" }],
		});
	});

	it("gets a model's download URL with the account's key", async () => {
		const host = await boot({
			apiKey: "k",
			fetch: anacondaServer(() => json({ download_url: "https://downloads.test/llama.gguf" })),
		});

		await expect(
			host
				.catalog()
				.downloadUrl(
					{ modelId: "llama", quantizationId: "llama-q4" },
					new AbortController().signal,
				),
		).resolves.toBe("https://downloads.test/llama.gguf");
		expect(host.fetch).toHaveBeenCalledWith(
			"https://anaconda.test/api/ai/model/models/llama/files/llama-q4/download",
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: "Bearer k" }),
			}),
		);
	});

	describe("sign-in", () => {
		it("is the account's sign-in: shared with the domain object, focusing the app and reported", async () => {
			const host = await boot();
			const catalog = host.catalog();

			const fromCatalog = catalog.signIn!();
			await vi.waitFor(() => expect(host.account.getState().signingIn).toBe(true), WAIT);
			await vi.waitFor(() => expect(host.login).toHaveBeenCalled(), WAIT);
			const fromAccountRow = host.account.methods.signIn(undefined);
			await vi.waitFor(() => expect(host.authorize.authorizer.reopen).toHaveBeenCalled(), WAIT);
			host.authorize.complete();

			await expect(fromCatalog).resolves.toEqual({ ok: true });
			await expect(fromAccountRow).resolves.toEqual({ ok: true });
			expect(host.login).toHaveBeenCalledTimes(1);
			await vi.waitFor(() => expect(host.focusMain).toHaveBeenCalledTimes(1), WAIT);
			await vi.waitFor(() => expect(host.events()).toEqual(["Anaconda Logged In"]), WAIT);
		});

		it("can be cancelled from the catalog", async () => {
			const host = await boot();
			const catalog = host.catalog();

			const pending = catalog.signIn!();
			await vi.waitFor(() => expect(host.login).toHaveBeenCalled(), WAIT);
			await catalog.cancelSignIn!();

			await expect(pending).resolves.toEqual({
				ok: false,
				reason: "Sign-in was cancelled.",
				cancelled: true,
			});
			expect(host.account.getState().signingIn).toBe(false);
		});
	});
});
