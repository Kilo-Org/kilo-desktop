import { mkdir, mkdtemp, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { MainSdkLogger } from "@kilo-desktop/feature-sdk/main";

import { CondaRuntime } from "./CondaRuntime.js";
import { SidecarCondaBackend } from "./SidecarCondaBackend.js";
import type { BridgeLaunchInfo } from "./resolveBridgePath.js";

const logger: MainSdkLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

function fakeBridge(): BridgeLaunchInfo {
	return {
		command: ["/fake/bridge/python", "-m", "anaconda_desktop_bridge"],
		payloadRoot: "/fake/bridge",
		version: "1.0.0",
	};
}

describe("CondaRuntime", () => {
	it("does not resolve the bridge until an environment is requested", () => {
		const resolveBridge = vi.fn().mockReturnValue(fakeBridge());
		const runtime = new CondaRuntime({
			resolveBridge,
			logger,
			platform: "linux",
		});

		expect(resolveBridge).not.toHaveBeenCalled();
		expect(runtime.executable("/tmp/env", "llama-server")).toBe(
			path.posix.join("/tmp/env", "bin", "llama-server"),
		);
		expect(resolveBridge).not.toHaveBeenCalled();
	});

	it("returns invalid input as a promise rejection", async () => {
		const resolveBridge = vi.fn().mockReturnValue(fakeBridge());
		const runtime = new CondaRuntime({
			resolveBridge,
			logger,
			platform: "linux",
		});

		const pending = runtime.ensureEnvironment({
			name: "../invalid",
			packages: [],
		});

		await expect(pending).rejects.toThrow();
		expect(resolveBridge).not.toHaveBeenCalled();
	});

	it("reuses a ready prefix without running conda create", async () => {
		const condaFilesRoot = await mkdtemp(path.join(os.tmpdir(), "conda-runtime-"));
		const prefixPath = path.join(condaFilesRoot, "envs", "local-inference");
		await mkdir(path.join(prefixPath, "conda-meta"), { recursive: true });
		const create = vi.spyOn(SidecarCondaBackend.prototype, "create").mockResolvedValue({
			name: "local-inference",
			prefix: prefixPath,
		});
		const runtime = new CondaRuntime({
			resolveBridge: () => fakeBridge(),
			logger,
			platform: "linux",
			condaFilesRoot,
		});

		try {
			const result = await runtime.ensureEnvironment({
				name: "local-inference",
				packages: ["llama.cpp=1.2"],
			});
			expect(result.prefixPath).toBe(path.posix.join(condaFilesRoot, "envs", "local-inference"));
			expect(create).not.toHaveBeenCalled();
		} finally {
			create.mockRestore();
			await rm(condaFilesRoot, { recursive: true, force: true });
		}
	});

	it("recreates a ready prefix when the requested version pin changes", async () => {
		const condaFilesRoot = await mkdtemp(path.join(os.tmpdir(), "conda-runtime-"));
		const prefixPath = path.join(condaFilesRoot, "envs", "local-inference");
		const create = vi
			.spyOn(SidecarCondaBackend.prototype, "create")
			.mockImplementation(async () => {
				await mkdir(path.join(prefixPath, "conda-meta"), { recursive: true });
				return { name: "local-inference", prefix: prefixPath };
			});
		const runtime = new CondaRuntime({
			resolveBridge: () => fakeBridge(),
			logger,
			platform: "linux",
			condaFilesRoot,
		});

		try {
			await runtime.ensureEnvironment({
				name: "local-inference",
				packages: ["anaconda::llama.cpp==0.0.10241=cpu_*"],
			});
			expect(create).toHaveBeenCalledTimes(1);
			await runtime.ensureEnvironment({
				name: "local-inference",
				packages: ["anaconda::llama.cpp==0.0.10241=cpu_*"],
			});
			expect(create).toHaveBeenCalledTimes(1);
			await runtime.ensureEnvironment({
				name: "local-inference",
				packages: ["anaconda::llama.cpp==0.0.10068=cpu_*"],
			});
			expect(create).toHaveBeenCalledTimes(2);
		} finally {
			create.mockRestore();
			await rm(condaFilesRoot, { recursive: true, force: true });
		}
	});

	it("replaces an incomplete prefix before creating", async () => {
		const condaFilesRoot = await mkdtemp(path.join(os.tmpdir(), "conda-runtime-"));
		const prefixPath = path.join(condaFilesRoot, "envs", "local-inference");
		await mkdir(prefixPath, { recursive: true });
		const leftover = path.join(prefixPath, "leftover");
		await writeFile(leftover, "partial");
		const create = vi.spyOn(SidecarCondaBackend.prototype, "create").mockResolvedValue({
			name: "local-inference",
			prefix: prefixPath,
		});
		const runtime = new CondaRuntime({
			resolveBridge: () => fakeBridge(),
			logger,
			platform: "linux",
			condaFilesRoot,
		});

		try {
			await runtime.ensureEnvironment({
				name: "local-inference",
				packages: ["llama.cpp=1.2"],
			});
			expect(create).toHaveBeenCalledTimes(1);
			await expect(access(leftover)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			create.mockRestore();
			await rm(condaFilesRoot, { recursive: true, force: true });
		}
	});

	it("delegates environment creation to SidecarCondaBackend.create", async () => {
		const create = vi.spyOn(SidecarCondaBackend.prototype, "create").mockResolvedValue({
			name: "local-inference",
			prefix: "/tmp/conda/envs/local-inference",
		});
		const condaFilesRoot = "/tmp/conda";
		const runtime = new CondaRuntime({
			resolveBridge: () => fakeBridge(),
			logger,
			platform: "linux",
			condaFilesRoot,
		});

		const result = await runtime.ensureEnvironment({
			name: "local-inference",
			packages: ["python=3.12", "anaconda::llama.cpp=1.2", "python=3.12"],
		});

		try {
			expect(result.prefixPath).toBe(path.posix.join(condaFilesRoot, "envs", "local-inference"));
			expect(create).toHaveBeenCalledTimes(1);
			expect(create).toHaveBeenCalledWith(
				{
					name: "local-inference",
					packages: ["anaconda::llama.cpp=1.2", "python=3.12"],
					channels: ["anaconda", "defaults"],
				},
				undefined,
				{ prefix: path.posix.join(condaFilesRoot, "envs", "local-inference") },
			);
		} finally {
			create.mockRestore();
		}
	});

	it("throws when bridge payload is not found", async () => {
		const runtime = new CondaRuntime({
			resolveBridge: () => null,
			logger,
			platform: "linux",
		});

		await expect(
			runtime.ensureEnvironment({
				name: "local-inference",
				packages: ["llama.cpp=1.2"],
			}),
		).rejects.toThrow(/anaconda-bridge-sidecar payload not found/);
	});

	it("resolves Windows conda executables from Library/bin with an exe suffix", () => {
		const runtime = new CondaRuntime({
			resolveBridge: () => fakeBridge(),
			logger,
			platform: "win32",
		});

		expect(runtime.executable("C:\\conda\\envs\\local", "llama-server")).toBe(
			path.win32.join("C:\\conda\\envs\\local", "Library", "bin", "llama-server.exe"),
		);
	});
});
