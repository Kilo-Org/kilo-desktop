import { z } from "zod";

export const localInferenceUsageSchema = z.object({
	system: z.object({
		cpuPercent: z.number().finite().min(0).max(100),
		cpuSpeedGHz: z.number().finite().nonnegative().nullable(),
		gpuMemoryUsedBytes: z.number().int().nonnegative().nullable(),
		gpuMemoryTotalBytes: z.number().int().nonnegative().nullable(),
		memoryUsedBytes: z.number().int().nonnegative(),
		memoryTotalBytes: z.number().int().nonnegative(),
	}),
});

export type LocalInferenceUsage = z.infer<typeof localInferenceUsageSchema>;

export const localInferenceHardwareProfileSchema = z.object({
	name: z.string().min(1),
	kind: z.enum(["unified-memory", "dedicated-gpu", "system-memory", "mobile"]),
	accelerator: z.enum(["metal", "cuda", "vulkan", "cpu"]),
	memoryTotalBytes: z.number().int().nonnegative(),
	systemMemoryTotalBytes: z.number().int().nonnegative(),
	memoryBandwidthGBps: z.number().finite().positive().nullable(),
});

export type LocalInferenceHardwareProfile = z.infer<typeof localInferenceHardwareProfileSchema>;
