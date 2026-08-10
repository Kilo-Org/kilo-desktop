// oxlint-disable no-explicit-any -- execa mocks require dynamic casts
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeMainSdk } from "@anaconda-agentic-desktop/testing";

import { mainRegister } from "./index.js";

vi.mock("execa", () => ({
	execa: vi.fn(),
}));

vi.mock("./providers/conda/staging/artifacts.js", () => ({
	getMinicondaInstaller: vi.fn(),
}));

vi.mock("./providers/conda/staging/detectSystemConda.js", () => ({
	detectSystemConda: vi.fn(),
}));

import { getMinicondaInstaller } from "./providers/conda/staging/artifacts.js";
import { detectSystemConda } from "./providers/conda/staging/detectSystemConda.js";

const mockedGetInstaller = vi.mocked(getMinicondaInstaller);
const mockedDetectSystem = vi.mocked(detectSystemConda);

function sha256(buf: Buffer): string {
	return createHash("sha256").update(buf).digest("hex");
}

describe("environments plugin main entry", () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const dir of directories.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	function setupFakeStaging() {
		const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "env-main-test-"));
		directories.push(storageDir);

		mockedGetInstaller.mockReturnValue({
			target: "darwin-arm64",
			platform: "darwin",
			arch: "arm64",
			installerUrl: "https://repo.anaconda.com/miniconda/Miniconda3-test.sh",
			installerSha256: sha256(Buffer.from("fake")),
			condaBinRelPath: "bin/conda",
		});

		// Default: system conda detected (avoids bundled path touching real $HOME)
		mockedDetectSystem.mockResolvedValue({
			condaBinPath: "/usr/local/bin/conda",
			version: "25.3.1",
		});

		return { storageDir };
	}

	it("returns a Promise (async mainRegister for provider boot)", async () => {
		const { storageDir } = setupFakeStaging();
		const mainSdk = createFakeMainSdk({
			featureId: "environments",
			storageDir,
		});
		const result = mainRegister(mainSdk);
		expect(result).toBeInstanceOf(Promise);
		await result;
	});

	it("boots the conda provider and writes staged.json on success", async () => {
		const { storageDir } = setupFakeStaging();
		const reportBootProgress = vi.fn();
		const mainSdk = createFakeMainSdk({
			featureId: "environments",
			storageDir,
			reportBootProgress,
		});

		await mainRegister(mainSdk);

		const manifest = JSON.parse(
			fs.readFileSync(path.join(storageDir, "providers", "conda", "staged.json"), "utf8"),
		);
		expect(manifest.type).toBe("system");
		expect(manifest.condaBinPath).toBe("/usr/local/bin/conda");
		expect(manifest.target).toBe("darwin-arm64");
	});

	it("delivers boot progress messages during staging", async () => {
		const { storageDir } = setupFakeStaging();
		const reportBootProgress = vi.fn();
		const mainSdk = createFakeMainSdk({
			featureId: "environments",
			storageDir,
			reportBootProgress,
		});

		await mainRegister(mainSdk);

		const messages = reportBootProgress.mock.calls.map((call: unknown[]) => call[0] as string);
		expect(messages).toContain("[1/3] Checking for existing conda\u2026");
		expect(messages).toContain("Using existing conda installation.");
	});

	it("propagates boot failures (staging errors)", async () => {
		const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "env-main-fail-"));
		directories.push(storageDir);

		mockedGetInstaller.mockReturnValue({
			target: "darwin-arm64",
			platform: "darwin",
			arch: "arm64",
			installerUrl: "https://repo.anaconda.com/miniconda/Miniconda3-test.sh",
			installerSha256: sha256(Buffer.from("fake")),
			condaBinRelPath: "bin/conda",
		});

		// No system conda, and fetch fails
		mockedDetectSystem.mockResolvedValue(null);
		const fetch = vi.fn().mockRejectedValue(new Error("offline"));
		const mainSdk = createFakeMainSdk({
			featureId: "environments",
			storageDir,
			fetch: fetch as unknown as typeof globalThis.fetch,
		});

		await expect(mainRegister(mainSdk)).rejects.toThrow("offline");
	});
});
