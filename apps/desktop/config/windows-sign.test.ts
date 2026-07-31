import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function temporaryNativeModule(contents: Uint8Array): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "anaconda-windows-sign-"));
	temporaryDirectories.push(directory);
	const filePath = path.join(directory, "native.node");
	await writeFile(filePath, contents);
	return filePath;
}

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

	it("skips native modules that are not Windows PE binaries", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const filePath = await temporaryNativeModule(new Uint8Array([0xcf, 0xfa, 0xed, 0xfe]));

		await signWindowsFile(filePath, {
			AZURE_KEY_VAULT_URI: "https://example.vault.azure.net/",
			AZURE_CERT_NAME: "codesign",
		});

		expect(promisifiedExecFile).not.toHaveBeenCalled();
		expect(log).toHaveBeenCalledWith(`Skipping non-Windows native module: ${filePath}`);
		log.mockRestore();
	});

	it("signs native modules that are Windows PE binaries", async () => {
		promisifiedExecFile.mockResolvedValue({ stdout: "", stderr: "" });
		const filePath = await temporaryNativeModule(new Uint8Array([0x4d, 0x5a, 0x00, 0x00]));

		await signWindowsFile(filePath, {
			AZURE_KEY_VAULT_URI: "https://example.vault.azure.net/",
			AZURE_CERT_NAME: "codesign",
		});

		expect(promisifiedExecFile).toHaveBeenCalledWith(
			"AzureSignTool",
			expect.arrayContaining([filePath]),
			expect.objectContaining({ windowsHide: true }),
		);
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
