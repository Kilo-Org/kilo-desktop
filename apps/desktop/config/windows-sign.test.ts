import { beforeEach, describe, expect, it, vi } from "vitest";

const { promisifiedExecFile } = vi.hoisted(() => ({
	promisifiedExecFile: vi.fn(),
}));

vi.mock("node:child_process", () => {
	const execFile = Object.assign(vi.fn(), {
		[Symbol.for("nodejs.util.promisify.custom")]: promisifiedExecFile,
	});
	return { execFile };
});

import { hasAzureWindowsSigningCredentials, signWindowsFile } from "./windows-sign.js";

describe("windows signing helpers", () => {
	beforeEach(() => {
		promisifiedExecFile.mockReset();
	});

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
		expect(promisifiedExecFile).not.toHaveBeenCalled();
	});

	it("invokes AzureSignTool and surfaces stdout/stderr", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		promisifiedExecFile.mockResolvedValue({
			stdout: "signed ok\n",
			stderr: "warning: timestamp\n",
		});

		await signWindowsFile("app.exe", {
			AZURE_KEY_VAULT_URI: " https://example.vault.azure.net/ ",
			AZURE_CERT_NAME: " codesign ",
		});

		expect(promisifiedExecFile).toHaveBeenCalledWith(
			"AzureSignTool",
			[
				"sign",
				"-kvu",
				"https://example.vault.azure.net/",
				"-kvc",
				"codesign",
				"-tr",
				"http://timestamp.digicert.com",
				"-v",
				"-kvm",
				"app.exe",
			],
			expect.objectContaining({ windowsHide: true }),
		);
		expect(log).toHaveBeenCalledWith("Signing file with AzureSignTool: app.exe");
		expect(log).toHaveBeenCalledWith("signed ok\n");
		expect(error).toHaveBeenCalledWith("warning: timestamp\n");
		log.mockRestore();
		error.mockRestore();
	});

	it("skips empty stdout and stderr from AzureSignTool", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		promisifiedExecFile.mockResolvedValue({ stdout: "   ", stderr: "" });

		await signWindowsFile("app.exe", {
			AZURE_KEY_VAULT_URI: "https://example.vault.azure.net/",
			AZURE_CERT_NAME: "codesign",
		});

		expect(log).toHaveBeenCalledTimes(1);
		expect(error).not.toHaveBeenCalled();
		log.mockRestore();
		error.mockRestore();
	});
});
