// Test host for plugins that contribute to kilo.shell: boots the real shell
// (main + renderer) with guest plugins and renders the window.
import { cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";

import type {
	FlagValue,
	PluginDefinitions,
	PluginEntry,
	PluginRegistration,
	PluginSdk,
} from "@kilo-desktop/kernel";
import type { MainKernel, MainKernelHost } from "@kilo-desktop/kernel/main";
import {
	createMemoryStorage,
	createTestHost,
	createTestKernelPair,
	testManifest,
} from "@kilo-desktop/kernel/testing";
import {
	KernelProvider,
	KernelRoot,
	type RendererKernel,
	type RendererWindow,
} from "@kilo-desktop/kernel/web";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS } from "@kilo-desktop/plugin-core/contracts";

import manifest from "../../plugin.json";
import { Onboarding, SHELL_DEFINITIONS } from "../contracts";
import { createShellMainEntry, type ShellMainOptions } from "../main/entry";
import { shellWebEntry } from "../web";

export interface GuestPlugin {
	readonly manifest: unknown;
	readonly definitions?: PluginDefinitions;
	readonly main?: PluginEntry;
	readonly web?: PluginEntry;
}

export interface ShellHostOptions {
	/** Sets the `kernel/desktop` key (desktop-only sections and onboarding show). */
	readonly desktop?: boolean;
	/**
	 * The kilo.core stand-in: its real manifest and contracts, with a main
	 * entry that runs this function. Provide the `kilo.core/*` domain objects
	 * the test needs with fake state and methods, and set its context keys.
	 * By default it only accepts the terms (so the welcome step stays out of
	 * the way); `false` leaves kilo.core out, as when it is removed.
	 */
	readonly core?: ((sdk: PluginSdk) => void) | false;
	/** Appearance a previous version kept in localStorage. */
	readonly localAppearance?: Readonly<Record<string, string>>;
	/** Runs after the kernels start and before the window renders (provide host primitives here). */
	readonly beforeRender?: (main: MainKernel) => void;
	/** Show first-run onboarding; by default it is recorded as completed so it stays out of the way. */
	readonly onboarding?: boolean;
	/** Flag values, as the build or environment would force them (`kernel/flag:<id>`). */
	readonly flags?: Readonly<Record<string, FlagValue>>;
	/**
	 * Replaces kilo.shell's renderer entry, e.g. to boot only the areas a
	 * test is about (`activateFrame` and the area under test).
	 */
	readonly shellWeb?: PluginEntry;
	/** kilo.shell's main entry options (legal documents, notification ids…). */
	readonly shellMain?: ShellMainOptions;
	/** Paths for files dropped on the window. */
	readonly pathForFile?: (file: File) => string | null;
	/** The host's windows (pop-outs and other secondary windows). */
	readonly windows?: MainKernelHost["windows"];
	/** Where the host keeps the plugins the user turned off. */
	readonly plugins?: MainKernelHost["plugins"];
	readonly relaunch?: MainKernelHost["relaunch"];
	/** Renders the window under React StrictMode, as the app does in development. */
	readonly strictMode?: boolean;
}

export interface ShellHost {
	readonly main: MainKernel;
	readonly renderer: RendererKernel;
	/** kilo.shell's main-process storage. */
	readonly storage: ReturnType<typeof createMemoryStorage>;
	/** Boots another window's renderer kernel (a pop-out); render into it yourself. */
	readonly openWindow: (
		windowId: string,
		window?: Omit<RendererWindow, "id">,
	) => Promise<RendererKernel>;
}

/** A plugin that contributes to points through its manifest and binds code in the renderer. */
export function contributor(
	id: string,
	extensions: Record<string, unknown[]>,
	activate: (sdk: PluginSdk) => void = () => {},
	extra: Record<string, unknown> = {},
): GuestPlugin {
	return {
		manifest: testManifest(id, { contributes: { extensions }, ...extra }),
		web: { activate },
	};
}

function acceptTerms(sdk: PluginSdk): void {
	sdk.context.set("termsAccepted", true);
}

let previousHost: { main: MainKernel; renderers: RendererKernel[] } | undefined;

/**
 * Boots kilo.shell (main + renderer) around `guests`, starts the window on
 * "/" and renders the kernel root. Each call first tears down the previous
 * host, so a test may call it again to start over.
 */
export async function renderShell(
	guests: readonly GuestPlugin[] = [],
	options: ShellHostOptions = {},
): Promise<ShellHost> {
	cleanup();
	if (previousHost) {
		for (const renderer of previousHost.renderers.reverse()) await renderer.deactivate();
		await previousHost.main.stop();
		previousHost = undefined;
	}
	window.location.hash = "#/";
	localStorage.clear();
	for (const [key, value] of Object.entries(options.localAppearance ?? {}))
		localStorage.setItem(key, value);
	const storage = createMemoryStorage("/data/kilo.shell");
	const core = options.core ?? acceptTerms;
	const everyGuest = core
		? [
				{ manifest: coreManifest, definitions: CORE_DEFINITIONS, main: { activate: core } },
				...guests,
			]
		: guests;
	const registration = (
		guest: GuestPlugin,
		entry: PluginEntry | undefined,
	): PluginRegistration => ({
		manifest: guest.manifest,
		...(guest.definitions ? { definitions: guest.definitions } : {}),
		...(entry ? { entry } : {}),
	});
	const {
		main,
		renderer,
		openWindow: openKernelWindow,
	} = await createTestKernelPair({
		host: createTestHost({
			desktop: options.desktop ?? false,
			...(options.flags ? { flagOverrides: options.flags } : {}),
			...(options.windows ? { windows: options.windows } : {}),
			...(options.plugins ? { plugins: options.plugins } : {}),
			...(options.relaunch ? { relaunch: options.relaunch } : {}),
		}),
		main: [
			{
				manifest,
				definitions: SHELL_DEFINITIONS,
				entry: createShellMainEntry(options.shellMain),
			},
			...everyGuest.map((guest) => registration(guest, guest.main)),
		],
		renderer: [
			{ manifest, definitions: SHELL_DEFINITIONS, entry: options.shellWeb ?? shellWebEntry },
			...everyGuest.map((guest) => registration(guest, guest.web)),
		],
		mainHostServices: (pluginId) =>
			pluginId === manifest.id
				? { storage }
				: { storage: createMemoryStorage(`/data/${pluginId}`) },
		...(options.pathForFile ? { pathForFile: options.pathForFile } : {}),
	});
	if (!options.onboarding)
		await main.kernelSdk.domainObjects.get(Onboarding)?.methods.complete(undefined);
	options.beforeRender?.(main);
	const root = (
		<KernelProvider kernel={renderer}>
			<KernelRoot />
		</KernelProvider>
	);
	render(options.strictMode ? <StrictMode>{root}</StrictMode> : root);
	const renderers = [renderer];
	const openWindow = async (windowId: string, window?: Omit<RendererWindow, "id">) => {
		const opened = await openKernelWindow(windowId, window);
		renderers.push(opened);
		return opened;
	};
	previousHost = { main, renderers };
	return { main, renderer, storage, openWindow };
}
