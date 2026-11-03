import type { PluginEntry, PluginRegistration, PluginSdk } from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";

import { renderShell as renderShellHost, type ShellHostOptions } from "../testing";

/** A plugin that contributes to points through its manifest and binds code in the renderer. */
export function contributor(
	id: string,
	extensions: Record<string, unknown[]>,
	activate: (sdk: PluginSdk) => void = () => {},
	extra: Record<string, unknown> = {},
): PluginRegistration {
	const entry: PluginEntry = { activate };
	return {
		manifest: testManifest(id, { contributes: { extensions }, ...extra }),
		entry,
	};
}

/** Boots kilo.shell (main + renderer) with extra renderer plugins and renders the kernel root. */
export function renderShell(
	plugins: readonly PluginRegistration[] = [],
	options: ShellHostOptions = {},
) {
	return renderShellHost(
		plugins.map((plugin) => ({
			manifest: plugin.manifest,
			...(plugin.definitions ? { definitions: plugin.definitions } : {}),
			...(plugin.entry ? { web: plugin.entry } : {}),
		})),
		options,
	);
}
