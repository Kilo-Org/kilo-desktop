import { execFile } from "node:child_process";

import si from "systeminformation";

import type { LocalInferenceUsage } from "../contracts/schemas.js";

interface UsageSamples {
	readonly systemCpuPercent: number;
	readonly systemCpuSpeedGHz: number | null;
	readonly systemGpuMemoryUsedBytes: number | null;
	readonly systemGpuMemoryTotalBytes: number | null;
	readonly memory: {
		readonly total: number;
		readonly available: number;
	};
}

const GPU_PROBE_TIMEOUT_MS = 2_000;
const GPU_PROBE_MAX_BUFFER_BYTES = 1024 * 1024;
const GPU_SAMPLE_INTERVAL_MS = 5_000;
const MEBIBYTE = 1024 ** 2;

interface GpuUsageSample {
	readonly memoryUsedBytes: number | null;
	readonly memoryTotalBytes: number | null;
}

export interface LocalInferenceUsageCollector {
	read(): Promise<LocalInferenceUsage>;
	dispose(): void;
}

export interface TieredUsageSampler {
	read(): Promise<LocalInferenceUsage>;
}

interface TieredUsageSamplerOptions {
	readonly now?: () => number;
	readonly gpuIntervalMs?: number;
	readonly readGpu?: () => Promise<GpuUsageSample>;
	readonly readFreshUsage?: (gpu: GpuUsageSample) => Promise<LocalInferenceUsage>;
}

interface LocalInferenceUsageCollectorOptions {
	readonly platform?: NodeJS.Platform;
	readonly startPowerShell?: () => void;
	readonly releasePowerShell?: () => void;
	readonly readUsage?: () => Promise<LocalInferenceUsage>;
}

/**
 * Owns the Windows PowerShell process used by systeminformation's dynamic
 * probes. It starts lazily with the first usage sample, remains shared by all
 * later samples, and is released exactly once with the plugin lifecycle.
 */
export function createLocalInferenceUsageCollector(
	options: LocalInferenceUsageCollectorOptions = {},
): LocalInferenceUsageCollector {
	const platform = options.platform ?? process.platform;
	const startPowerShell = options.startPowerShell ?? (() => si.powerShellStart());
	const releasePowerShell = options.releasePowerShell ?? (() => si.powerShellRelease());
	const readUsage = options.readUsage ?? createTieredUsageSampler().read;
	let powerShellStarted = false;

	return {
		read() {
			if (platform === "win32" && !powerShellStarted) {
				startPowerShell();
				powerShellStarted = true;
			}
			return readUsage();
		},
		dispose() {
			if (!powerShellStarted) return;
			powerShellStarted = false;
			releasePowerShell();
		},
	};
}

function createExpiringAsyncReader<T>(
	read: () => Promise<T>,
	intervalMs: number,
	now: () => number,
): () => Promise<T> {
	let cached: { value: T; expiresAt: number } | undefined;
	let inFlight: Promise<T> | undefined;

	return () => {
		if (cached && now() < cached.expiresAt) return Promise.resolve(cached.value);
		if (inFlight) return inFlight;

		inFlight = read()
			.then((value) => {
				cached = { value, expiresAt: now() + intervalMs };
				return value;
			})
			.finally(() => {
				inFlight = undefined;
			});
		return inFlight;
	};
}

/**
 * Samples cheap CPU and memory data on every read while retaining the expensive
 * GPU snapshot at a slower cadence. Concurrent reads share one in-flight sample.
 */
export function createTieredUsageSampler(
	options: TieredUsageSamplerOptions = {},
): TieredUsageSampler {
	const now = options.now ?? Date.now;
	const readGpu = createExpiringAsyncReader(
		options.readGpu ?? readSystemGpuUsage,
		options.gpuIntervalMs ?? GPU_SAMPLE_INTERVAL_MS,
		now,
	);
	const readFreshUsage = options.readFreshUsage ?? readUsageWithSnapshots;
	let inFlight: Promise<LocalInferenceUsage> | undefined;

	return {
		read() {
			if (inFlight) return inFlight;

			const pending = readGpu()
				.then((gpu) => readFreshUsage(gpu))
				.finally(() => {
					if (inFlight === pending) inFlight = undefined;
				});
			inFlight = pending;
			return pending;
		},
	};
}

function bounded(value: number, maximum: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(Math.max(value, 0), maximum);
}

export function appleGpuMemoryUsedBytesFromIoreg(output: string): number | null {
	const values = [...output.matchAll(/"In use system memory"\s*=\s*(\d+)/g)]
		.map((match) => Number(match[1]))
		.filter(Number.isFinite);
	return values.length === 0 ? null : Math.max(...values);
}

export function gpuMemoryBytesFromControllers(
	controllers: readonly {
		readonly memoryTotal?: number | null;
		readonly memoryUsed?: number | null;
		readonly memoryFree?: number | null;
	}[],
): Pick<GpuUsageSample, "memoryUsedBytes" | "memoryTotalBytes"> {
	let totalMebibytes = 0;
	let usedMebibytes = 0;
	let supportedControllers = 0;

	for (const controller of controllers) {
		const total = controller.memoryTotal;
		if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) continue;
		const reportedUsed = controller.memoryUsed;
		const reportedFree = controller.memoryFree;
		const used =
			typeof reportedUsed === "number" && Number.isFinite(reportedUsed)
				? reportedUsed
				: typeof reportedFree === "number" && Number.isFinite(reportedFree)
					? total - reportedFree
					: null;
		if (used === null) continue;

		totalMebibytes += total;
		usedMebibytes += bounded(used, total);
		supportedControllers += 1;
	}

	if (supportedControllers === 0) {
		return { memoryUsedBytes: null, memoryTotalBytes: null };
	}
	return {
		memoryUsedBytes: Math.trunc(usedMebibytes * MEBIBYTE),
		memoryTotalBytes: Math.trunc(totalMebibytes * MEBIBYTE),
	};
}

function readAppleGpuUsage(): Promise<GpuUsageSample> {
	return new Promise((resolve) => {
		execFile(
			"/usr/sbin/ioreg",
			["-r", "-c", "AGXAccelerator"],
			{
				encoding: "utf8",
				maxBuffer: GPU_PROBE_MAX_BUFFER_BYTES,
				timeout: GPU_PROBE_TIMEOUT_MS,
			},
			(error, stdout) =>
				resolve(
					error
						? { memoryUsedBytes: null, memoryTotalBytes: null }
						: {
								memoryUsedBytes: appleGpuMemoryUsedBytesFromIoreg(stdout),
								memoryTotalBytes: null,
							},
				),
		);
	});
}

async function readSystemGpuUsage(): Promise<GpuUsageSample> {
	try {
		if (process.platform === "darwin") return await readAppleGpuUsage();
		const graphics = await si.graphics();
		return gpuMemoryBytesFromControllers(graphics.controllers);
	} catch {
		return { memoryUsedBytes: null, memoryTotalBytes: null };
	}
}

async function readSystemCpuSpeedGHz(): Promise<number | null> {
	try {
		const speed = await si.cpuCurrentSpeed();
		return Number.isFinite(speed.avg) && speed.avg > 0 ? speed.avg : null;
	} catch {
		return null;
	}
}

async function readSystemCpuPercent(): Promise<number> {
	try {
		return (await si.currentLoad()).currentLoad;
	} catch {
		return 0;
	}
}

async function readSystemMemory(): Promise<UsageSamples["memory"]> {
	try {
		const memory = await si.mem();
		return { total: memory.total, available: memory.available };
	} catch {
		return { total: 0, available: 0 };
	}
}

export function usageFromSamples(samples: UsageSamples): LocalInferenceUsage {
	const memoryTotalBytes = Math.trunc(bounded(samples.memory.total, Number.MAX_SAFE_INTEGER));
	const memoryAvailableBytes = bounded(samples.memory.available, memoryTotalBytes);
	const hasGpuMemory =
		samples.systemGpuMemoryUsedBytes !== null &&
		samples.systemGpuMemoryTotalBytes !== null &&
		samples.systemGpuMemoryTotalBytes > 0;
	const gpuMemoryTotalBytes = hasGpuMemory
		? Math.trunc(bounded(samples.systemGpuMemoryTotalBytes ?? 0, Number.MAX_SAFE_INTEGER))
		: null;
	const gpuMemoryUsedBytes =
		hasGpuMemory && gpuMemoryTotalBytes !== null
			? Math.min(
					Math.trunc(bounded(samples.systemGpuMemoryUsedBytes ?? 0, Number.MAX_SAFE_INTEGER)),
					gpuMemoryTotalBytes,
				)
			: null;

	return {
		system: {
			cpuPercent: bounded(samples.systemCpuPercent, 100),
			cpuSpeedGHz:
				samples.systemCpuSpeedGHz === null
					? null
					: bounded(samples.systemCpuSpeedGHz, Number.MAX_SAFE_INTEGER),
			gpuMemoryUsedBytes,
			gpuMemoryTotalBytes,
			memoryUsedBytes: memoryTotalBytes - memoryAvailableBytes,
			memoryTotalBytes,
		},
	};
}

async function readUsageWithSnapshots(gpu: GpuUsageSample): Promise<LocalInferenceUsage> {
	const [systemCpuPercent, cpuSpeedGHz, memory] = await Promise.all([
		readSystemCpuPercent(),
		readSystemCpuSpeedGHz(),
		readSystemMemory(),
	]);
	const systemGpuMemoryTotalBytes =
		process.platform === "darwin" && gpu.memoryUsedBytes !== null
			? memory.total
			: gpu.memoryTotalBytes;
	return usageFromSamples({
		systemCpuPercent,
		systemCpuSpeedGHz: cpuSpeedGHz,
		systemGpuMemoryUsedBytes: gpu.memoryUsedBytes,
		systemGpuMemoryTotalBytes,
		memory,
	});
}
