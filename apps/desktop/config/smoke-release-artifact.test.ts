import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	assertWindowsAuthenticodeSignature,
	findReleaseUpdateArtifact,
	windowsAuthenticodeCheck,
} from "./smoke-release-artifact.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
	);
});

async function temporaryMakeDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-release-smoke-"));
	temporaryDirectories.push(directory);
	return directory;
}

describe("release update artifact selection", () => {
	it("selects the macOS ZIP consumed by Squirrel.Mac", async () => {
		const makeDirectory = await temporaryMakeDirectory();
		const artifact = path.join(makeDirectory, "zip", "darwin", "arm64", "Kilo Preview.zip");
		await mkdir(path.dirname(artifact), { recursive: true });
		await writeFile(artifact, "zip");

		await expect(findReleaseUpdateArtifact(makeDirectory, "darwin")).resolves.toBe(artifact);
	});

	it("selects the full Windows NuGet package consumed by Squirrel", async () => {
		const makeDirectory = await temporaryMakeDirectory();
		const artifact = path.join(makeDirectory, "squirrel.windows", "x64", "Kilo-1.2.3-full.nupkg");
		await mkdir(path.dirname(artifact), { recursive: true });
		await Promise.all([
			writeFile(artifact, "full"),
			writeFile(path.join(path.dirname(artifact), "Kilo-1.2.3-delta.nupkg"), "delta"),
		]);

		await expect(findReleaseUpdateArtifact(makeDirectory, "win32")).resolves.toBe(artifact);
	});

	it("rejects a release without exactly one platform update payload", async () => {
		const makeDirectory = await temporaryMakeDirectory();

		await expect(findReleaseUpdateArtifact(makeDirectory, "darwin")).rejects.toThrow(
			"Expected exactly one macOS update ZIP",
		);
	});
});

describe("Windows Authenticode smoke check", () => {
	it("verifies signatures with PowerShell 7 instead of Windows PowerShell 5.1", () => {
		const check = windowsAuthenticodeCheck("C:\\Kilo Preview.exe");

		expect(check.file).toBe("pwsh");
		expect(check.env.KILO_RELEASE_SMOKE_EXECUTABLE).toBe("C:\\Kilo Preview.exe");
		expect(check.env.PSModulePath).toBeUndefined();
	});

	it("accepts a signature trusted by Windows", () => {
		expect(() =>
			assertWindowsAuthenticodeSignature({
				Status: "Valid",
				StatusMessage: "Signature verified.",
				SignerThumbprint: "0123456789ABCDEF",
			}),
		).not.toThrow();
	});

	it("accepts an intact signature from the configured internal PKI", () => {
		expect(() =>
			assertWindowsAuthenticodeSignature({
				Status: "UnknownError",
				StatusMessage:
					"A certificate chain processed, but terminated in a root certificate which is not trusted by the trust provider.",
				SignerThumbprint: "0123456789ABCDEF",
			}),
		).not.toThrow();
	});

	it.each([
		{ Status: "NotSigned", StatusMessage: "The file is not digitally signed." },
		{ Status: "HashMismatch", StatusMessage: "The contents have been altered." },
		{
			Status: "UnknownError",
			StatusMessage:
				"A certificate chain processed, but terminated in a root certificate which is not trusted by the trust provider.",
			SignerThumbprint: null,
		},
		{
			Status: "UnknownError",
			StatusMessage: "The revocation function was unable to check revocation.",
			SignerThumbprint: "0123456789ABCDEF",
		},
	])("rejects $Status: $StatusMessage", (signature) => {
		expect(() => assertWindowsAuthenticodeSignature(signature)).toThrow(
			`Invalid release executable signature: ${signature.Status}`,
		);
	});
});
