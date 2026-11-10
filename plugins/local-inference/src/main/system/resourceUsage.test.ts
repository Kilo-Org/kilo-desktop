import si from "systeminformation";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalInferenceUsage } from "../../contracts";

import {
	appleGpuMemoryUsedBytesFromIoreg,
	createLocalInferenceUsageCollector,
	createTieredUsageSampler,
	gpuMemoryBytesFromControllers,
	usageFromSamples,
} from "./resourceUsage";

const GIBIBYTE = 1024 ** 3;

const EMPTY_USAGE: LocalInferenceUsage = {
	system: {
		cpuPercent: 0,
		cpuSpeedGHz: null,
		gpuMemoryUsedBytes: null,
		gpuMemoryTotalBytes: null,
		memoryUsedBytes: 0,
		memoryTotalBytes: 0,
	},
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("LocalInferenceUsageCollector", () => {
	it("reuses one PowerShell host across Windows samples and releases it on disposal", async () => {
		const startPowerShell = vi.fn();
		const releasePowerShell = vi.fn();
		const readUsage = vi.fn(async () => EMPTY_USAGE);
		const collector = createLocalInferenceUsageCollector({
			platform: "win32",
			startPowerShell,
			releasePowerShell,
			readUsage,
		});

		await collector.read();
		await collector.read();
		collector.dispose();
		collector.dispose();

		expect(startPowerShell).toHaveBeenCalledTimes(1);
		expect(readUsage).toHaveBeenCalledTimes(2);
		expect(releasePowerShell).toHaveBeenCalledTimes(1);
	});
});

describe("TieredUsageSampler", () => {
	it("returns an empty snapshot when system probes fail", async () => {
		vi.spyOn(si, "currentLoad").mockRejectedValue(new Error("CPU unavailable"));
		vi.spyOn(si, "cpuCurrentSpeed").mockRejectedValue(new Error("CPU speed unavailable"));
		vi.spyOn(si, "mem").mockRejectedValue(new Error("memory unavailable"));
		const sampler = createTieredUsageSampler({
			readGpu: async () => ({ memoryUsedBytes: null, memoryTotalBytes: null }),
		});

		await expect(sampler.read()).resolves.toEqual(EMPTY_USAGE);
	});

	it("refreshes GPU snapshots on a slower cadence", async () => {
		let now = 0;
		const readGpu = vi.fn(async () => ({
			memoryUsedBytes: null,
			memoryTotalBytes: null,
		}));
		const readFreshUsage = vi.fn(async () => EMPTY_USAGE);
		const sampler = createTieredUsageSampler({
			now: () => now,
			gpuIntervalMs: 5_000,
			readGpu,
			readFreshUsage,
		});

		await sampler.read();
		now = 1_000;
		await sampler.read();
		now = 2_000;
		await sampler.read();
		now = 5_000;
		await sampler.read();

		expect(readGpu).toHaveBeenCalledTimes(2);
		expect(readFreshUsage).toHaveBeenCalledTimes(4);
	});

	it("coalesces concurrent requests", async () => {
		const finishSamples: Array<(usage: LocalInferenceUsage) => void> = [];
		const readGpu = vi.fn(async () => ({
			memoryUsedBytes: null,
			memoryTotalBytes: null,
		}));
		const readFreshUsage = vi.fn(
			() =>
				new Promise<LocalInferenceUsage>((resolve) => {
					finishSamples.push(resolve);
				}),
		);
		const sampler = createTieredUsageSampler({ readGpu, readFreshUsage });

		const first = sampler.read();
		const second = sampler.read();
		await vi.waitFor(() => expect(readFreshUsage).toHaveBeenCalled());
		for (const finishSample of finishSamples) finishSample(EMPTY_USAGE);
		await Promise.all([first, second]);

		expect(readGpu).toHaveBeenCalledTimes(1);
		expect(readFreshUsage).toHaveBeenCalledTimes(1);
	});
});

describe("usageFromSamples", () => {
	it("returns the sampled system usage", () => {
		expect(
			usageFromSamples({
				systemCpuPercent: 62.5,
				systemCpuSpeedGHz: 3.5,
				systemGpuMemoryUsedBytes: 2 * GIBIBYTE,
				systemGpuMemoryTotalBytes: 8 * GIBIBYTE,
				memory: { total: 16 * GIBIBYTE, available: 6 * GIBIBYTE },
			}),
		).toEqual({
			system: {
				cpuPercent: 62.5,
				cpuSpeedGHz: 3.5,
				gpuMemoryUsedBytes: 2 * GIBIBYTE,
				gpuMemoryTotalBytes: 8 * GIBIBYTE,
				memoryUsedBytes: 10 * GIBIBYTE,
				memoryTotalBytes: 16 * GIBIBYTE,
			},
		});
	});

	it("bounds invalid system values", () => {
		expect(
			usageFromSamples({
				systemCpuPercent: 140,
				systemCpuSpeedGHz: -2,
				systemGpuMemoryUsedBytes: 10 * GIBIBYTE,
				systemGpuMemoryTotalBytes: 8 * GIBIBYTE,
				memory: { total: 8 * GIBIBYTE, available: 12 * GIBIBYTE },
			}),
		).toEqual({
			system: {
				cpuPercent: 100,
				cpuSpeedGHz: 0,
				gpuMemoryUsedBytes: 8 * GIBIBYTE,
				gpuMemoryTotalBytes: 8 * GIBIBYTE,
				memoryUsedBytes: 0,
				memoryTotalBytes: 8 * GIBIBYTE,
			},
		});
	});

	it("keeps an unavailable GPU reading distinct from zero utilization", () => {
		const result = usageFromSamples({
			systemCpuPercent: 0,
			systemCpuSpeedGHz: null,
			systemGpuMemoryUsedBytes: null,
			systemGpuMemoryTotalBytes: null,
			memory: { total: 8 * GIBIBYTE, available: 4 * GIBIBYTE },
		});

		expect(result.system.gpuMemoryUsedBytes).toBeNull();
		expect(result.system.gpuMemoryTotalBytes).toBeNull();
	});
});

describe("GPU memory parsing", () => {
	it("reads the busiest Apple GPU accelerator memory from IORegistry output", () => {
		const output = `
			"PerformanceStatistics" = {"Device Utilization %"=18,"In use system memory"=1073741824}
			"PerformanceStatistics" = {"Device Utilization %"=42,"In use system memory"=2147483648}
		`;

		expect(appleGpuMemoryUsedBytesFromIoreg(output)).toBe(2 * GIBIBYTE);
		expect(appleGpuMemoryUsedBytesFromIoreg("no compatible accelerator")).toBeNull();
	});

	it("sums memory across supported graphics controllers", () => {
		expect(
			gpuMemoryBytesFromControllers([
				{ memoryTotal: 8192, memoryUsed: 2048 },
				{ memoryTotal: 4096, memoryFree: 3072 },
			]),
		).toEqual({
			memoryUsedBytes: 3 * GIBIBYTE,
			memoryTotalBytes: 12 * GIBIBYTE,
		});
		expect(gpuMemoryBytesFromControllers([{}])).toEqual({
			memoryUsedBytes: null,
			memoryTotalBytes: null,
		});
	});
});
