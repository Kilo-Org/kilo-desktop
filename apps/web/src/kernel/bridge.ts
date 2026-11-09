import type { KernelBridge } from "@kilo-desktop/kernel";

/** The preload bridge, present only when running inside the Electron shell. */
export function getKernelBridge(): KernelBridge | undefined {
	return (globalThis as { kernelBridge?: KernelBridge }).kernelBridge;
}
