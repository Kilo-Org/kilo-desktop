import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { MainSdkLogger } from "@anaconda-agentic-desktop/feature-sdk/main";

import { CondaRuntime } from "./CondaRuntime.js";

const logger: MainSdkLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
};

function staging() {
	return {
		condaBinPath: "/opt/conda/bin/conda",
		condaFilesRoot: "/tmp/anaconda-conda",
		strategy: "system" as const,
	};
}

describe("CondaRuntime", () => {
	it("does not stage conda until an environment is requested", () => {
		const stage = vi.fn().mockResolvedValue(staging());
		const runtime = new CondaRuntime({
			stage,
			logger,
			execute: vi.fn().mockResolvedValue({ stdout: "" }),
			platform: "linux",
		});

		expect(stage).not.toHaveBeenCalled();
		expect(runtime.executable("/tmp/env", "llama-server")).toBe(
			path.posix.join("/tmp/env", "bin", "llama-server"),
		);
		expect(stage).not.toHaveBeenCalled();
	});

	it("returns invalid input as a promise rejection", async () => {
		const stage = vi.fn().mockResolvedValue(staging());
		const runtime = new CondaRuntime({
			stage,
			logger,
			execute: vi.fn().mockResolvedValue({ stdout: "" }),
			platform: "linux",
		});

		const pending = runtime.ensureEnvironment({
			name: "../invalid",
			packages: [],
		});

		await expect(pending).rejects.toThrow();
		expect(stage).not.toHaveBeenCalled();
	});

	it("reuses a ready prefix without running conda create", async () => {
		const condaFilesRoot = await mkdtemp(path.join(os.tmpdir(), "conda-runtime-"));
		const prefixPath = path.join(condaFilesRoot, "envs", "local-inference");
		await mkdir(path.join(prefixPath, "conda-meta"), { recursive: true });
		const execute = vi.fn().mockResolvedValue({ stdout: "" });
		const runtime = new CondaRuntime({
			stage: async () => ({
				condaBinPath: "/opt/conda/bin/conda",
				condaFilesRoot,
				strategy: "system",
			}),
			logger,
			execute,
			platform: "linux",
		});

		try {
			await expect(
				runtime.ensureEnvironment({
					name: "local-inference",
					packages: ["llama.cpp=1.2"],
				}),
			).resolves.toEqual({
				condaBinPath: "/opt/conda/bin/conda",
				prefixPath: path.posix.join(condaFilesRoot, "envs", "local-inference"),
			});
			expect(execute).not.toHaveBeenCalled();
		} finally {
			await rm(condaFilesRoot, { recursive: true, force: true });
		}
	});

	it("recreates a ready prefix when the requested version pin changes", async () => {
		const condaFilesRoot = await mkdtemp(path.join(os.tmpdir(), "conda-runtime-"));
		const prefixPath = path.join(condaFilesRoot, "envs", "local-inference");
		const execute = vi.fn().mockImplementation(async () => {
			await mkdir(path.join(prefixPath, "conda-meta"), { recursive: true });
		});
		const runtime = new CondaRuntime({
			stage: async () => ({
				condaBinPath: "/opt/conda/bin/conda",
				condaFilesRoot,
				strategy: "system",
			}),
			logger,
			execute,
			platform: "linux",
		});

		try {
			await runtime.ensureEnvironment({
				name: "local-inference",
				packages: ["anaconda::llama.cpp==0.0.10241=cpu_*"],
			});
			expect(execute).toHaveBeenCalledTimes(1);
			await runtime.ensureEnvironment({
				name: "local-inference",
				packages: ["anaconda::llama.cpp==0.0.10241=cpu_*"],
			});
			expect(execute).toHaveBeenCalledTimes(1);
			await runtime.ensureEnvironment({
				name: "local-inference",
				packages: ["anaconda::llama.cpp==0.0.10068=cpu_*"],
			});
			expect(execute).toHaveBeenCalledTimes(2);
		} finally {
			await rm(condaFilesRoot, { recursive: true, force: true });
		}
	});

	it("recreates a ready prefix when the llama.cpp build flavor changes", async () => {
		const condaFilesRoot = await mkdtemp(path.join(os.tmpdir(), "conda-runtime-"));
		const prefixPath = path.join(condaFilesRoot, "envs", "local-inference");
		const execute = vi.fn().mockImplementation(async () => {
			await mkdir(path.join(prefixPath, "conda-meta"), { recursive: true });
		});
		const runtime = new CondaRuntime({
			stage: async () => ({
				condaBinPath: "/opt/conda/bin/conda",
				condaFilesRoot,
				strategy: "system",
			}),
			logger,
			execute,
			platform: "linux",
		});

		try {
			await runtime.ensureEnvironment({
				name: "local-inference",
				packages: ["anaconda::llama.cpp==0.0.10068=cpu_*"],
			});
			expect(execute).toHaveBeenCalledTimes(1);
			await runtime.ensureEnvironment({
				name: "local-inference",
				packages: ["anaconda::llama.cpp==0.0.10068=cuda*"],
			});
			expect(execute).toHaveBeenCalledTimes(2);
		} finally {
			await rm(condaFilesRoot, { recursive: true, force: true });
		}
	});

	it("replaces an incomplete prefix before creating", async () => {
		const condaFilesRoot = await mkdtemp(path.join(os.tmpdir(), "conda-runtime-"));
		const prefixPath = path.join(condaFilesRoot, "envs", "local-inference");
		await mkdir(prefixPath, { recursive: true });
		const leftover = path.join(prefixPath, "leftover");
		await writeFile(leftover, "partial");
		const execute = vi.fn().mockResolvedValue({ stdout: "" });
		const runtime = new CondaRuntime({
			stage: async () => ({
				condaBinPath: "/opt/conda/bin/conda",
				condaFilesRoot,
				strategy: "system",
			}),
			logger,
			execute,
			platform: "linux",
		});

		try {
			await runtime.ensureEnvironment({
				name: "local-inference",
				packages: ["llama.cpp=1.2"],
			});
			expect(execute).toHaveBeenCalledTimes(1);
			await expect(access(leftover)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await rm(condaFilesRoot, { recursive: true, force: true });
		}
	});

	it("creates a missing prefix with stable llama.cpp channels", async () => {
		const stage = vi.fn().mockResolvedValue(staging());
		const execute = vi.fn().mockResolvedValue({ stdout: "" });
		const runtime = new CondaRuntime({ stage, logger, execute, platform: "linux" });

		const result = await runtime.ensureEnvironment({
			name: "local-inference",
			packages: ["python=3.12", "anaconda::llama.cpp=1.2", "python=3.12"],
		});

		const prefixPath = path.posix.join("/tmp/anaconda-conda", "envs", "local-inference");
		expect(result).toEqual({
			condaBinPath: "/opt/conda/bin/conda",
			prefixPath,
		});
		expect(execute).toHaveBeenCalledWith(
			"/opt/conda/bin/conda",
			[
				"create",
				"--prefix",
				prefixPath,
				"--yes",
				"--override-channels",
				"--strict-channel-priority",
				"--channel",
				"anaconda",
				"--channel",
				"defaults",
				"--",
				"anaconda::llama.cpp=1.2",
				"python=3.12",
			],
			{
				env: {
					CONDA_ENVS_PATH: path.posix.join("/tmp/anaconda-conda", "envs"),
					CONDA_PKGS_DIRS: path.posix.join("/tmp/anaconda-conda", "pkgs"),
					CONDARC: path.posix.join("/tmp/anaconda-conda", ".condarc"),
					CONDA_PLUGINS_AUTO_ACCEPT_TOS: "yes",
				},
			},
		);
	});

	it("promotes an explicitly qualified channel above the fallback channels", async () => {
		const execute = vi.fn().mockResolvedValue({ stdout: "" });
		const runtime = new CondaRuntime({
			stage: vi.fn().mockResolvedValue(staging()),
			logger,
			execute,
			platform: "linux",
		});

		await runtime.ensureEnvironment({
			name: "local-inference",
			packages: ["conda-forge::llama.cpp>=9222"],
		});

		expect(execute).toHaveBeenCalledWith(
			"/opt/conda/bin/conda",
			[
				"create",
				"--prefix",
				path.posix.join("/tmp/anaconda-conda", "envs", "local-inference"),
				"--yes",
				"--override-channels",
				"--strict-channel-priority",
				"--channel",
				"conda-forge",
				"--channel",
				"anaconda",
				"--channel",
				"defaults",
				"--",
				"conda-forge::llama.cpp>=9222",
			],
			{
				env: {
					CONDA_ENVS_PATH: path.posix.join("/tmp/anaconda-conda", "envs"),
					CONDA_PKGS_DIRS: path.posix.join("/tmp/anaconda-conda", "pkgs"),
					CONDARC: path.posix.join("/tmp/anaconda-conda", ".condarc"),
					CONDA_PLUGINS_AUTO_ACCEPT_TOS: "yes",
				},
			},
		);
	});

	it("coalesces concurrent requests for the same environment specification", async () => {
		const stage = vi.fn().mockResolvedValue(staging());
		let release: (() => void) | undefined;
		const pending = new Promise<{ stdout: string }>((resolve) => {
			release = () => resolve({ stdout: "" });
		});
		const execute = vi.fn().mockReturnValue(pending);
		const runtime = new CondaRuntime({ stage, logger, execute, platform: "linux" });

		const first = runtime.ensureEnvironment({
			name: "local-inference",
			packages: ["python=3.12", "llama.cpp=1.2"],
		});
		const second = runtime.ensureEnvironment({
			name: "local-inference",
			packages: ["llama.cpp=1.2", "python=3.12", "llama.cpp=1.2"],
		});
		await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
		release?.();

		await expect(Promise.all([first, second])).resolves.toEqual([
			{
				condaBinPath: "/opt/conda/bin/conda",
				prefixPath: path.posix.join("/tmp/anaconda-conda", "envs", "local-inference"),
			},
			{
				condaBinPath: "/opt/conda/bin/conda",
				prefixPath: path.posix.join("/tmp/anaconda-conda", "envs", "local-inference"),
			},
		]);
		expect(stage).toHaveBeenCalledTimes(1);
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it("retries staging after a failed lazy request", async () => {
		const stage = vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(staging());
		const execute = vi.fn().mockResolvedValue({ stdout: "" });
		const runtime = new CondaRuntime({ stage, logger, execute, platform: "linux" });
		const input = { name: "local-inference", packages: ["llama.cpp=1.2"] };

		await expect(runtime.ensureEnvironment(input)).rejects.toThrow("offline");
		await expect(runtime.ensureEnvironment(input)).resolves.toEqual({
			condaBinPath: "/opt/conda/bin/conda",
			prefixPath: path.posix.join("/tmp/anaconda-conda", "envs", "local-inference"),
		});

		expect(stage).toHaveBeenCalledTimes(2);
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it("resolves Windows conda executables from Library/bin with an exe suffix", () => {
		const runtime = new CondaRuntime({
			stage: vi.fn().mockResolvedValue(staging()),
			logger,
			execute: vi.fn().mockResolvedValue({ stdout: "" }),
			platform: "win32",
		});

		expect(runtime.executable("C:\\conda\\envs\\local", "llama-server")).toBe(
			path.win32.join("C:\\conda\\envs\\local", "Library", "bin", "llama-server.exe"),
		);
	});
});
