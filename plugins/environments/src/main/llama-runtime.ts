// llama.cpp for the Local Model Server, from a conda environment kilo.environments
// owns: origin's local-inference `llamaRuntime.ts` (at 0c2a6721), minus what
// kilo.local-inference still does itself (`LOCAL_LLAMA_SERVER_PATH`, and the
// "runtime is unavailable" refusal when nothing can provide llama.cpp).
import { access } from "node:fs/promises";
import os from "node:os";

import si from "systeminformation";

import type { LlamaRuntimeSource } from "@kilo-desktop/plugin-local-inference/contracts";

export interface LlamaFlavor {
	readonly spec: string;
	/** Channel names, resolved through the user's conda configuration. */
	readonly channels: readonly string[];
	/** The same channels as URLs, tried when the user's configuration lacks the build. */
	readonly channelUrls: readonly string[];
}

const MAIN_URL = "https://repo.anaconda.com/pkgs/main";
const FROM_DEFAULTS = { channels: ["defaults"], channelUrls: [MAIN_URL] };

// `defaults` expands through `default_channels` (repo.anaconda.com/pkgs/main
// by default), never through a user's `channel_alias`, which can point named
// channels like `anaconda` at a host that lacks them. Specs carry no
// `channel::` prefix so both attempts record the same pin and a successful
// install is reused. Anaconda's 0.3.x and 0.4.x builds ship without
// subprocess support, which llama-server's router mode requires. Check every
// subdir in pkgs/main publishes the build before bumping the pin.
const CPU: LlamaFlavor = { spec: "llama.cpp==0.6.0=cpu_*", ...FROM_DEFAULTS };
const CUDA: LlamaFlavor = { spec: "llama.cpp==0.6.0=cuda*", ...FROM_DEFAULTS };
const METAL: LlamaFlavor = { spec: "llama.cpp==0.6.0=mps_*", ...FROM_DEFAULTS };
// pkgs/main has no osx-64 build.
const INTEL_MAC: LlamaFlavor = {
	spec: "llama.cpp>=9222",
	channels: ["conda-forge", "defaults"],
	channelUrls: ["https://conda.anaconda.org/conda-forge", MAIN_URL],
};
const ENV_NAME = "local-inference-llama";
const SERVER_NAME = "llama-server";

export interface GpuController {
	readonly vendor?: string;
	readonly model?: string;
}

export interface LlamaHost {
	readonly platform: NodeJS.Platform;
	readonly arch: NodeJS.Architecture;
	readonly release: string;
	readonly gpus: readonly GpuController[];
}

export interface LlamaCondaRuntime {
	ensureEnvironment(input: {
		name: string;
		packages: readonly string[];
		channels?: readonly string[];
	}): Promise<{ prefixPath: string }>;
	executable(prefixPath: string, name: string): string;
}

export interface ResolveLlamaExecutableOptions {
	readonly conda: LlamaCondaRuntime;
	readonly host: LlamaHost;
	readonly accessFile?: (filePath: string) => Promise<void>;
	readonly logger?: { warn(message: string): void };
}

/**
 * Picks llama.cpp conda builds using NVIDIA presence (vendor+model string)
 * plus OS/arch, then CUDA → Metal → CPU.
 * Install tries each flavor from the user's configured channels, then from
 * their canonical URLs, and keeps going when a flavor fails so a missing
 * CUDA/Metal package still yields a working CPU server.
 */
export function llamaFlavors(host: LlamaHost): LlamaFlavor[] {
	if (host.platform === "darwin") {
		if (host.arch === "x64") return [INTEL_MAC, CPU];
		const darwin = Number.parseInt(host.release.split(".")[0] ?? "", 10);
		if (host.arch === "arm64" && darwin >= 16) return [METAL, CPU];
		return [CPU];
	}
	if ((host.platform === "win32" || host.platform === "linux") && hasNvidia(host.gpus)) {
		return [CUDA, CPU];
	}
	return [CPU];
}

export async function readLlamaHost(
	listGpus: () => Promise<readonly GpuController[]> = detectGpus,
): Promise<LlamaHost> {
	return {
		platform: process.platform,
		arch: process.arch,
		release: os.release(),
		gpus: await listGpus(),
	};
}

export async function resolveLlamaExecutable(
	options: ResolveLlamaExecutableOptions,
): Promise<string> {
	const accessFile = options.accessFile ?? access;
	const conda = options.conda;
	let lastError: unknown;
	for (const { spec, channels, channelUrls } of llamaFlavors(options.host)) {
		for (const attemptChannels of [channels, channelUrls]) {
			try {
				const runtime = await conda.ensureEnvironment({
					name: ENV_NAME,
					packages: [spec],
					channels: attemptChannels,
				});
				const executable = conda.executable(runtime.prefixPath, SERVER_NAME);
				await accessFile(executable);
				return executable;
			} catch (error) {
				lastError = error;
				options.logger?.warn(
					`Could not install llama.cpp build "${spec}" from ${attemptChannels.join(", ")}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}
	throw lastError instanceof Error
		? lastError
		: new Error("Local inference could not install llama.cpp.");
}

export interface CondaLlamaRuntimeOptions {
	readonly conda: LlamaCondaRuntime;
	readonly logger: { warn(message: string): void };
	/** Describes this machine; defaults to {@link readLlamaHost}. */
	readonly readHost?: () => Promise<LlamaHost>;
	readonly accessFile?: (filePath: string) => Promise<void>;
}

/** The `kilo.local-inference/llama-runtime` contribution `conda`. */
export function condaLlamaRuntime(options: CondaLlamaRuntimeOptions): LlamaRuntimeSource {
	return {
		resolveExecutable: async () =>
			resolveLlamaExecutable({
				conda: options.conda,
				host: await (options.readHost ?? readLlamaHost)(),
				logger: options.logger,
				...(options.accessFile ? { accessFile: options.accessFile } : {}),
			}),
	};
}

async function detectGpus(): Promise<GpuController[]> {
	const { controllers = [] } = await si.graphics();
	return controllers;
}

function hasNvidia(gpus: readonly GpuController[]): boolean {
	let gpu = "";
	for (const controller of gpus) {
		gpu += `${controller.vendor ?? ""} ${controller.model ?? ""} `;
	}
	return gpu.toLowerCase().includes("nvidia");
}
