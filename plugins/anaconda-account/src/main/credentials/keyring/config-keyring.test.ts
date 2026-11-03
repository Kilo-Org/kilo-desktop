import { describe, it, expect } from "vitest";
import { ConfigKeyring } from "./config-keyring.js";
import { encodeToken } from "./codec.js";
import type { AnacondaAuthSite } from "../config.js";
import type { TokenPayload } from "../types.js";

function createSite(overrides: Partial<AnacondaAuthSite> = {}): AnacondaAuthSite {
	return {
		domain: "anaconda.com",
		...overrides,
	};
}

describe("ConfigKeyring", () => {
	it("getToken returns api_key as token when domain matches", async () => {
		const backend = new ConfigKeyring(createSite({ api_key: "ak-inline-123" }));

		const result = await backend.getToken("anaconda.com");

		expect(result).toEqual({
			domain: "anaconda.com",
			api_key: "ak-inline-123",
			repo_tokens: [],
		});
	});

	it("getToken returns null when domain does not match", async () => {
		const backend = new ConfigKeyring(createSite({ api_key: "ak-inline-123" }));

		const result = await backend.getToken("other.com");

		expect(result).toBeNull();
	});

	it("getToken decodes from keyring config when api_key is absent", async () => {
		const payload: TokenPayload = {
			domain: "anaconda.com",
			api_key: "ak-from-keyring",
			version: 2,
		};
		const keyring = {
			"Anaconda Cloud": {
				"anaconda.com": encodeToken(payload),
			},
		};
		const backend = new ConfigKeyring(createSite({ keyring }));

		const result = await backend.getToken("anaconda.com");

		expect(result?.api_key).toBe("ak-from-keyring");
	});

	it("saveToken throws error", async () => {
		const backend = new ConfigKeyring(createSite({ api_key: "ak-123" }));

		await expect(backend.saveToken("anaconda.com", { domain: "anaconda.com" })).rejects.toThrow(
			"Cannot save credentials",
		);
	});

	it("deleteToken throws error", async () => {
		const backend = new ConfigKeyring(createSite({ api_key: "ak-123" }));

		await expect(backend.deleteToken("anaconda.com")).rejects.toThrow("Cannot delete credentials");
	});

	it("priority is 100 when api_key is set", () => {
		const backend = new ConfigKeyring(createSite({ api_key: "ak-123" }));
		expect(backend.priority).toBe(100);
	});

	it("priority is 0 when neither api_key nor keyring is set", () => {
		const backend = new ConfigKeyring(createSite());
		expect(backend.priority).toBe(0);
	});
});
