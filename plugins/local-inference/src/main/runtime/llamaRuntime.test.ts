import si from "systeminformation";
import { describe, expect, it, vi } from "vitest";

import {
	llamaPackageSpecs,
	readLlamaHost,
	resolveLlamaExecutable,
	type LlamaHost,
} from "./llamaRuntime.js";

const CPU = "anaconda::llama.cpp==0.0.10068=cpu_*";
const CUDA = "anaconda::llama.cpp==0.0.10068=cuda*";
const METAL = "anaconda::llama.cpp==0.0.10068=mps_*";
const WINDOWS_ARM64_CPU = "anaconda::llama.cpp==0.5.0=cpu_*";
const WINDOWS_ARM64_CUDA = "anaconda::llama.cpp==0.5.0=cuda*";
const INTEL_MAC = "conda-forge::llama.cpp>=9222";

const nvidia = [{ vendor: "NVIDIA", model: "GeForce RTX 4080" }];
const radeon = [{ vendor: "ATI", model: "Radeon RX 6000" }];

function host(partial: Partial<LlamaHost> & Pick<LlamaHost, "platform" | "arch">): LlamaHost {
	return {
		release: "0",
		gpus: [],
		...partial,
	};
}

describe("llamaPackageSpecs", () => {
	it("prefers CUDA then CPU on Windows when an NVIDIA GPU is present", () => {
		expect(llamaPackageSpecs(host({ platform: "win32", arch: "x64", gpus: nvidia }))).toEqual([
			CUDA,
			CPU,
		]);
	});

	it("uses only CPU on Windows without an NVIDIA GPU", () => {
		expect(llamaPackageSpecs(host({ platform: "win32", arch: "x64", gpus: radeon }))).toEqual([
			CPU,
		]);
	});

	it("uses the router-capable 0.5.0 CPU build on Windows ARM64", () => {
		expect(llamaPackageSpecs(host({ platform: "win32", arch: "arm64" }))).toEqual([
			WINDOWS_ARM64_CPU,
		]);
	});

	it("prefers the 0.5.0 CUDA build then CPU on Windows ARM64 with an NVIDIA GPU", () => {
		expect(llamaPackageSpecs(host({ platform: "win32", arch: "arm64", gpus: nvidia }))).toEqual([
			WINDOWS_ARM64_CUDA,
			WINDOWS_ARM64_CPU,
		]);
	});

	it("prefers CUDA then CPU on Linux when an NVIDIA GPU is present", () => {
		expect(llamaPackageSpecs(host({ platform: "linux", arch: "x64", gpus: nvidia }))).toEqual([
			CUDA,
			CPU,
		]);
	});

	it("uses only CPU on Linux without an NVIDIA GPU", () => {
		expect(llamaPackageSpecs(host({ platform: "linux", arch: "arm64" }))).toEqual([CPU]);
	});

	it("prefers Metal then CPU on Apple silicon running Darwin 16 or later", () => {
		expect(
			llamaPackageSpecs(host({ platform: "darwin", arch: "arm64", release: "16.0.0" })),
		).toEqual([METAL, CPU]);
	});

	it("uses only CPU on Apple silicon older than Darwin 16", () => {
		expect(
			llamaPackageSpecs(host({ platform: "darwin", arch: "arm64", release: "15.9.9" })),
		).toEqual([CPU]);
	});

	it("does not select CUDA on macOS even when an NVIDIA GPU string is present", () => {
		expect(
			llamaPackageSpecs(
				host({ platform: "darwin", arch: "arm64", release: "20.0.0", gpus: nvidia }),
			),
		).toEqual([METAL, CPU]);
	});

	it("prefers a recent conda-forge build then CPU on Intel Macs", () => {
		expect(llamaPackageSpecs(host({ platform: "darwin", arch: "x64", release: "20.0.0" }))).toEqual(
			[INTEL_MAC, CPU],
		);
	});

	it("uses only CPU on Darwin with an unrecognized architecture", () => {
		expect(
			llamaPackageSpecs(host({ platform: "darwin", arch: "ia32", release: "20.0.0" })),
		).toEqual([CPU]);
	});

	it("detects NVIDIA from the combined vendor and model strings", () => {
		expect(
			llamaPackageSpecs(
				host({
					platform: "win32",
					arch: "x64",
					gpus: [
						{ vendor: "ATI", model: "Radeon RX 6000" },
						{ vendor: "MSI RIP", model: "Nvidia RTX 4080" },
					],
				}),
			),
		).toEqual([CUDA, CPU]);
		expect(
			llamaPackageSpecs(
				host({
					platform: "linux",
					arch: "x64",
					gpus: [{ model: "NVIDIA GeForce RTX 4080" }],
				}),
			),
		).toEqual([CUDA, CPU]);
		expect(
			llamaPackageSpecs(
				host({
					platform: "linux",
					arch: "x64",
					gpus: [{ vendor: "NVIDIA" }, {}],
				}),
			),
		).toEqual([CUDA, CPU]);
	});
});

describe("resolveLlamaExecutable", () => {
	it("uses LOCAL_LLAMA_SERVER_PATH when it is readable", async () => {
		const conda = {
			ensureEnvironment: vi.fn(async () => ({ prefixPath: "/unused" })),
			executable: () => "/unused/llama-server",
		};
		await expect(
			resolveLlamaExecutable({
				conda,
				host: host({ platform: "linux", arch: "x64" }),
				overridePath: "/opt/llama-server",
				accessFile: async () => {},
			}),
		).resolves.toBe("/opt/llama-server");
		expect(conda.ensureEnvironment).not.toHaveBeenCalled();
	});

	it("installs the CUDA build on an NVIDIA Windows host", async () => {
		await expect(
			resolveLlamaExecutable({
				conda: {
					ensureEnvironment: async ({ packages }) => {
						if (packages[0] !== CUDA) throw new Error(`unexpected spec ${packages[0]}`);
						return { prefixPath: "/cuda-env" };
					},
					executable: (prefixPath, name) => `${prefixPath}/${name}`,
				},
				host: host({ platform: "win32", arch: "x64", gpus: nvidia }),
				accessFile: async () => {},
			}),
		).resolves.toBe("/cuda-env/llama-server");
	});

	it("falls back to the CPU build when the preferred flavor cannot be installed", async () => {
		await expect(
			resolveLlamaExecutable({
				conda: {
					ensureEnvironment: async ({ packages }) => {
						if (packages[0] === CUDA) throw new Error("CUDA build unavailable");
						return { prefixPath: "/cpu-env" };
					},
					executable: (prefixPath, name) => `${prefixPath}/${name}`,
				},
				host: host({ platform: "linux", arch: "x64", gpus: nvidia }),
				accessFile: async () => {},
			}),
		).resolves.toBe("/cpu-env/llama-server");
	});

	it("throws when the environments plugin is unavailable", async () => {
		await expect(
			resolveLlamaExecutable({
				conda: null,
				host: host({ platform: "linux", arch: "x64" }),
			}),
		).rejects.toThrow("The local inference runtime is unavailable.");
	});

	it("throws the last install error when every llama.cpp flavor fails", async () => {
		await expect(
			resolveLlamaExecutable({
				conda: {
					ensureEnvironment: async ({ packages }) => {
						throw new Error(`failed ${packages[0]}`);
					},
					executable: (prefixPath, name) => `${prefixPath}/${name}`,
				},
				host: host({ platform: "linux", arch: "x64", gpus: nvidia }),
				accessFile: async () => {},
				logger: { warn() {} },
			}),
		).rejects.toThrow(`failed ${CPU}`);
	});

	it("wraps non-Error install failures after every flavor fails", async () => {
		const warnings: string[] = [];
		await expect(
			resolveLlamaExecutable({
				conda: {
					ensureEnvironment: async () => {
						throw "conda missing";
					},
					executable: (prefixPath, name) => `${prefixPath}/${name}`,
				},
				host: host({ platform: "linux", arch: "x64" }),
				accessFile: async () => {},
				logger: {
					warn(message) {
						warnings.push(message);
					},
				},
			}),
		).rejects.toThrow("Local inference could not install llama.cpp.");
		expect(warnings.some((message) => message.includes("conda missing"))).toBe(true);
	});

	it("falls back when the preferred binary is missing after install", async () => {
		await expect(
			resolveLlamaExecutable({
				conda: {
					ensureEnvironment: async ({ packages }) => ({
						prefixPath: packages[0] === CUDA ? "/cuda-env" : "/cpu-env",
					}),
					executable: (prefixPath, name) => `${prefixPath}/${name}`,
				},
				host: host({ platform: "win32", arch: "x64", gpus: nvidia }),
				accessFile: async (filePath) => {
					if (filePath.startsWith("/cuda-env")) throw new Error("missing binary");
				},
			}),
		).resolves.toBe("/cpu-env/llama-server");
	});
});

describe("readLlamaHost", () => {
	it("uses the GPU probe result on the current machine", async () => {
		const result = await readLlamaHost(async () => nvidia);
		expect(result.gpus).toEqual(nvidia);
		expect(result.platform).toBe(process.platform);
		expect(result.arch).toBe(process.arch);
	});

	it("probes system graphics when no GPU list is injected", async () => {
		const graphics = vi.spyOn(si, "graphics").mockResolvedValue({
			controllers: nvidia,
		} as Awaited<ReturnType<typeof si.graphics>>);
		try {
			await expect(readLlamaHost()).resolves.toMatchObject({ gpus: nvidia });
		} finally {
			graphics.mockRestore();
		}
	});

	it("treats a missing graphics controller list as no GPUs", async () => {
		const graphics = vi
			.spyOn(si, "graphics")
			.mockResolvedValue({} as Awaited<ReturnType<typeof si.graphics>>);
		try {
			await expect(readLlamaHost()).resolves.toMatchObject({ gpus: [] });
		} finally {
			graphics.mockRestore();
		}
	});
});
