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

import {
	hasAzureWindowsSigningCredentials,
	hasExistingAuthenticodeSignature,
	signWindowsFile,
} from "./windows-sign.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function temporaryFile(name: string, contents: Uint8Array): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-windows-sign-"));
	temporaryDirectories.push(directory);
	const filePath = path.join(directory, name);
	await writeFile(filePath, contents);
	return filePath;
}

async function temporaryNativeModule(contents: Uint8Array): Promise<string> {
	return temporaryFile("native.node", contents);
}

/**
 * Builds a minimal PE32+ (x64) binary with an optional pre-populated
 * Certificate Table data-directory entry so we can test signature detection.
 */
function buildMinimalPE(options: { certSize?: number } = {}): Uint8Array {
	const { certSize = 0 } = options;

	// MZ header (64 bytes minimum, e_lfanew at 0x3C → 0x80)
	const peOffset = 0x80;
	const buf = Buffer.alloc(peOffset + 4 + 20 + 160); // PE sig + COFF + optional header room

	// DOS header
	buf.write("MZ", 0, "ascii");
	buf.writeUInt32LE(peOffset, 0x3c); // e_lfanew

	// PE signature
	buf.write("PE\0\0", peOffset, "ascii");

	// COFF header (20 bytes): Machine=AMD64, NumberOfSections=0, SizeOfOptionalHeader
	const coffStart = peOffset + 4;
	buf.writeUInt16LE(0x8664, coffStart); // Machine: AMD64
	buf.writeUInt16LE(160, coffStart + 16); // SizeOfOptionalHeader

	// Optional header: PE32+ magic
	const optStart = coffStart + 20;
	buf.writeUInt16LE(0x20b, optStart); // PE32+

	// Certificate Table entry at offset 144 from optional header start
	const certEntryOffset = optStart + 144;
	buf.writeUInt32LE(certSize > 0 ? 0x1000 : 0, certEntryOffset); // VirtualAddress
	buf.writeUInt32LE(certSize, certEntryOffset + 4); // Size

	return new Uint8Array(buf);
}

describe("hasExistingAuthenticodeSignature", () => {
	it("detects a signed PE binary", async () => {
		const filePath = await temporaryFile("signed.dll", buildMinimalPE({ certSize: 7408 }));
		expect(await hasExistingAuthenticodeSignature(filePath)).toBe(true);
	});

	it("returns false for an unsigned PE binary", async () => {
		const filePath = await temporaryFile("unsigned.dll", buildMinimalPE({ certSize: 0 }));
		expect(await hasExistingAuthenticodeSignature(filePath)).toBe(false);
	});

	it("returns false for a non-PE file", async () => {
		const filePath = await temporaryFile("not-pe.dll", new Uint8Array([0x7f, 0x45, 0x4c, 0x46]));
		expect(await hasExistingAuthenticodeSignature(filePath)).toBe(false);
	});

	it("returns false for a truncated file", async () => {
		const filePath = await temporaryFile("tiny.dll", new Uint8Array([0x4d, 0x5a]));
		expect(await hasExistingAuthenticodeSignature(filePath)).toBe(false);
	});
});

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

		const exe = await temporaryFile("app.exe", buildMinimalPE());
		await signWindowsFile(exe, {
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
				exe,
			],
			expect.objectContaining({ windowsHide: true }),
		);
		expect(log).toHaveBeenCalledWith(`Signing file with AzureSignTool: ${exe}`);
		expect(log).toHaveBeenCalledWith("signed ok\n");
		expect(error).toHaveBeenCalledWith("warning: timestamp\n");
		log.mockRestore();
		error.mockRestore();
	});

	it("includes AzureSignTool output in the error when signing fails", async () => {
		promisifiedExecFile.mockRejectedValue(
			Object.assign(new Error("Command failed: AzureSignTool sign"), {
				code: 1,
				stdout: "Signing file app.exe\n",
				stderr: "Forbidden: caller lacks keys/sign permission\n",
			}),
		);

		const exe = await temporaryFile("app.exe", buildMinimalPE());
		const signing = signWindowsFile(exe, {
			AZURE_KEY_VAULT_URI: "https://example.vault.azure.net/",
			AZURE_CERT_NAME: "codesign",
		});

		await expect(signing).rejects.toThrow(`AzureSignTool failed to sign ${exe} (exit code 1)`);
		await expect(signing).rejects.toThrow("Forbidden: caller lacks keys/sign permission");
		await expect(signing).rejects.toThrow("Signing file app.exe");
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

	it("skips already-signed DLLs", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const signedDll = await temporaryFile("tcl86t.dll", buildMinimalPE({ certSize: 7408 }));

		await signWindowsFile(signedDll, {
			AZURE_KEY_VAULT_URI: "https://example.vault.azure.net/",
			AZURE_CERT_NAME: "codesign",
		});

		expect(promisifiedExecFile).not.toHaveBeenCalled();
		expect(log).toHaveBeenCalledWith(`Skipping already-signed binary: ${signedDll}`);
		log.mockRestore();
	});

	it("signs unsigned DLLs", async () => {
		promisifiedExecFile.mockResolvedValue({ stdout: "", stderr: "" });
		const unsignedDll = await temporaryFile("libcrypto.dll", buildMinimalPE({ certSize: 0 }));

		await signWindowsFile(unsignedDll, {
			AZURE_KEY_VAULT_URI: "https://example.vault.azure.net/",
			AZURE_CERT_NAME: "codesign",
		});

		expect(promisifiedExecFile).toHaveBeenCalledWith(
			"AzureSignTool",
			expect.arrayContaining([unsignedDll]),
			expect.objectContaining({ windowsHide: true }),
		);
	});

	it("skips empty stdout and stderr from AzureSignTool", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		promisifiedExecFile.mockResolvedValue({ stdout: "   ", stderr: "" });

		const exe = await temporaryFile("app.exe", buildMinimalPE());
		await signWindowsFile(exe, {
			AZURE_KEY_VAULT_URI: "https://example.vault.azure.net/",
			AZURE_CERT_NAME: "codesign",
		});

		expect(log).toHaveBeenCalledTimes(1);
		expect(error).not.toHaveBeenCalled();
		log.mockRestore();
		error.mockRestore();
	});
});
