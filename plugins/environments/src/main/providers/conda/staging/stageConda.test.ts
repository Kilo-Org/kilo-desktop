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

vi.mock("./detectSystemConda.js", () => ({
	detectSystemConda: vi.fn(),
}));

import { execa } from "execa";
import { getMinicondaInstaller } from "./artifacts.js";
import { detectSystemConda } from "./detectSystemConda.js";

const mockedExeca = vi.mocked(execa);
const mockedGetInstaller = vi.mocked(getMinicondaInstaller);
const mockedDetectSystem = vi.mocked(detectSystemConda);

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
		condaFilesRoot: storageDir,
		...overrides,
	};

	return { storageDir, ctx, fetch, reportProgress, installerContent, installerSha256 };
}

describe("stageConda", () => {
	const directories: string[] = [];

	beforeEach(() => {
		mockedExeca.mockReset();
		mockedGetInstaller.mockReset();
		mockedDetectSystem.mockReset();
		// Default: no system conda detected
		mockedDetectSystem.mockResolvedValue(null);
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

	function mockExecaWithInstallerOutput(_harness: TestHarness): void {
		mockedExeca.mockImplementation(((_cmd: string, args: string[]) => {
			const pIdx = args.indexOf("-p");
			const prefix = pIdx >= 0 ? args[pIdx + 1] : args[args.length - 1]?.replace("/D=", "");
			if (prefix) {
				const condaBin = path.join(prefix, "bin", "conda");
				fs.mkdirSync(path.dirname(condaBin), { recursive: true });
				fs.writeFileSync(condaBin, "#!/bin/bash\n");
				fs.chmodSync(condaBin, 0o755);
			}
			const fakeProcess = Promise.resolve({ exitCode: 0 }) as any;
			// Emit realistic installer output lines
			const output = [
				"PREFIX=/tmp/staging\n",
				"Unpacking bootstrapper...\n",
				"Unpacking payload...\n",
				"Installing base environment...\n",
				"Preparing transaction: ...working...\n",
				"done\n",
				"Executing transaction: ...working...\n",
				"done\n",
				"installation finished.\n",
			].join("");
			fakeProcess.all = new Readable({
				read() {
					this.push(Buffer.from(output));
					this.push(null);
				},
			});
			return fakeProcess;
		}) as any);
	}

	// ─── System conda detection ──────────────────────────────────────────

	it("uses system conda when detected and skips download", async () => {
		const harness = track(createHarness());
		mockedDetectSystem.mockResolvedValue({
			condaBinPath: "/usr/local/bin/conda",
			version: "25.3.1",
		});

		const result = await stageConda(harness.ctx);

		expect(result).toEqual({
			condaBinPath: "/usr/local/bin/conda",
			strategy: "system",
			condaFilesRoot: harness.storageDir,
		});
		expect(harness.fetch).not.toHaveBeenCalled();
		expect(mockedExeca).not.toHaveBeenCalled();

		// Verify manifest was written as system type
		const manifest = JSON.parse(
			fs.readFileSync(path.join(harness.storageDir, "providers", "conda", "staged.json"), "utf8"),
		);
		expect(manifest.type).toBe("system");
		expect(manifest.condaBinPath).toBe("/usr/local/bin/conda");
		expect(manifest.condaVersion).toBe("25.3.1");
	});

	it("short-circuits on existing system manifest when binary is accessible", async () => {
		const harness = track(createHarness());
		// Pre-write a system manifest
		const condaRoot = path.join(harness.storageDir, "providers", "conda");
		fs.mkdirSync(condaRoot, { recursive: true });
		// Create a fake conda binary at a known path
		const fakeBin = path.join(harness.storageDir, "fake-conda");
		fs.writeFileSync(fakeBin, "#!/bin/bash\n", { mode: 0o755 });
		fs.writeFileSync(
			path.join(condaRoot, "staged.json"),
			JSON.stringify({
				type: "system",
				condaBinPath: fakeBin,
				condaVersion: "25.1.0",
				target: "darwin-arm64",
			}),
		);

		const result = await stageConda(harness.ctx);

		expect(result).toEqual({
			condaBinPath: fakeBin,
			strategy: "system",
			condaFilesRoot: harness.storageDir,
		});
		expect(mockedDetectSystem).not.toHaveBeenCalled();
		expect(harness.fetch).not.toHaveBeenCalled();
	});

	it("re-detects when system conda binary is no longer accessible", async () => {
		const harness = track(createHarness());
		// Pre-write a system manifest pointing to a non-existent binary
		const condaRoot = path.join(harness.storageDir, "providers", "conda");
		fs.mkdirSync(condaRoot, { recursive: true });
		fs.writeFileSync(
			path.join(condaRoot, "staged.json"),
			JSON.stringify({
				type: "system",
				condaBinPath: "/gone/conda",
				condaVersion: "25.0.0",
				target: "darwin-arm64",
			}),
		);

		// Detection finds a new system conda
		mockedDetectSystem.mockResolvedValue({
			condaBinPath: "/new/path/conda",
			version: "25.5.0",
		});

		const result = await stageConda(harness.ctx);

		expect(result).toEqual({
			condaBinPath: "/new/path/conda",
			strategy: "system",
			condaFilesRoot: harness.storageDir,
		});
		expect(mockedDetectSystem).toHaveBeenCalledOnce();
	});

	it("falls back to bundled install when no system conda detected", async () => {
		const harness = track(createHarness());
		mockedDetectSystem.mockResolvedValue(null);
		harness.fetch.mockResolvedValue(createFakeResponse(harness.installerContent));
		mockExecaCreatingBinary(harness);

		const result = await stageConda(harness.ctx);

		expect(result.strategy).toBe("bundled");
		expect(result.condaBinPath).toContain("prefix");
		expect(harness.fetch).toHaveBeenCalledOnce();
		expect(mockedExeca).toHaveBeenCalledOnce();

		// Verify manifest written as bundled
		const manifest = JSON.parse(
			fs.readFileSync(path.join(harness.storageDir, "providers", "conda", "staged.json"), "utf8"),
		);
		expect(manifest.type).toBe("bundled");
		expect(manifest.installerSha256).toBe(harness.installerSha256);
	});

	it("ANACONDA_FORCE_BUNDLED_CONDA=1 skips idempotency and system detection", async () => {
		const harness = track(createHarness());

		// Pre-write a system manifest that would normally short-circuit
		const manifestDir = path.join(harness.storageDir, "providers", "conda");
		fs.mkdirSync(manifestDir, { recursive: true });
		const fakeBin = path.join(harness.storageDir, "fake-conda");
		fs.writeFileSync(fakeBin, "#!/bin/bash\n", { mode: 0o755 });
		fs.writeFileSync(
			path.join(manifestDir, "staged.json"),
			JSON.stringify({
				type: "system",
				condaBinPath: fakeBin,
				condaVersion: "25.0.0",
				target: "darwin-arm64",
			}),
		);

		// Force bundled — should ignore manifest and skip detection
		const originalEnv = process.env.ANACONDA_FORCE_BUNDLED_CONDA;
		process.env.ANACONDA_FORCE_BUNDLED_CONDA = "1";
		try {
			harness.fetch.mockResolvedValue(createFakeResponse(harness.installerContent));
			mockExecaCreatingBinary(harness);

			const result = await stageConda(harness.ctx);

			expect(result.strategy).toBe("bundled");
			expect(mockedDetectSystem).not.toHaveBeenCalled();
			expect(harness.fetch).toHaveBeenCalledOnce();
		} finally {
			if (originalEnv === undefined) delete process.env.ANACONDA_FORCE_BUNDLED_CONDA;
			else process.env.ANACONDA_FORCE_BUNDLED_CONDA = originalEnv;
		}
	});

	it("ANACONDA_SKIP_CONDA_STAGING=1 returns strategy 'skipped' with empty path", async () => {
		const harness = track(createHarness());
		const originalEnv = process.env.ANACONDA_SKIP_CONDA_STAGING;
		process.env.ANACONDA_SKIP_CONDA_STAGING = "1";
		try {
			const result = await stageConda(harness.ctx);

			expect(result).toEqual({
				condaBinPath: "",
				strategy: "skipped",
				condaFilesRoot: harness.storageDir,
			});
			expect(mockedDetectSystem).not.toHaveBeenCalled();
			expect(harness.fetch).not.toHaveBeenCalled();
			expect(mockedExeca).not.toHaveBeenCalled();
		} finally {
			if (originalEnv === undefined) delete process.env.ANACONDA_SKIP_CONDA_STAGING;
			else process.env.ANACONDA_SKIP_CONDA_STAGING = originalEnv;
		}
	});

	// ─── Bundled install path ────────────────────────────────────────────

	it("downloads installer, verifies SHA, installs, and writes staged.json", async () => {
		const harness = track(createHarness());
		harness.fetch.mockResolvedValue(createFakeResponse(harness.installerContent));
		mockExecaCreatingBinary(harness);

		const result = await stageConda(harness.ctx);

		expect(result.strategy).toBe("bundled");
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

	it("short-circuits when bundled staged.json matches and binary exists", async () => {
		const harness = track(createHarness());

		// Pre-stage: write staged.json in storageDir and binary in condaFilesRoot
		const manifestDir = path.join(harness.storageDir, "providers", "conda");
		fs.mkdirSync(manifestDir, { recursive: true });
		const prefix = path.join(harness.storageDir, "prefix");
		const binDir = path.join(prefix, "bin");
		fs.mkdirSync(binDir, { recursive: true });
		fs.writeFileSync(path.join(binDir, "conda"), "#!/bin/bash\n", { mode: 0o755 });
		fs.writeFileSync(
			path.join(manifestDir, "staged.json"),
			JSON.stringify({
				type: "bundled",
				installerSha256: harness.installerSha256,
				target: "darwin-arm64",
			}),
		);

		const result = await stageConda(harness.ctx);

		expect(result.strategy).toBe("bundled");
		expect(harness.fetch).not.toHaveBeenCalled();
		expect(mockedExeca).not.toHaveBeenCalled();
		expect(mockedDetectSystem).not.toHaveBeenCalled();
	});

	it("re-stages when bundled staged.json has different SHA", async () => {
		const harness = track(createHarness());

		// Pre-stage with a different SHA
		const manifestDir = path.join(harness.storageDir, "providers", "conda");
		fs.mkdirSync(manifestDir, { recursive: true });
		const prefix = path.join(harness.storageDir, "prefix");
		const binDir = path.join(prefix, "bin");
		fs.mkdirSync(binDir, { recursive: true });
		fs.writeFileSync(path.join(binDir, "conda"), "#!/bin/bash\n", { mode: 0o755 });
		fs.writeFileSync(
			path.join(manifestDir, "staged.json"),
			JSON.stringify({ type: "bundled", installerSha256: "stale-sha", target: "darwin-arm64" }),
		);

		// System detection returns null
		mockedDetectSystem.mockResolvedValue(null);
		harness.fetch.mockResolvedValue(createFakeResponse(harness.installerContent));
		mockExecaCreatingBinary(harness);

		const result = await stageConda(harness.ctx);

		expect(result.strategy).toBe("bundled");
		expect(harness.fetch).toHaveBeenCalledOnce();
		expect(mockedExeca).toHaveBeenCalledOnce();
	});

	// ─── Error cases ─────────────────────────────────────────────────────

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
		harness.fetch.mockResolvedValue(createFakeResponse(Buffer.from("tampered content")));

		await expect(stageConda(harness.ctx)).rejects.toMatchObject({
			code: "INSTALLER_SHA_MISMATCH",
		});
	});

	it("throws STAGING_FAILED when installer exits non-zero", async () => {
		const harness = track(createHarness());
		harness.fetch.mockResolvedValue(createFakeResponse(harness.installerContent));

		mockedExeca.mockImplementation((() => {
			return Promise.reject(new Error("Command failed with exit code 1"));
		}) as any);

		await expect(stageConda(harness.ctx)).rejects.toMatchObject({
			code: "STAGING_FAILED",
		});
	});

	it("throws STAGING_FAILED when conda binary is missing after install", async () => {
		const harness = track(createHarness());
		harness.fetch.mockResolvedValue(createFakeResponse(harness.installerContent));

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

	// ─── Cache + progress ────────────────────────────────────────────────

	it("uses cached installer on subsequent calls", async () => {
		const harness = track(createHarness());
		harness.fetch.mockResolvedValue(createFakeResponse(harness.installerContent));
		mockExecaCreatingBinary(harness);

		await stageConda(harness.ctx);
		expect(harness.fetch).toHaveBeenCalledOnce();

		// Remove staged.json to force re-stage but keep the cache
		fs.unlinkSync(path.join(harness.storageDir, "providers", "conda", "staged.json"));
		harness.fetch.mockClear();
		mockedExeca.mockClear();
		mockedDetectSystem.mockResolvedValue(null);
		mockExecaCreatingBinary(harness);

		await stageConda(harness.ctx);
		expect(harness.fetch).not.toHaveBeenCalled();
		expect(mockedExeca).toHaveBeenCalledOnce();
	});

	it("reports progress in the expected order for bundled install", async () => {
		const harness = track(createHarness());
		harness.fetch.mockResolvedValue(createFakeResponse(harness.installerContent));
		mockExecaWithInstallerOutput(harness);

		await stageConda(harness.ctx);

		const messages = harness.reportProgress.mock.calls.map((call: unknown[]) => call[0] as string);
		expect(messages[0]).toBe("[1/3] Checking for existing conda\u2026");
		expect(messages).toContain("[1/3] Downloading Miniconda\u2026");
		expect(messages).toContain("[2/3] Installing Miniconda\u2026");
		expect(messages).toContain("[2/3] Unpacking Miniconda\u2026");
		expect(messages).toContain("[2/3] Installing packages\u2026");
		expect(messages).toContain("[2/3] Preparing environment\u2026");
		expect(messages).toContain("[2/3] Finalizing installation\u2026");
		expect(messages).toContain("[3/3] Finalizing\u2026");
		expect(messages[messages.length - 1]).toBe("Conda base ready.");
	});

	it("uses Windows installer flags when platform is win32", async () => {
		const installerContent = fakeInstallerContent();
		const installerSha256 = sha256(installerContent);
		const harness = track(createHarness({ platform: "win32", arch: "x64" }));
		harness.fetch.mockResolvedValue(createFakeResponse(installerContent));

		mockedExeca.mockImplementation(((_cmd: string, args: string[]) => {
			const dArg = args.find((a) => a.startsWith("/D="));
			const prefix = dArg?.replace("/D=", "");
			if (prefix) {
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
