// oxlint-disable no-explicit-any -- execa mocks require dynamic casts
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeMainSdk } from "@anaconda-agentic-desktop/testing";

import { mainRegister } from "./index.js";

vi.mock("execa", () => ({
	execa: vi.fn(),
}));

vi.mock("./providers/conda/staging/artifacts.js", () => ({
	getMinicondaInstaller: vi.fn(),
}));

import { execa } from "execa";
import { getMinicondaInstaller } from "./providers/conda/staging/artifacts.js";

const mockedExeca = vi.mocked(execa);
const mockedGetInstaller = vi.mocked(getMinicondaInstaller);

function fakeInstallerContent(): Buffer {
	return Buffer.from("#!/bin/bash\necho installing\n");
}

function sha256(buf: Buffer): string {
	return createHash("sha256").update(buf).digest("hex");
}

function createFakeResponse(body: Buffer): Response {
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(new Uint8Array(body));
			controller.close();
		},
	});
	return new Response(stream, { status: 200, statusText: "OK" });
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

		const installerContent = fakeInstallerContent();
		const installerSha256 = sha256(installerContent);
		const fetch = vi.fn().mockResolvedValue(createFakeResponse(installerContent));

		mockedGetInstaller.mockReturnValue({
			target: "darwin-arm64",
			platform: "darwin",
			arch: "arm64",
			installerUrl: "https://repo.anaconda.com/miniconda/Miniconda3-test.sh",
			installerSha256,
			condaBinRelPath: "bin/conda",
		});

		mockedExeca.mockImplementation(((_cmd: string, args: string[]) => {
			const pIdx = args.indexOf("-p");
			const prefix = pIdx >= 0 ? args[pIdx + 1] : undefined;
			if (prefix) {
				const condaBin = path.join(prefix, "bin", "conda");
				fs.mkdirSync(path.dirname(condaBin), { recursive: true });
				fs.writeFileSync(condaBin, "#!/bin/bash\n", { mode: 0o755 });
			}
			const fakeProcess = Promise.resolve({ exitCode: 0 }) as any;
			fakeProcess.all = new Readable({
				read() {
					this.push(null);
				},
			});
			return fakeProcess;
		}) as any);

		return { storageDir, fetch, installerSha256 };
	}

	it("returns a Promise (async mainRegister for provider boot)", async () => {
		const { storageDir, fetch } = setupFakeStaging();
		const mainSdk = createFakeMainSdk({
			featureId: "environments",
			storageDir,
			fetch: fetch as unknown as typeof globalThis.fetch,
		});
		const result = mainRegister(mainSdk);
		expect(result).toBeInstanceOf(Promise);
		await result;
	});

	it("boots the conda provider and writes staged.json on success", async () => {
		const { storageDir, fetch, installerSha256 } = setupFakeStaging();
		const reportBootProgress = vi.fn();
		const mainSdk = createFakeMainSdk({
			featureId: "environments",
			storageDir,
			fetch: fetch as unknown as typeof globalThis.fetch,
			reportBootProgress,
		});

		await mainRegister(mainSdk);

		const manifest = JSON.parse(
			fs.readFileSync(path.join(storageDir, "providers", "conda", "staged.json"), "utf8"),
		);
		expect(manifest.installerSha256).toBe(installerSha256);
		expect(manifest.target).toBe("darwin-arm64");
	});

	it("delivers boot progress messages during staging", async () => {
		const { storageDir, fetch } = setupFakeStaging();
		const reportBootProgress = vi.fn();
		const mainSdk = createFakeMainSdk({
			featureId: "environments",
			storageDir,
			fetch: fetch as unknown as typeof globalThis.fetch,
			reportBootProgress,
		});

		await mainRegister(mainSdk);

		const messages = reportBootProgress.mock.calls.map((call: unknown[]) => call[0] as string);
		expect(messages).toContain("Downloading Miniconda installer\u2026");
		expect(messages).toContain("Installing Miniconda\u2026");
		expect(messages).toContain("Conda base ready.");
	});

	it("propagates boot failures (staging errors)", async () => {
		const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "env-main-fail-"));
		directories.push(storageDir);

		const installerSha256 = sha256(fakeInstallerContent());
		mockedGetInstaller.mockReturnValue({
			target: "darwin-arm64",
			platform: "darwin",
			arch: "arm64",
			installerUrl: "https://repo.anaconda.com/miniconda/Miniconda3-test.sh",
			installerSha256,
			condaBinRelPath: "bin/conda",
		});

		const fetch = vi.fn().mockRejectedValue(new Error("offline"));
		const mainSdk = createFakeMainSdk({
			featureId: "environments",
			storageDir,
			fetch: fetch as unknown as typeof globalThis.fetch,
		});

		await expect(mainRegister(mainSdk)).rejects.toThrow("offline");
	});
});
