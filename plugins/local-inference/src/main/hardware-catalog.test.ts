import { describe, expect, it } from "vitest";

import {
	APPLE_DB,
	GPU_DB,
	matchCanIRunApple,
	matchCanIRunGpu,
	matchCanIRunMobile,
	matchCanIRunSbc,
	MOBILE_GPU_DB,
	SBC_DB,
} from "./hardware-catalog.js";

describe("CanIRun hardware catalog", () => {
	it("contains every device preset from CanIRun db81865", () => {
		expect(Object.keys(GPU_DB)).toHaveLength(227);
		expect(Object.keys(APPLE_DB)).toHaveLength(20);
		expect(Object.keys(MOBILE_GPU_DB)).toHaveLength(40);
		expect(Object.keys(SBC_DB)).toHaveLength(5);
		expect(Object.keys(GPU_DB).filter((name) => matchCanIRunGpu(name)?.name !== name)).toEqual([]);
		expect(Object.keys(APPLE_DB).filter((name) => matchCanIRunApple(name)?.name !== name)).toEqual(
			[],
		);
		expect(
			Object.keys(MOBILE_GPU_DB).filter((name) => matchCanIRunMobile(name)?.name !== name),
		).toEqual([]);
		expect(Object.keys(SBC_DB).filter((name) => matchCanIRunSbc(name)?.name !== name)).toEqual([]);
	});

	it("matches the longest GPU name across consumer, datacenter, AMD, and Intel devices", () => {
		expect(matchCanIRunGpu("NVIDIA GeForce RTX 4090 Laptop GPU")).toMatchObject({
			name: "RTX 4090 Laptop",
			vram: 16,
			bw: 576,
		});
		expect(matchCanIRunGpu("NVIDIA H100 PCIe")).toMatchObject({ name: "H100", bw: 3_350 });
		expect(matchCanIRunGpu("AMD Radeon RX 7900 XTX")).toMatchObject({
			name: "RX 7900 XTX",
			bw: 960,
		});
		expect(matchCanIRunGpu("Intel Arc A770 Graphics")).toMatchObject({
			name: "Arc A770",
			bw: 560,
		});
	});

	it("recognizes DGX Spark by its product and GB10 hardware names", () => {
		const expected = { name: "DGX Spark", vram: 128, bw: 273, cores: 6_144 };
		expect(matchCanIRunGpu("NVIDIA DGX Spark")).toEqual(expected);
		expect(matchCanIRunGpu("NVIDIA GB10-1-A")).toEqual(expected);
	});

	it("covers Apple, mobile, and Raspberry Pi presets", () => {
		expect(matchCanIRunApple("Apple M4 Max")).toMatchObject({ name: "m4 max", bw: 546 });
		expect(matchCanIRunMobile("ANGLE Adreno 830")).toMatchObject({
			name: "Adreno 830",
			bw: 90,
		});
		expect(matchCanIRunSbc("Raspberry Pi 5 Model B", 8)).toEqual({
			name: "Raspberry Pi 5 (8 GB)",
			ram: 8,
			bw: 32,
		});
	});
});
