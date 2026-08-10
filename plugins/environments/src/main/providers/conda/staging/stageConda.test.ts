// oxlint-disable no-explicit-any -- execa mocks require dynamic casts
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StagingError } from "./errors.js";
import type { MinicondaInstallerArtifact } from "./artifacts.js";
import { stageConda, type StagingContext } from "./stageConda.js";

vi.mock("execa", () => ({
	execa: vi.fn(),
}));

vi.mock("./artifacts.js", () => ({
	getMinicondaInstaller: vi.fn(),
}));

import { execa } from "execa";
import { getMinicondaInstaller } from "./artifacts.js";

const mockedExeca = vi.mocked(execa);
const mockedGetInstaller = vi.mocked(getMinicondaInstaller);

function fakeInstallerContent(): Buffer {
	return Buffer.from("#!/bin/bash\necho 'installing'\n");
}

function sha256(buf: Buffer): string {
	return createHash("sha256").update(buf).digest("hex");
}

function createFakeResponse(body: Buffer, status = 200): Response {
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(new Uint8Array(body));
			controller.close();
		},
	});
	return new Response(stream, {
		status,
		statusText: status === 200 ? "OK" : "Not Found",
	});
}

interface TestHarness {
	storageDir: string;
	ctx: StagingContext;
	fetch: ReturnType<typeof vi.fn>;
	reportProgress: ReturnType<typeof vi.fn>;
	installerContent: Buffer;
	installerSha256: string;
}

function createHarness(overrides?: Partial<StagingContext>): TestHarness {
	const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-conda-test-"));
	const fetch = vi.fn();
	const reportProgress = vi.fn();
	const installerContent = fakeInstallerContent();
	const installerSha256 = sha256(installerContent);

	const platform = overrides?.platform ?? "darwin";
	const arch = overrides?.arch ?? "arm64";
	const isWindows = platform === "win32";

	const fakeArtifact: MinicondaInstallerArtifact = {
		target: isWindows ? "win32-x64" : "darwin-arm64",
		platform: platform as NodeJS.Platform,
		arch: arch as NodeJS.Architecture,
		installerUrl: `https://repo.anaconda.com/miniconda/Miniconda3-test-${platform}.${isWindows ? "exe" : "sh"}`,
		installerSha256,
		condaBinRelPath: isWindows ? "Scripts\\conda.exe" : "bin/conda",
	};
	mockedGetInstaller.mockReturnValue(fakeArtifact);

	const ctx: StagingContext = {
		storageDir,
		fetch: fetch as unknown as typeof globalThis.fetch,
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		reportProgress,
		platform: platform as NodeJS.Platform,
		arch: arch as NodeJS.Architecture,
		...overrides,
	};

	return { storageDir, ctx, fetch, reportProgress, installerContent, installerSha256 };
}

describe("stageConda", () => {
	const directories: string[] = [];

	beforeEach(() => {
		mockedExeca.mockReset();
		mockedGetInstaller.mockReset();
	});

	afterEach(() => {
		for (const dir of directories.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	function track(harness: TestHarness): TestHarness {
		directories.push(harness.storageDir);
		return harness;
	}

	function mockExecaCreatingBinary(_harness: TestHarness): void {
		mockedExeca.mockImplementation(((_cmd: string, args: string[]) => {
			// Find the prefix from args: for macOS/Linux, it's after "-p"
			const pIdx = args.indexOf("-p");
			const prefix = pIdx >= 0 ? args[pIdx + 1] : args[args.length - 1]?.replace("/D=", "");
			if (prefix) {
				const condaBin = path.join(prefix, "bin", "conda");
				fs.mkdirSync(path.dirname(condaBin), { recursive: true });
				fs.writeFileSync(condaBin, "#!/bin/bash\n");
				fs.chmodSync(condaBin, 0o755);
			}
			const fakeProcess = Promise.resolve({ exitCode: 0 }) as any;
			fakeProcess.all = new Readable({
				read() {
					this.push(null);
				},
			});
			return fakeProcess;
		}) as any);
	}

	it("downloads installer, verifies SHA, installs, and writes staged.json", async () => {
		const harness = track(createHarness());
		harness.fetch.mockResolvedValue(createFakeResponse(harness.installerContent));
		mockExecaCreatingBinary(harness);

		await stageConda(harness.ctx);

		// Verify staged.json was written
		const manifest = JSON.parse(
			fs.readFileSync(path.join(harness.storageDir, "providers", "conda", "staged.json"), "utf8"),
		);
		expect(manifest.installerSha256).toBe(harness.installerSha256);
		expect(manifest.target).toBe("darwin-arm64");

		// Verify installer was called
		expect(mockedExeca).toHaveBeenCalledOnce();
		const call = mockedExeca.mock.calls[0] as unknown as [string, string[]];
		const [cmd, args] = call;
		expect(cmd).toBe("bash");
		expect(args[0]).toContain(harness.installerSha256);
		expect(args).toContain("-b");
		expect(args).toContain("-p");
	});

	it("short-circuits when staged.json matches and binary exists", async () => {
		const harness = track(createHarness());

		// Pre-stage: write staged.json and the binary
		const condaRoot = path.join(harness.storageDir, "providers", "conda");
		const prefix = path.join(condaRoot, "prefix");
		const binDir = path.join(prefix, "bin");
		fs.mkdirSync(binDir, { recursive: true });
		fs.writeFileSync(path.join(binDir, "conda"), "#!/bin/bash\n", { mode: 0o755 });
		fs.writeFileSync(
			path.join(condaRoot, "staged.json"),
			JSON.stringify({ installerSha256: harness.installerSha256, target: "darwin-arm64" }),
		);

		await stageConda(harness.ctx);

		expect(harness.fetch).not.toHaveBeenCalled();
		expect(mockedExeca).not.toHaveBeenCalled();
	});

	it("re-stages when staged.json has different SHA", async () => {
		const harness = track(createHarness());

		// Pre-stage with a different SHA
		const condaRoot = path.join(harness.storageDir, "providers", "conda");
		const prefix = path.join(condaRoot, "prefix");
		const binDir = path.join(prefix, "bin");
		fs.mkdirSync(binDir, { recursive: true });
		fs.writeFileSync(path.join(binDir, "conda"), "#!/bin/bash\n", { mode: 0o755 });
		fs.writeFileSync(
			path.join(condaRoot, "staged.json"),
			JSON.stringify({ installerSha256: "stale-sha", target: "darwin-arm64" }),
		);

		harness.fetch.mockResolvedValue(createFakeResponse(harness.installerContent));
		mockExecaCreatingBinary(harness);

		await stageConda(harness.ctx);

		expect(harness.fetch).toHaveBeenCalledOnce();
		expect(mockedExeca).toHaveBeenCalledOnce();
	});

	it("throws INSTALLER_DOWNLOAD_FAILED on network error", async () => {
		const harness = track(createHarness());
		harness.fetch.mockRejectedValue(new Error("ENOTFOUND"));

		const error = await stageConda(harness.ctx).catch((e) => e);
		expect(error).toBeInstanceOf(StagingError);
		expect(error.code).toBe("INSTALLER_DOWNLOAD_FAILED");
	});

	it("throws INSTALLER_DOWNLOAD_FAILED on non-2xx status", async () => {
		const harness = track(createHarness());
		harness.fetch.mockResolvedValue(createFakeResponse(Buffer.from(""), 404));

		await expect(stageConda(harness.ctx)).rejects.toMatchObject({
			code: "INSTALLER_DOWNLOAD_FAILED",
		});
	});

	it("throws INSTALLER_SHA_MISMATCH on tampered installer", async () => {
		const harness = track(createHarness());
		// Return content that doesn't match the expected SHA
		harness.fetch.mockResolvedValue(createFakeResponse(Buffer.from("tampered content")));

		await expect(stageConda(harness.ctx)).rejects.toMatchObject({
			code: "INSTALLER_SHA_MISMATCH",
		});
	});

	it("throws STAGING_FAILED when installer exits non-zero", async () => {
		const harness = track(createHarness());
		harness.fetch.mockResolvedValue(createFakeResponse(harness.installerContent));

		mockedExeca.mockImplementation((() => {
			const error = new Error("Command failed with exit code 1");
			return Promise.reject(error);
		}) as any);

		await expect(stageConda(harness.ctx)).rejects.toMatchObject({
			code: "STAGING_FAILED",
		});
	});

	it("throws STAGING_FAILED when conda binary is missing after install", async () => {
		const harness = track(createHarness());
		harness.fetch.mockResolvedValue(createFakeResponse(harness.installerContent));

		// execa succeeds but doesn't create the conda binary
		mockedExeca.mockImplementation((() => {
			const fakeProcess = Promise.resolve({ exitCode: 0 }) as any;
			fakeProcess.all = new Readable({
				read() {
					this.push(null);
				},
			});
			return fakeProcess;
		}) as any);

		await expect(stageConda(harness.ctx)).rejects.toMatchObject({
			code: "STAGING_FAILED",
		});
	});

	it("uses cached installer on subsequent calls", async () => {
		const harness = track(createHarness());
		harness.fetch.mockResolvedValue(createFakeResponse(harness.installerContent));
		mockExecaCreatingBinary(harness);

		// First run: downloads and installs
		await stageConda(harness.ctx);
		expect(harness.fetch).toHaveBeenCalledOnce();

		// Remove staged.json to force re-stage but keep the cache
		fs.unlinkSync(path.join(harness.storageDir, "providers", "conda", "staged.json"));
		harness.fetch.mockClear();
		mockedExeca.mockClear();
		mockExecaCreatingBinary(harness);

		// Second run: should use cached installer (no fetch)
		await stageConda(harness.ctx);
		expect(harness.fetch).not.toHaveBeenCalled();
		expect(mockedExeca).toHaveBeenCalledOnce();
	});

	it("reports progress in the expected order", async () => {
		const harness = track(createHarness());
		harness.fetch.mockResolvedValue(createFakeResponse(harness.installerContent));
		mockExecaCreatingBinary(harness);

		await stageConda(harness.ctx);

		const messages = harness.reportProgress.mock.calls.map((call: unknown[]) => call[0] as string);
		expect(messages[0]).toBe("Downloading Miniconda installer\u2026");
		expect(messages[1]).toBe("Installing Miniconda\u2026");
		expect(messages[messages.length - 1]).toBe("Conda base ready.");
	});

	it("uses Windows installer flags when platform is win32", async () => {
		const installerContent = fakeInstallerContent();
		const installerSha256 = sha256(installerContent);
		const harness = track(createHarness({ platform: "win32", arch: "x64" }));
		harness.fetch.mockResolvedValue(createFakeResponse(installerContent));

		mockedExeca.mockImplementation(((_cmd: string, args: string[]) => {
			// Find prefix from /D= arg
			const dArg = args.find((a) => a.startsWith("/D="));
			const prefix = dArg?.replace("/D=", "");
			if (prefix) {
				// Create the binary at the normalized path stageConda expects
				const condaBin = path.join(prefix, "Scripts", "conda.exe");
				fs.mkdirSync(path.dirname(condaBin), { recursive: true });
				fs.writeFileSync(condaBin, "fake exe");
			}
			const fakeProcess = Promise.resolve({ exitCode: 0 }) as any;
			fakeProcess.all = new Readable({
				read() {
					this.push(null);
				},
			});
			return fakeProcess;
		}) as any);

		await stageConda(harness.ctx);

		const call = mockedExeca.mock.calls[0] as unknown as [string, string[]];
		const [cmd, args] = call;
		expect(cmd).toContain(installerSha256);
		expect(args).toContain("/S");
		expect(args).toContain("/InstallationType=JustMe");
		expect(args).toContain("/RegisterPython=0");
		expect(args).toContain("/AddToPath=0");
		expect(args.some((a: string) => a.startsWith("/D="))).toBe(true);
	});
});
