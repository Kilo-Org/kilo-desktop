import si from "systeminformation";
import { describe, expect, it, vi } from "vitest";

import {
	condaLlamaRuntime,
	llamaFlavors,
	readLlamaHost,
	resolveLlamaExecutable,
	type LlamaHost,
} from "./llama-runtime";

const CPU = "llama.cpp==0.6.0=cpu_*";
const CUDA = "llama.cpp==0.6.0=cuda*";
const METAL = "llama.cpp==0.6.0=mps_*";
const INTEL_MAC = "llama.cpp>=9222";
const MAIN_URL = "https://repo.anaconda.com/pkgs/main";

function flavorSpecs(target: LlamaHost): string[] {
	return llamaFlavors(target).map((flavor) => flavor.spec);
}

const nvidia = [{ vendor: "NVIDIA", model: "GeForce RTX 4080" }];
const radeon = [{ vendor: "ATI", model: "Radeon RX 6000" }];

function host(partial: Partial<LlamaHost> & Pick<LlamaHost, "platform" | "arch">): LlamaHost {
	return {
		release: "0",
		gpus: [],
		...partial,
	};
}

describe("llamaFlavors", () => {
	it("prefers CUDA then CPU on Windows when an NVIDIA GPU is present", () => {
		expect(flavorSpecs(host({ platform: "win32", arch: "x64", gpus: nvidia }))).toEqual([
			CUDA,
			CPU,
		]);
	});

	it("uses only CPU on Windows without an NVIDIA GPU", () => {
		expect(flavorSpecs(host({ platform: "win32", arch: "x64", gpus: radeon }))).toEqual([CPU]);
	});

	it("uses only CPU on Windows ARM64 without an NVIDIA GPU", () => {
		expect(flavorSpecs(host({ platform: "win32", arch: "arm64" }))).toEqual([CPU]);
	});

	it("prefers CUDA then CPU on Windows ARM64 when an NVIDIA GPU is present", () => {
		expect(flavorSpecs(host({ platform: "win32", arch: "arm64", gpus: nvidia }))).toEqual([
			CUDA,
			CPU,
		]);
	});

	it("prefers CUDA then CPU on Linux when an NVIDIA GPU is present", () => {
		expect(flavorSpecs(host({ platform: "linux", arch: "x64", gpus: nvidia }))).toEqual([
			CUDA,
			CPU,
		]);
	});

	it("uses only CPU on Linux without an NVIDIA GPU", () => {
		expect(flavorSpecs(host({ platform: "linux", arch: "arm64" }))).toEqual([CPU]);
	});

	it("prefers Metal then CPU on Apple silicon running Darwin 16 or later", () => {
		expect(flavorSpecs(host({ platform: "darwin", arch: "arm64", release: "16.0.0" }))).toEqual([
			METAL,
			CPU,
		]);
	});

	it("uses only CPU on Apple silicon older than Darwin 16", () => {
		expect(flavorSpecs(host({ platform: "darwin", arch: "arm64", release: "15.9.9" }))).toEqual([
			CPU,
		]);
	});

	it("does not select CUDA on macOS even when an NVIDIA GPU string is present", () => {
		expect(
			flavorSpecs(host({ platform: "darwin", arch: "arm64", release: "20.0.0", gpus: nvidia })),
		).toEqual([METAL, CPU]);
	});

	it("prefers a recent conda-forge build then CPU on Intel Macs", () => {
		expect(flavorSpecs(host({ platform: "darwin", arch: "x64", release: "20.0.0" }))).toEqual([
			INTEL_MAC,
			CPU,
		]);
	});

	it("uses only CPU on Darwin with an unrecognized architecture", () => {
		expect(flavorSpecs(host({ platform: "darwin", arch: "ia32", release: "20.0.0" }))).toEqual([
			CPU,
		]);
	});

	it("detects NVIDIA from the combined vendor and model strings", () => {
		expect(
			flavorSpecs(
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
			flavorSpecs(
				host({
					platform: "linux",
					arch: "x64",
					gpus: [{ model: "NVIDIA GeForce RTX 4080" }],
				}),
			),
		).toEqual([CUDA, CPU]);
		expect(
			flavorSpecs(
				host({
					platform: "linux",
					arch: "x64",
					gpus: [{ vendor: "NVIDIA" }, {}],
				}),
			),
		).toEqual([CUDA, CPU]);
	});
});

describe("llamaFlavors channels", () => {
	it("installs Anaconda builds from defaults, falling back to the pkgs/main URL", () => {
		for (const flavor of llamaFlavors(host({ platform: "linux", arch: "x64", gpus: nvidia }))) {
			expect(flavor.channels).toEqual(["defaults"]);
			expect(flavor.channelUrls).toEqual([MAIN_URL]);
		}
	});

	it("puts conda-forge ahead of defaults for the Intel Mac build", () => {
		expect(llamaFlavors(host({ platform: "darwin", arch: "x64", release: "20.0.0" }))[0]).toEqual({
			spec: INTEL_MAC,
			channels: ["conda-forge", "defaults"],
			channelUrls: ["https://conda.anaconda.org/conda-forge", MAIN_URL],
		});
	});

	it("uses no channel:: prefix, which a user's channel_alias would rewrite", () => {
		const specs = flavorSpecs(host({ platform: "darwin", arch: "x64", release: "20.0.0" }));
		expect(specs.some((spec) => spec.includes("::"))).toBe(false);
	});
});

describe("resolveLlamaExecutable", () => {
	it("retries a flavor from canonical URLs when the user's default_channels lack it", async () => {
		const ensureEnvironment = vi.fn(
			async ({ channels }: { packages: readonly string[]; channels?: readonly string[] }) => {
				if (channels?.[0] === "defaults") throw new Error("PackagesNotFoundError");
				return { prefixPath: "/main-env" };
			},
		);
		await expect(
			resolveLlamaExecutable({
				conda: { ensureEnvironment, executable: (prefixPath, name) => `${prefixPath}/${name}` },
				host: host({ platform: "darwin", arch: "arm64", release: "24.0.0" }),
				accessFile: async () => {},
				logger: { warn() {} },
			}),
		).resolves.toBe("/main-env/llama-server");
		expect(ensureEnvironment.mock.calls.map(([input]) => input)).toEqual([
			{ name: "local-inference-llama", packages: [METAL], channels: ["defaults"] },
			{ name: "local-inference-llama", packages: [METAL], channels: [MAIN_URL] },
		]);
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

describe("condaLlamaRuntime", () => {
	it("resolves llama.cpp for this machine from its conda runtime", async () => {
		const ensureEnvironment = vi.fn(async () => ({ prefixPath: "/env" }));
		const runtime = condaLlamaRuntime({
			conda: { ensureEnvironment, executable: (prefixPath, name) => `${prefixPath}/${name}` },
			logger: { warn() {} },
			readHost: async () => host({ platform: "linux", arch: "x64", gpus: nvidia }),
			accessFile: async () => {},
		});
		await expect(runtime.resolveExecutable()).resolves.toBe("/env/llama-server");
		expect(ensureEnvironment).toHaveBeenCalledWith({
			name: "local-inference-llama",
			packages: [CUDA],
			channels: ["defaults"],
		});
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
