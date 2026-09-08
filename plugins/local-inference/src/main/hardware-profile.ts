import si, { type Systeminformation } from "systeminformation";

import type { LocalInferenceHardwareProfile } from "../contracts/schemas.js";
import {
	matchCanIRunApple,
	matchCanIRunGpu,
	matchCanIRunMobile,
	matchCanIRunSbc,
} from "./hardware-catalog.js";

const MEBIBYTE = 1024 ** 2;
const GIBIBYTE = 1024 ** 3;
const DEFAULT_SYSTEM_MEMORY_BANDWIDTH_GBPS = 50;

interface HardwareSnapshots {
	readonly system?: Pick<Systeminformation.SystemData, "manufacturer" | "model">;
	readonly cpu: Pick<Systeminformation.CpuData, "brand" | "manufacturer">;
	readonly memory: Pick<Systeminformation.MemData, "total">;
	readonly graphics: Pick<Systeminformation.GraphicsData, "controllers">;
}

export interface HardwareProfileReader {
	read(): Promise<LocalInferenceHardwareProfile>;
}

interface HardwareProfileReaderOptions {
	readonly platform?: NodeJS.Platform;
	readonly readSnapshots?: () => Promise<HardwareSnapshots>;
}
function controllerMemoryBytes(controller: Systeminformation.GraphicsControllerData): number {
	const mebibytes =
		typeof controller.memoryTotal === "number" && controller.memoryTotal > 0
			? controller.memoryTotal
			: (controller.vram ?? 0);
	return Number.isFinite(mebibytes) && mebibytes > 0 ? Math.trunc(mebibytes * MEBIBYTE) : 0;
}

function systemName(snapshots: HardwareSnapshots): string {
	return [snapshots.system?.manufacturer, snapshots.system?.model]
		.filter((part): part is string => Boolean(part?.trim()))
		.join(" ")
		.trim();
}

function isCudaDevice(name: string, vendor: string): boolean {
	return (
		/nvidia/i.test(`${vendor} ${name}`) ||
		/^(?:RTX|GTX|Quadro|T\d{3,4}|B200|H200|A100|H100|GB300|GH200|DGX Spark|L40S|L20|L4|A10G?|T4|Tesla)/i.test(
			name,
		)
	);
}

function isUnifiedGpu(name: string): boolean {
	return name === "DGX Spark" || name === "Ryzen AI MAX+ 395";
}

interface GraphicsCandidate {
	readonly name: string;
	readonly vendor: string;
	readonly kind: LocalInferenceHardwareProfile["kind"];
	readonly accelerator: LocalInferenceHardwareProfile["accelerator"];
	readonly memoryTotalBytes: number;
	readonly memoryBandwidthGBps: number | null;
}

function graphicsCandidate(
	name: string,
	vendor: string,
	reportedMemoryBytes: number,
	systemMemoryBytes: number,
): GraphicsCandidate | null {
	const gpu = matchCanIRunGpu(name);
	const mobile = matchCanIRunMobile(name);
	if (!gpu && !mobile && reportedMemoryBytes === 0) return null;

	if (mobile) {
		return {
			name,
			vendor,
			kind: "mobile",
			accelerator: "vulkan",
			memoryTotalBytes: systemMemoryBytes,
			memoryBandwidthGBps: mobile.bw,
		};
	}

	const catalogName = gpu?.name ?? name;
	const unified = gpu ? isUnifiedGpu(gpu.name) : false;
	const integrated = gpu?.vram === 0;
	const kind = unified ? "unified-memory" : integrated ? "system-memory" : "dedicated-gpu";
	const catalogMemoryBytes = (gpu?.vram ?? 0) * GIBIBYTE;
	const memoryTotalBytes =
		kind === "dedicated-gpu" ? reportedMemoryBytes || catalogMemoryBytes : systemMemoryBytes;

	return {
		name: unified ? catalogName : name,
		vendor,
		kind,
		accelerator: isCudaDevice(catalogName, vendor) ? "cuda" : "vulkan",
		memoryTotalBytes,
		memoryBandwidthGBps: gpu?.bw ?? null,
	};
}

export function hardwareProfileFromSnapshots(
	snapshots: HardwareSnapshots,
	platform: NodeJS.Platform,
): LocalInferenceHardwareProfile {
	const cpuName = snapshots.cpu.brand.trim() || snapshots.cpu.manufacturer.trim() || "CPU";
	const isAppleSilicon = platform === "darwin" && /\bM\d/i.test(cpuName);

	if (isAppleSilicon) {
		const name = /^Apple\b/i.test(cpuName) ? cpuName : `Apple ${cpuName}`;
		const apple = matchCanIRunApple(name);
		return {
			name,
			kind: "unified-memory",
			accelerator: "metal",
			memoryTotalBytes: snapshots.memory.total,
			systemMemoryTotalBytes: snapshots.memory.total,
			memoryBandwidthGBps: apple?.bw ?? null,
		};
	}

	const candidates = snapshots.graphics.controllers.flatMap((controller) => {
		const name = controller.model || controller.name || `${controller.vendor} GPU`;
		const candidate = graphicsCandidate(
			name,
			controller.vendor,
			controller.vramDynamic ? 0 : controllerMemoryBytes(controller),
			snapshots.memory.total,
		);
		return candidate ? [candidate] : [];
	});
	const machineName = systemName(snapshots);
	const systemGpu = matchCanIRunGpu(`${machineName} ${cpuName}`);
	if (systemGpu && !candidates.some(({ name }) => matchCanIRunGpu(name)?.name === systemGpu.name)) {
		const candidate = graphicsCandidate(
			systemGpu.name,
			snapshots.system?.manufacturer ?? "",
			0,
			snapshots.memory.total,
		);
		if (candidate) candidates.push(candidate);
	}
	const controller = candidates.sort(
		(left, right) => right.memoryTotalBytes - left.memoryTotalBytes,
	)[0];

	if (controller) {
		return {
			name: controller.name,
			kind: controller.kind,
			accelerator: controller.accelerator,
			memoryTotalBytes: controller.memoryTotalBytes,
			systemMemoryTotalBytes: snapshots.memory.total,
			memoryBandwidthGBps: controller.memoryBandwidthGBps,
		};
	}

	const sbc = machineName ? matchCanIRunSbc(machineName, snapshots.memory.total / GIBIBYTE) : null;
	if (sbc) {
		return {
			name: sbc.name,
			kind: "system-memory",
			accelerator: "cpu",
			memoryTotalBytes: snapshots.memory.total,
			systemMemoryTotalBytes: snapshots.memory.total,
			memoryBandwidthGBps: sbc.bw,
		};
	}

	return {
		name: cpuName,
		kind: "system-memory",
		accelerator: "cpu",
		memoryTotalBytes: snapshots.memory.total,
		systemMemoryTotalBytes: snapshots.memory.total,
		memoryBandwidthGBps: DEFAULT_SYSTEM_MEMORY_BANDWIDTH_GBPS,
	};
}

async function readHardwareSnapshots(): Promise<HardwareSnapshots> {
	const [system, cpu, memory, graphics] = await Promise.all([
		si.system().catch(() => ({ manufacturer: "", model: "" })),
		si.cpu(),
		si.mem(),
		si.graphics().catch(() => ({ controllers: [], displays: [] })),
	]);
	return { system, cpu, memory, graphics };
}

/**
 * Owns the immutable hardware snapshot used by catalog recommendations. The
 * first caller performs detection; concurrent and later callers share that
 * result so opening the catalog never repeatedly invokes platform probes.
 */
export function createHardwareProfileReader(
	options: HardwareProfileReaderOptions = {},
): HardwareProfileReader {
	const platform = options.platform ?? process.platform;
	const readSnapshots = options.readSnapshots ?? readHardwareSnapshots;
	let profile: Promise<LocalInferenceHardwareProfile> | undefined;

	return {
		read() {
			profile ??= readSnapshots()
				.then((snapshots) => hardwareProfileFromSnapshots(snapshots, platform))
				.catch((error: unknown) => {
					profile = undefined;
					throw error;
				});
			return profile;
		},
	};
}
