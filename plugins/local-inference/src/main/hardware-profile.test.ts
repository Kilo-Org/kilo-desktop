import { describe, expect, it, vi } from "vitest";

import { createHardwareProfileReader, hardwareProfileFromSnapshots } from "./hardware-profile.js";

const GIBIBYTE = 1024 ** 3;

describe("hardware profiles", () => {
	it("uses unified memory and known bandwidth for Apple silicon", () => {
		expect(
			hardwareProfileFromSnapshots(
				{
					cpu: { brand: "M4 Pro", manufacturer: "Apple" },
					memory: { total: 24 * GIBIBYTE },
					graphics: { controllers: [] },
				},
				"darwin",
			),
		).toEqual({
			name: "Apple M4 Pro",
			kind: "unified-memory",
			accelerator: "metal",
			memoryTotalBytes: 24 * GIBIBYTE,
			systemMemoryTotalBytes: 24 * GIBIBYTE,
			memoryBandwidthGBps: 273,
		});
	});

	it("selects the discrete GPU with the most memory", () => {
		const profile = hardwareProfileFromSnapshots(
			{
				cpu: { brand: "Ryzen 9", manufacturer: "AMD" },
				memory: { total: 64 * GIBIBYTE },
				graphics: {
					controllers: [
						{ vendor: "Intel", model: "Integrated", vram: 512, vramDynamic: true, bus: "" },
						{
							vendor: "NVIDIA",
							model: "NVIDIA GeForce RTX 4090",
							vram: 24 * 1024,
							vramDynamic: false,
							bus: "",
						},
					],
				},
			},
			"linux",
		);

		expect(profile).toMatchObject({
			name: "NVIDIA GeForce RTX 4090",
			kind: "dedicated-gpu",
			accelerator: "cuda",
			memoryTotalBytes: 24 * GIBIBYTE,
			memoryBandwidthGBps: 1_008,
		});
	});

	it("shares one immutable snapshot across concurrent reads", async () => {
		const readSnapshots = vi.fn(async () => ({
			cpu: { brand: "Generic CPU", manufacturer: "Generic" },
			memory: { total: 16 * GIBIBYTE },
			graphics: { controllers: [] },
		}));
		const reader = createHardwareProfileReader({ platform: "linux", readSnapshots });

		const [first, second] = await Promise.all([reader.read(), reader.read()]);

		expect(first).toBe(second);
		expect(readSnapshots).toHaveBeenCalledOnce();
		expect(first).toMatchObject({ kind: "system-memory", accelerator: "cpu" });
	});

	it("retries hardware detection after a transient failure", async () => {
		const readSnapshots = vi
			.fn()
			.mockRejectedValueOnce(new Error("Hardware probe failed"))
			.mockResolvedValueOnce({
				cpu: { brand: "Generic CPU", manufacturer: "Generic" },
				memory: { total: 16 * GIBIBYTE },
				graphics: { controllers: [] },
			});
		const reader = createHardwareProfileReader({ platform: "linux", readSnapshots });

		await expect(reader.read()).rejects.toThrow("Hardware probe failed");
		await expect(reader.read()).resolves.toMatchObject({
			kind: "system-memory",
			accelerator: "cpu",
		});
		expect(readSnapshots).toHaveBeenCalledTimes(2);
	});

	it("uses reported controller memory and CanIRun bandwidth for a non-NVIDIA GPU", () => {
		const profile = hardwareProfileFromSnapshots(
			{
				cpu: { brand: "Ryzen 7", manufacturer: "AMD" },
				memory: { total: 32 * GIBIBYTE },
				graphics: {
					controllers: [
						{
							vendor: "AMD",
							model: "Radeon RX 7900 XTX",
							vram: null,
							vramDynamic: false,
							memoryTotal: 24 * 1024,
							bus: "",
						},
					],
				},
			},
			"win32",
		);

		expect(profile).toMatchObject({
			name: "Radeon RX 7900 XTX",
			accelerator: "vulkan",
			memoryTotalBytes: 24 * GIBIBYTE,
			memoryBandwidthGBps: 960,
		});
	});

	it("recognizes DGX Spark from its GB10 system identity and unified memory", () => {
		const profile = hardwareProfileFromSnapshots(
			{
				system: { manufacturer: "NVIDIA", model: "GB10-1-A" },
				cpu: { brand: "NVIDIA Grace", manufacturer: "NVIDIA" },
				memory: { total: 128 * GIBIBYTE },
				graphics: { controllers: [] },
			},
			"linux",
		);

		expect(profile).toEqual({
			name: "DGX Spark",
			kind: "unified-memory",
			accelerator: "cuda",
			memoryTotalBytes: 128 * GIBIBYTE,
			systemMemoryTotalBytes: 128 * GIBIBYTE,
			memoryBandwidthGBps: 273,
		});
	});

	it("uses system memory and catalog bandwidth for a dynamic Intel GPU", () => {
		const profile = hardwareProfileFromSnapshots(
			{
				cpu: { brand: "Intel Core Ultra", manufacturer: "Intel" },
				memory: { total: 32 * GIBIBYTE },
				graphics: {
					controllers: [
						{
							vendor: "Intel",
							model: "Intel Iris Xe Graphics",
							vram: 512,
							vramDynamic: true,
							bus: "",
						},
					],
				},
			},
			"linux",
		);

		expect(profile).toMatchObject({
			kind: "system-memory",
			accelerator: "vulkan",
			memoryTotalBytes: 32 * GIBIBYTE,
			memoryBandwidthGBps: 68,
		});
	});

	it("recognizes a unified-memory Ryzen AI Max profile from the CPU identity", () => {
		const profile = hardwareProfileFromSnapshots(
			{
				system: { manufacturer: "Framework", model: "Desktop" },
				cpu: { brand: "AMD Ryzen AI MAX+ 395", manufacturer: "AMD" },
				memory: { total: 128 * GIBIBYTE },
				graphics: { controllers: [] },
			},
			"linux",
		);

		expect(profile).toMatchObject({
			name: "Ryzen AI MAX+ 395",
			kind: "unified-memory",
			accelerator: "vulkan",
			memoryTotalBytes: 128 * GIBIBYTE,
			memoryBandwidthGBps: 256,
		});
	});

	it("recognizes Raspberry Pi variants from the machine model and installed memory", () => {
		const profile = hardwareProfileFromSnapshots(
			{
				system: { manufacturer: "Raspberry Pi Foundation", model: "Raspberry Pi 5 Model B" },
				cpu: { brand: "Cortex-A76", manufacturer: "ARM" },
				memory: { total: 8 * GIBIBYTE },
				graphics: { controllers: [] },
			},
			"linux",
		);

		expect(profile).toMatchObject({
			name: "Raspberry Pi 5 (8 GB)",
			kind: "system-memory",
			memoryBandwidthGBps: 32,
		});
	});

	it("falls back to the manufacturer name for CPU-only machines", () => {
		const profile = hardwareProfileFromSnapshots(
			{
				cpu: { brand: "", manufacturer: "Acme" },
				memory: { total: 8 * GIBIBYTE },
				graphics: {
					controllers: [
						{ vendor: "Acme", model: "Integrated", vram: 0, vramDynamic: false, bus: "" },
					],
				},
			},
			"linux",
		);

		expect(profile).toEqual({
			name: "Acme",
			kind: "system-memory",
			accelerator: "cpu",
			memoryTotalBytes: 8 * GIBIBYTE,
			systemMemoryTotalBytes: 8 * GIBIBYTE,
			memoryBandwidthGBps: 50,
		});
	});
});
