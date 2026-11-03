// Test host for plugins that contribute to kilo.shell: boots the real shell
// (main + renderer) with guest plugins and renders the window.
import { cleanup, render } from "@testing-library/react";

import type { PluginDefinitions, PluginEntry } from "@kilo-desktop/kernel";
import type { MainKernel, MainKernelHost } from "@kilo-desktop/kernel/main";
import {
	createMemoryStorage,
	createTestHost,
	createTestKernelPair,
} from "@kilo-desktop/kernel/testing";
import { KernelProvider, KernelRoot, type RendererKernel } from "@kilo-desktop/kernel/web";

import manifest from "../../plugin.json";
import { Onboarding } from "../contracts";
import { SHELL_DEFINITIONS } from "../definitions";
import { createShellMainEntry } from "../main/entry";
import { shellWebEntry } from "../web";

export interface GuestPlugin {
	readonly manifest: unknown;
	readonly definitions?: PluginDefinitions;
	readonly main?: PluginEntry;
	readonly web?: PluginEntry;
}

export interface ShellHostOptions {
	/** Sets the `kernel/desktop` key (desktop-only sections show). */
	readonly desktop?: boolean;
	/** Appearance a previous version kept in localStorage. */
	readonly localAppearance?: Readonly<Record<string, string>>;
	/** Runs after the kernels start and before the window renders (provide host primitives here). */
	readonly beforeRender?: (main: MainKernel) => void;
	/** Show first-run onboarding; by default it is recorded as completed so it stays out of the way. */
	readonly onboarding?: boolean;
	/** Paths for files dropped on the window. */
	readonly pathForFile?: (file: File) => string | null;
	/** The host's windows (pop-outs and other secondary windows). */
	readonly windows?: MainKernelHost["windows"];
	/** Where the host keeps the plugins the user turned off. */
	readonly plugins?: MainKernelHost["plugins"];
	readonly relaunch?: MainKernelHost["relaunch"];
}

export interface ShellHost {
	readonly main: MainKernel;
	readonly renderer: RendererKernel;
	readonly storage: ReturnType<typeof createMemoryStorage>;
}

export async function renderShell(
	guests: readonly GuestPlugin[] = [],
	options: ShellHostOptions = {},
): Promise<ShellHost> {
	cleanup();
	window.location.hash = "#/";
	localStorage.clear();
	for (const [key, value] of Object.entries(options.localAppearance ?? {}))
		localStorage.setItem(key, value);
	const storage = createMemoryStorage("/data/kilo.shell");
	const registration = (guest: GuestPlugin, entry: PluginEntry | undefined) => ({
		manifest: guest.manifest,
		...(guest.definitions ? { definitions: guest.definitions } : {}),
		...(entry ? { entry } : {}),
	});
	const { main, renderer } = await createTestKernelPair({
		host: createTestHost({
			desktop: options.desktop ?? false,
			...(options.windows ? { windows: options.windows } : {}),
			...(options.plugins ? { plugins: options.plugins } : {}),
			...(options.relaunch ? { relaunch: options.relaunch } : {}),
		}),
		main: [
			{ manifest, definitions: SHELL_DEFINITIONS, entry: createShellMainEntry() },
			...guests.map((guest) => registration(guest, guest.main)),
		],
		renderer: [
			{ manifest, definitions: SHELL_DEFINITIONS, entry: shellWebEntry },
			...guests.map((guest) => registration(guest, guest.web)),
		],
		mainHostServices: () => ({ storage }),
		...(options.pathForFile ? { pathForFile: options.pathForFile } : {}),
	});
	if (!options.onboarding)
		await main.kernelSdk.domains.get(Onboarding)?.methods.complete(undefined);
	options.beforeRender?.(main);
	render(
		<KernelProvider kernel={renderer}>
			<KernelRoot />
		</KernelProvider>,
	);
	return { main, renderer, storage };
}
