import {
	KERNEL_CONTEXT_KEYS,
	KERNEL_DEFINITIONS,
	KernelCommand,
	KernelKeybindings,
	KernelPlugins,
} from "../builtins";
import {
	CommandService,
	KeyboardService,
	type KeyBinding,
	type KeybindingResolution,
} from "../commands";
import { createKernel, type Kernel, type KernelOptions } from "../kernel";
import type { KeyboardPlatform } from "../keybindings";
import type { RendererWindow } from "../window";

export type { RendererWindow } from "../window";

export interface RendererKernelOptions extends Omit<
	KernelOptions,
	"process" | "kernelDefinitions" | "kernelContextKeys"
> {
	readonly windowId: string;
	readonly platform: KeyboardPlatform;
	readonly window?: Omit<RendererWindow, "id">;
	/** The local path of a file dropped on the window, where the host can tell. */
	readonly pathForFile?: (file: File) => string | null;
}

export interface RendererKeyboard {
	readonly platform: KeyboardPlatform;
	/** Effective bindings and conflicts, ignoring the recording pause. */
	resolution(): KeybindingResolution;
	/** Chords to capture now; empty while recording. */
	bindings(): KeyBinding[];
	dispatch(chord: string): Promise<boolean>;
	/** True while a new shortcut is being recorded (the host stops menu shortcuts too). */
	isRecording(): boolean;
	/** Notified whenever the effective chords may have changed. */
	subscribe(listener: () => void): () => void;
	/** Pauses every binding while a new shortcut is being recorded. */
	setRecording(recording: boolean): void;
}

export interface RendererKernel extends Kernel {
	readonly window: RendererWindow;
	readonly commands: CommandService;
	readonly keyboard: RendererKeyboard;
	/** The local path of a dropped file; null in browser mode. */
	pathForFile(file: File): string | null;
}

/**
 * The kernel for one renderer window: activates plugins' web entries, mirrors
 * main's domain objects and global context keys, and resolves keyboard chords
 * to commands for this window.
 */
export function createRendererKernel(options: RendererKernelOptions): RendererKernel {
	const window: RendererWindow = {
		id: options.windowId,
		role: options.window?.role ?? "main",
		...(options.window?.view ? { view: options.window.view } : {}),
		params: options.window?.params ?? {},
	};
	const core: Kernel = createKernel({
		...options,
		process: "renderer",
		kernelDefinitions: KERNEL_DEFINITIONS,
		kernelContextKeys: KERNEL_CONTEXT_KEYS,
		// Main decides safe mode; renderers learn it from the mirrored context key.
		skipActivation: () => core.contextKeys.get("kernel/safeMode"),
		// Main reads which plugins the user turned off; renderers follow its mirrored states.
		isDisabled: (pluginId) =>
			core.kernelSdk.domainObjects.get(KernelPlugins)?.getState().plugins[pluginId]?.state ===
			"disabled",
	});
	core.kernelSdk.context.set("secondaryWindow", window.role === "secondary");

	const commands = new CommandService({
		process: "renderer",
		extensions: core.extensions,
		...(options.transport ? { transport: options.transport } : {}),
		logger: core.kernelSdk.logger,
	});
	const service = new KeyboardService({
		commands,
		platform: options.platform,
		overrides: () =>
			core.kernelSdk.domainObjects.get(KernelKeybindings)?.getState().overrides ?? {},
	});
	let recording = false;
	const recordingListeners = new Set<() => void>();
	const keyboard: RendererKeyboard = {
		platform: options.platform,
		resolution: () => service.resolution(),
		bindings: () => (recording ? [] : service.bindings()),
		isRecording: () => recording,
		dispatch: async (chord) => (recording ? false : service.dispatch(chord)),
		setRecording(next) {
			if (recording === next) return;
			recording = next;
			for (const listener of [...recordingListeners]) listener();
		},
		subscribe(listener) {
			recordingListeners.add(listener);
			let unsubscribeOverrides: (() => void) | undefined;
			const unsubscribeTracker = core.kernelSdk.domainObjects.track(KernelKeybindings, {
				added: (handle) => {
					unsubscribeOverrides = handle.subscribe(() => listener());
					listener();
				},
				removed: () => unsubscribeOverrides?.(),
			});
			const unsubscribeCommands = core.extensions.subscribe((pointId) => {
				if (pointId === KernelCommand.id) listener();
			});
			const unsubscribeContext = core.contextKeys.subscribe(listener);
			return () => {
				recordingListeners.delete(listener);
				unsubscribeTracker();
				unsubscribeOverrides?.();
				unsubscribeCommands();
				unsubscribeContext();
			};
		},
	};

	return {
		...core,
		window,
		commands,
		keyboard,
		pathForFile: (file) => options.pathForFile?.(file) ?? null,
	};
}
