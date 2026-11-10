// Device specifications synchronized with canirun.ai commit db81865.
// Keep the four catalogs complete so local estimates cover every CanIRun preset.

import { APPLE_DB } from "./data/apple";
import { GPU_DB } from "./data/gpu";
import { MOBILE_GPU_DB } from "./data/mobile";
import { SBC_DB } from "./data/sbc";

type GpuDeviceSpec = (typeof GPU_DB)[string];
type AppleDeviceSpec = (typeof APPLE_DB)[string];
type MobileDeviceSpec = (typeof MOBILE_GPU_DB)[string];
type SbcDeviceSpec = (typeof SBC_DB)[string];

export interface MatchedGpuDevice extends GpuDeviceSpec {
	readonly name: string;
}

export interface MatchedAppleDevice extends AppleDeviceSpec {
	readonly name: string;
}

export interface MatchedMobileDevice extends MobileDeviceSpec {
	readonly name: string;
}

export interface MatchedSbcDevice extends SbcDeviceSpec {
	readonly name: string;
}

export const CANIRUN_DEVICE_COUNTS = {
	gpu: 227,
	apple: 20,
	mobile: 40,
	sbc: 5,
} as const;

const GPU_ALIASES: ReadonlyArray<readonly [RegExp, keyof typeof GPU_DB]> = [
	[/\bGB10(?:-1(?:-A)?)?\b/i, "DGX Spark"],
];

const APPLE_BANDWIDTH_OVERRIDES: Readonly<Record<string, number>> = {
	"m6 ultra": 1_200,
	"m6 max": 614,
	"m6 pro": 307,
	"m4 ultra": 819,
};

function normalizedDeviceName(value: string): string {
	return value.toUpperCase().replaceAll("(TM)", "").replace(/\s+/g, " ").trim();
}

function longestMatchingEntry<T>(
	value: string,
	entries: Readonly<Record<string, T>>,
): { readonly name: string; readonly spec: T } | null {
	const normalized = normalizedDeviceName(value);
	let result: { readonly name: string; readonly spec: T } | null = null;

	for (const [name, spec] of Object.entries(entries)) {
		if (normalized.includes(name.toUpperCase()) && (!result || name.length > result.name.length)) {
			result = { name, spec };
		}
	}

	return result;
}

export function matchCanIRunGpu(value: string): MatchedGpuDevice | null {
	for (const [pattern, canonicalName] of GPU_ALIASES) {
		const spec = GPU_DB[canonicalName];
		if (pattern.test(value) && spec) return { name: canonicalName, ...spec };
	}

	const match = longestMatchingEntry(value, GPU_DB);
	return match ? { name: match.name, ...match.spec } : null;
}

export function matchCanIRunApple(value: string): MatchedAppleDevice | null {
	const match = longestMatchingEntry(value, APPLE_DB);
	if (!match) return null;

	const normalizedName = match.name.toLowerCase();
	const override = Object.entries(APPLE_BANDWIDTH_OVERRIDES).find(([name]) =>
		value.toLowerCase().includes(name),
	)?.[1];
	return {
		name: override
			? value
					.trim()
					.replace(/^apple\s+/i, "")
					.toLowerCase()
			: match.name,
		...match.spec,
		bw: override ?? APPLE_BANDWIDTH_OVERRIDES[normalizedName] ?? match.spec.bw,
	};
}

export function matchCanIRunMobile(value: string): MatchedMobileDevice | null {
	const match = longestMatchingEntry(value, MOBILE_GPU_DB);
	return match ? { name: match.name, ...match.spec } : null;
}

export function matchCanIRunSbc(value: string, memoryGib?: number): MatchedSbcDevice | null {
	const directMatch = longestMatchingEntry(value, SBC_DB);
	if (directMatch) return { name: directMatch.name, ...directMatch.spec };

	const generation = value.match(/Raspberry Pi\s+([45])/i)?.[1];
	if (!generation) return null;

	const candidates = Object.entries(SBC_DB).filter(([name]) =>
		name.startsWith(`Raspberry Pi ${generation} `),
	);
	const selected = candidates.reduce<(typeof candidates)[number] | null>((best, candidate) => {
		if (!best) return candidate;
		const target = memoryGib ?? candidate[1].ram;
		return Math.abs(candidate[1].ram - target) < Math.abs(best[1].ram - target) ? candidate : best;
	}, null);
	return selected ? { name: selected[0], ...selected[1] } : null;
}
