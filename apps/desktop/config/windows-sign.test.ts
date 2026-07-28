import { describe, expect, it } from "vitest";

import { hasAzureWindowsSigningCredentials, signWindowsFile } from "./windows-sign.js";

describe("windows signing helpers", () => {
	it("detects Azure Key Vault signing credentials", () => {
		expect(hasAzureWindowsSigningCredentials({})).toBe(false);
		expect(
			hasAzureWindowsSigningCredentials({
				AZURE_KEY_VAULT_URI: "https://example.vault.azure.net/",
			}),
		).toBe(false);
		expect(
			hasAzureWindowsSigningCredentials({
				AZURE_KEY_VAULT_URI: "https://example.vault.azure.net/",
				AZURE_CERT_NAME: "codesign",
			}),
		).toBe(true);
	});

	it("fails hard when Azure signing is invoked without credentials", async () => {
		await expect(signWindowsFile("app.exe", {})).rejects.toThrow(
			"Azure Windows signing requires AZURE_KEY_VAULT_URI and AZURE_CERT_NAME",
		);
		await expect(
			signWindowsFile("app.exe", {
				AZURE_KEY_VAULT_URI: "https://example.vault.azure.net/",
			}),
		).rejects.toThrow("Azure Windows signing requires AZURE_KEY_VAULT_URI and AZURE_CERT_NAME");
	});
});
