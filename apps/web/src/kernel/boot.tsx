import { StrictMode, type ComponentType } from "react";
import type { Root } from "react-dom/client";
import { TriangleAlertIcon } from "lucide-react";

import { BUNDLED_PLUGINS, withEntries, type BundledPlugin } from "@kilo-desktop/bundled-plugins";
import {
	chordFromKeyboardEvent,
	createBridgeTransport,
	createLinkedTransports,
	detectKeyboardPlatform,
	serializeChord,
	type KernelBridge,
	type KernelLogger,
	type PluginEntry,
} from "@kilo-desktop/kernel";
import {
	createRendererKernel,
	KernelProvider,
	KernelRoot,
	type RendererKernel,
} from "@kilo-desktop/kernel/web";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";

import { getKernelBridge } from "./bridge";
import { startBrowserMainKernel } from "./browser-main";
import { WEB_ENTRIES } from "./plugins";

const KEYBOARD_SYNC_CHANNEL = "kernel:keyboard-sync";

// `data-open` skips a dialog still animating out, so a shortcut pressed right after Esc works.
const MODAL_SELECTOR =
	'[data-slot="dialog-content"][data-open], [data-slot="alert-dialog-content"][data-open]';

/** No shortcut runs behind an open dialog. */
function dispatchUnlessModal(kernel: RendererKernel, chord: string): void {
	if (document.querySelector(MODAL_SELECTOR)) return;
	void kernel.keyboard.dispatch(chord);
}

const ignore = () => {};
const consoleLogger: KernelLogger = {
	debug: ignore,
	info: ignore,
	warn: (message, ...details) => console.warn(message, ...details),
	error: (message, ...details) => console.error(message, ...details),
};

export interface BootedKernel {
	readonly kernel: RendererKernel;
	readonly App: ComponentType;
}

/**
 * Starts the renderer kernel for this window. In Electron it talks to main
 * through the preload bridge; in a plain browser it starts an in-page main
 * kernel first. Keyboard chords are routed to commands either way.
 */
export async function bootKernel(
	options: {
		readonly bundled?: readonly BundledPlugin[];
		readonly webEntries?: Readonly<Record<string, PluginEntry>>;
	} = {},
): Promise<BootedKernel> {
	const bundled = options.bundled ?? BUNDLED_PLUGINS;
	const bridge = getKernelBridge();

	const webEntries = options.webEntries ?? WEB_ENTRIES;
	const registrations = withEntries(webEntries, bundled);

	let kernel: RendererKernel;
	if (bridge) {
		kernel = createRendererKernel({
			windowId: bridge.window.id,
			window: bridge.window,
			platform: bridge.platform,
			transport: createBridgeTransport(bridge),
			pathForFile: (file) => bridge.getPathForFile(file),
			registrations,
			logger: consoleLogger,
		});
		await kernel.activate();
		routeShortcutsFromMain(kernel, bridge);
	} else {
		const transports = createLinkedTransports();
		const main = await startBrowserMainKernel({
			transport: transports.main,
			registrations: withEntries({}, bundled),
			webPlugins: Object.keys(webEntries),
			logger: consoleLogger,
		});
		kernel = createRendererKernel({
			windowId: "main",
			platform: detectKeyboardPlatform(),
			transport: transports.connectRenderer("main"),
			registrations,
			logger: consoleLogger,
		});
		await kernel.activate();
		void main.windowShown();
		routeShortcutsFromWindow(kernel);
	}

	function App() {
		return (
			<KernelProvider kernel={kernel}>
				<KernelRoot />
			</KernelProvider>
		);
	}
	return { kernel, App };
}

/**
 * Renders the window: the kernel's app once it boots, or a static failure
 * screen when boot rejects (the bridge never answered, hydration failed…).
 * The kernel's own recovery screen needs a running kernel, so it cannot
 * stand in here.
 */
export async function startRenderer(
	root: Pick<Root, "render">,
	options: {
		readonly boot?: () => Promise<BootedKernel>;
		readonly onBootError?: (error: unknown) => void;
		readonly reload?: () => void;
	} = {},
): Promise<void> {
	let booted: BootedKernel;
	try {
		booted = await (options.boot ?? bootKernel)();
	} catch (error) {
		console.error("The renderer kernel failed to start", error);
		options.onBootError?.(error);
		root.render(
			<BootFailure error={error} onReload={options.reload ?? (() => window.location.reload())} />,
		);
		return;
	}
	const { App } = booted;
	root.render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}

function BootFailure({
	error,
	onReload,
}: {
	readonly error: unknown;
	readonly onReload: () => void;
}) {
	return (
		<div className="bg-background flex h-screen w-full items-center justify-center p-6">
			<Empty data-qa-id="renderer-boot-failure">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<TriangleAlertIcon />
					</EmptyMedia>
					<EmptyTitle>Kilo Desktop couldn't start this window</EmptyTitle>
					<EmptyDescription>
						{error instanceof Error && error.message
							? error.message
							: "An unexpected error occurred."}
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button data-qa-id="renderer-boot-reload" onClick={onReload}>
						Reload
					</Button>
				</EmptyContent>
			</Empty>
		</div>
	);
}

/** Main captures keys on every WebContents (including webviews) and reports matches. */
function routeShortcutsFromMain(kernel: RendererKernel, bridge: KernelBridge): void {
	const sync = () => bridge.send(KEYBOARD_SYNC_CHANNEL, { chords: kernel.keyboard.chords() });
	sync();
	kernel.keyboard.subscribe(sync);
	bridge.onShortcut((chord) => dispatchUnlessModal(kernel, chord));
}

function routeShortcutsFromWindow(kernel: RendererKernel): void {
	window.addEventListener(
		"keydown",
		(event) => {
			const chord = chordFromKeyboardEvent(event);
			if (!chord) return;
			const serialized = serializeChord(chord);
			if (!kernel.keyboard.chords().includes(serialized)) return;
			event.preventDefault();
			dispatchUnlessModal(kernel, serialized);
		},
		{ capture: true },
	);
}
