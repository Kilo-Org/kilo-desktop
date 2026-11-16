import type { ComponentType } from "react";
import { z } from "zod";

import {
	defineDecisionExtensionPoint,
	defineExtensionPoint,
	implementation,
} from "../extension-point";

/** The renderer root. Exactly one wins; without one the kernel shows its recovery screen. */
export const KernelRoot = defineExtensionPoint({
	id: "kernel/root",
	kind: "exclusive",
	description: "The interface rendered in the main window.",
	implementation: implementation<ComponentType>("renderer"),
});

export interface WindowViewProps {
	readonly params: Readonly<Record<string, string>>;
}

/** Views that can be opened in their own (secondary) window via `kernel/windows.open`. */
export const KernelWindowView = defineExtensionPoint({
	id: "kernel/window-view",
	kind: "additive",
	description: "A view that can be shown in a secondary window.",
	metadata: z.object({
		title: z.string(),
		width: z.number().int().positive().optional(),
		height: z.number().int().positive().optional(),
	}),
	implementation: implementation<ComponentType<WindowViewProps>>("renderer"),
});

const singleKeybinding = z.union([
	z.string(),
	z.strictObject({
		mac: z.string().optional(),
		windows: z.string().optional(),
		linux: z.string().optional(),
		default: z.string().optional(),
	}),
]);
/** One shortcut, or several ("A or B"). */
const keybindingSpec = z.union([singleKeybinding, z.array(singleKeybinding).min(1)]);

export type CommandHandler = (args?: unknown) => unknown;

/** A named action a person can trigger; surfaces (palette, keys, menus, buttons) reference it by id. */
export const KernelCommand = defineExtensionPoint({
	id: "kernel/command",
	kind: "additive",
	description: "A named user action.",
	metadata: z.object({
		title: z.string(),
		/** The heading commands are grouped under (Settings → Shortcuts, the palette). */
		category: z.string().optional(),
		/** Position within the category; lower first. */
		order: z.number().optional(),
		icon: z.string().optional(),
		keybinding: keybindingSpec.optional(),
		palette: z.boolean().default(true),
		repeatable: z.boolean().default(false),
		/**
		 * The owner handles the key itself (Enter in the composer): the shortcut
		 * is listed, never captured or dispatched, and contests no other binding.
		 */
		handledLocally: z.boolean().default(false),
	}),
	implementation: implementation<CommandHandler>("any"),
});

export interface ServiceContext {
	/** Aborted when the service is being stopped. */
	readonly signal: AbortSignal;
	/** Reports human-readable progress ("Starting Kilo…"). */
	progress(message: string): void;
	/** Reports that a running daemon has crashed; the kernel applies the restart policy. */
	fail(error: unknown): void;
}

export interface ServiceImplementation {
	/** Daemons resolve once ready; tasks resolve when done. */
	start(context: ServiceContext): void | Promise<void>;
	stop?(): void | Promise<void>;
	health?(): boolean | Promise<boolean>;
}

/** Supervised long-running (daemon) or one-off background (task) work. */
export const KernelService = defineExtensionPoint({
	id: "kernel/service",
	kind: "additive",
	description: "A supervised daemon or background task.",
	metadata: z.object({
		title: z.string(),
		kind: z.enum(["daemon", "task"]),
		startOn: z.enum(["activation", "window-shown", "first-use"]).default("window-shown"),
		restart: z
			.object({
				policy: z.enum(["never", "on-failure"]).default("on-failure"),
				maxRetries: z.number().int().min(0).default(3),
				initialDelayMs: z.number().int().min(0).default(1_000),
				maxDelayMs: z.number().int().min(0).default(60_000),
			})
			.default({ policy: "on-failure", maxRetries: 3, initialDelayMs: 1_000, maxDelayMs: 60_000 }),
		stopTimeoutMs: z.number().int().positive().default(5_000),
	}),
	implementation: implementation<ServiceImplementation>("main"),
});

/** Asked before quitting. Fails open so a plugin can never trap the user. */
export const KernelQuit = defineDecisionExtensionPoint({
	id: "kernel/quit",
	process: "main",
	description: "Proceed, ask or reject before the app quits.",
	input: z.object({}),
	failMode: "open",
	timeoutMs: 2_000,
});

/** Asked before a window closes. Fails open. */
export const KernelWindowClose = defineDecisionExtensionPoint({
	id: "kernel/window-close",
	process: "main",
	description: "Proceed, ask or reject before a window closes.",
	input: z.object({ windowId: z.string() }),
	failMode: "open",
	timeoutMs: 2_000,
});

export const KERNEL_EXTENSION_POINTS = [
	KernelRoot,
	KernelWindowView,
	KernelCommand,
	KernelService,
	KernelQuit,
	KernelWindowClose,
];
