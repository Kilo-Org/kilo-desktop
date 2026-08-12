// oxlint-disable no-explicit-any -- execa mocks require dynamic casts
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";
import type { FakeMainSdk } from "@anaconda-agentic-desktop/testing";

import { FEATURE_FLAG_KEY, mainRegister } from "./index.js";

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

/**
 * Build a linked SDK pair and (optionally) expose the shell-side
 * `feature-flag` capability with a caller-controlled return value. Mirrors
 * the harness in
 * `apps/desktop/src/main/features/anaconda-mcp/AnacondaMcpService.integration.test.ts`
 * so the flag-off path can be exercised.
 */
function createSdkWithFlag(options: {
	featureFlagEnabled: boolean | null;
	storageDir?: string;
	reportBootProgress?: (message: string) => void;
	fetch?: typeof globalThis.fetch;
}): { mainSdk: FakeMainSdk; getFlag: ReturnType<typeof vi.fn> } {
	const { mainSdk, createMainSdk } = createLinkedFakeSdkPair({
		featureId: "environments",
		main: {
			...(options.storageDir !== undefined ? { storageDir: options.storageDir } : {}),
			...(options.reportBootProgress !== undefined
				? { reportBootProgress: options.reportBootProgress }
				: {}),
			...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
		},
	});

	const getFlag = vi.fn(<T>(_key: string, defaultValue: T): T => {
		if (options.featureFlagEnabled === null) return defaultValue;
		return options.featureFlagEnabled as unknown as T;
	});

	if (options.featureFlagEnabled !== null) {
		const flagSdk = createMainSdk("feature-flag");
		flagSdk.plugins.expose("featureFlag", { getFlag });
	}

	return { mainSdk, getFlag };
}

describe("environments plugin main entry", () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const dir of directories.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	function setupFakeStaging(): { storageDir: string } {
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
		const { mainSdk } = createSdkWithFlag({ featureFlagEnabled: true, storageDir });
		const result = mainRegister(mainSdk);
		expect(result).toBeInstanceOf(Promise);
		await result;
	});

	it("boots the conda provider and writes staged.json on success", async () => {
		const { storageDir } = setupFakeStaging();
		const reportBootProgress = vi.fn();
		const { mainSdk } = createSdkWithFlag({
			featureFlagEnabled: true,
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
		const { mainSdk } = createSdkWithFlag({
			featureFlagEnabled: true,
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

		mockedDetectSystem.mockResolvedValue(null);
		const fetch = vi.fn().mockRejectedValue(new Error("offline"));
		const { mainSdk } = createSdkWithFlag({
			featureFlagEnabled: true,
			storageDir,
			fetch: fetch as unknown as typeof globalThis.fetch,
		});

		await expect(mainRegister(mainSdk)).rejects.toThrow("offline");
	});

	describe("feature-flag gate (environments-feature)", () => {
		it("skips provider boot and staging when the flag is off", async () => {
			const { storageDir } = setupFakeStaging();
			const { mainSdk, getFlag } = createSdkWithFlag({
				featureFlagEnabled: false,
				storageDir,
			});

			await mainRegister(mainSdk);

			expect(mockedDetectSystem).not.toHaveBeenCalled();
			expect(mockedGetInstaller).not.toHaveBeenCalled();
			expect(fs.existsSync(path.join(storageDir, "providers", "conda", "staged.json"))).toBe(false);
			expect(getFlag).toHaveBeenCalledWith(FEATURE_FLAG_KEY, false);
		});

		it("defaults to OFF when the feature-flag capability is unavailable", async () => {
			// Guards two paths at once: (1) when the shell hasn't registered
			// the `feature-flag` capability at all, and (2) when a plain
			// `createFakeMainSdk` is passed in with no capabilities. Both
			// resolve `plugins.get("feature-flag")` to `null`, and the gate
			// must default to OFF rather than fail open.
			const { storageDir } = setupFakeStaging();
			const { mainSdk } = createSdkWithFlag({ featureFlagEnabled: null, storageDir });

			await mainRegister(mainSdk);

			expect(mockedDetectSystem).not.toHaveBeenCalled();
			expect(fs.existsSync(path.join(storageDir, "providers", "conda", "staged.json"))).toBe(false);
		});
	});
});
