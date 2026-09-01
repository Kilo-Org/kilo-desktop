import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { apiKeyFromAuth, kiloAuthFilePath, readStoredApiKey } from "./stored-api-key.js";

describe("kiloAuthFilePath", () => {
	it("uses XDG_DATA_HOME when it is set", () => {
		expect(kiloAuthFilePath({ XDG_DATA_HOME: "/custom/data" }, "/Users/me")).toBe(
			path.join("/custom/data", "kilo", "auth.json"),
		);
	});

	it("falls back to ~/.local/share/kilo/auth.json", () => {
		expect(kiloAuthFilePath({}, "/Users/me")).toBe(
			path.join("/Users/me", ".local", "share", "kilo", "auth.json"),
		);
	});

	it("strips trailing newlines from XDG_DATA_HOME", () => {
		expect(kiloAuthFilePath({ XDG_DATA_HOME: "/custom/data\n" }, "/Users/me")).toBe(
			path.join("/custom/data", "kilo", "auth.json"),
		);
	});
});

describe("apiKeyFromAuth", () => {
	it("returns a stored API key", () => {
		expect(apiKeyFromAuth({ openai: { type: "api", key: " sk-openai-stored " } }, "openai")).toBe(
			"sk-openai-stored",
		);
	});

	it("ignores oauth credentials", () => {
		expect(
			apiKeyFromAuth(
				{ openai: { type: "oauth", refresh: "r", access: "a", expires: 1 } },
				"openai",
			),
		).toBeNull();
	});

	it("returns null when the provider has no auth entry", () => {
		expect(apiKeyFromAuth({ anthropic: { type: "api", key: "sk-ant" } }, "openai")).toBeNull();
	});

	it("does not expose reserved provider credentials", () => {
		expect(apiKeyFromAuth({ kilo: { type: "api", key: "gateway-token" } }, "kilo")).toBeNull();
		expect(
			apiKeyFromAuth({ "anaconda-local": { type: "api", key: "local-key" } }, "anaconda-local"),
		).toBeNull();
	});
});

describe("readStoredApiKey", () => {
	it("reads an API key from auth.json", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-auth-"));
		const file = path.join(directory, "auth.json");
		await writeFile(
			file,
			JSON.stringify({ openai: { type: "api", key: "sk-openai-stored" } }),
			"utf8",
		);
		await expect(readStoredApiKey("openai", file)).resolves.toBe("sk-openai-stored");
	});

	it("returns null when auth.json is missing", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-auth-"));
		await expect(readStoredApiKey("openai", path.join(directory, "auth.json"))).resolves.toBeNull();
	});

	it("returns null when auth.json is not valid JSON", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-auth-"));
		const file = path.join(directory, "auth.json");
		await writeFile(file, "{not-json", "utf8");
		await expect(readStoredApiKey("openai", file)).resolves.toBeNull();
	});
});
