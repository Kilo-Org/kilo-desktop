import { access } from "node:fs/promises";
import os from "node:os";

import si from "systeminformation";

// Anaconda's 0.3.x and 0.4.x builds ship without subprocess support, which
// llama-server's router mode requires. Windows ARM64 has no router-capable
// build before 0.5.0; move the other platforms once 0.5.0 is published for them.
const CPU_SPEC = "anaconda::llama.cpp==0.0.10068=cpu_*";
const CUDA_SPEC = "anaconda::llama.cpp==0.0.10068=cuda*";
const METAL_SPEC = "anaconda::llama.cpp==0.0.10068=mps_*";
const WINDOWS_ARM64_CPU_SPEC = "anaconda::llama.cpp==0.5.0=cpu_*";
const WINDOWS_ARM64_CUDA_SPEC = "anaconda::llama.cpp==0.5.0=cuda*";
const INTEL_MAC_SPEC = "conda-forge::llama.cpp>=9222";
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
	}): Promise<{ prefixPath: string }>;
	executable(prefixPath: string, name: string): string;
}

export interface ResolveLlamaExecutableOptions {
	readonly conda: LlamaCondaRuntime | null | undefined;
	readonly host: LlamaHost;
	readonly overridePath?: string;
	readonly accessFile?: (filePath: string) => Promise<void>;
	readonly logger?: { warn(message: string): void };
}

/**
 * Picks llama.cpp conda builds using NVIDIA presence (vendor+model string)
 * plus OS/arch, then CUDA → Metal → CPU.
 * Install tries that ordered list and keeps going when a flavor fails so a
 * missing CUDA/Metal package still yields a working CPU server.
 */
export function llamaPackageSpecs(host: LlamaHost): string[] {
	if (host.platform === "darwin") {
		if (host.arch === "x64") return [INTEL_MAC_SPEC, CPU_SPEC];
		const darwin = Number.parseInt(host.release.split(".")[0] ?? "", 10);
		if (host.arch === "arm64" && darwin >= 16) return [METAL_SPEC, CPU_SPEC];
		return [CPU_SPEC];
	}
	if (host.platform === "win32" && host.arch === "arm64") {
		return hasNvidia(host.gpus)
			? [WINDOWS_ARM64_CUDA_SPEC, WINDOWS_ARM64_CPU_SPEC]
			: [WINDOWS_ARM64_CPU_SPEC];
	}
	if ((host.platform === "win32" || host.platform === "linux") && hasNvidia(host.gpus)) {
		return [CUDA_SPEC, CPU_SPEC];
	}
	return [CPU_SPEC];
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
	const override = options.overridePath?.trim();
	if (override) {
		await accessFile(override);
		return override;
	}
	if (!options.conda) {
		throw new Error("The local inference runtime is unavailable.");
	}
	const conda = options.conda;
	const specs = llamaPackageSpecs(options.host);
	let lastError: unknown;
	for (const spec of specs) {
		try {
			const runtime = await conda.ensureEnvironment({
				name: ENV_NAME,
				packages: [spec],
			});
			const executable = conda.executable(runtime.prefixPath, SERVER_NAME);
			await accessFile(executable);
			return executable;
		} catch (error) {
			lastError = error;
			options.logger?.warn(
				`Could not install llama.cpp build "${spec}": ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	throw lastError instanceof Error
		? lastError
		: new Error("Local inference could not install llama.cpp.");
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
