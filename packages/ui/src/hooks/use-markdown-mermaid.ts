import type { MermaidPlugin } from "@pierre/words/react";
import { useEffect, useState } from "react";

import type * as MermaidRenderer from "../components/mermaid-renderer.js";

type Variant = "plain" | "expandable";

const plugins = new Map<Variant, MermaidPlugin>();
let load: Promise<typeof MermaidRenderer> | undefined;

function loadRenderer(): Promise<typeof MermaidRenderer> {
	load ??= import("../components/mermaid-renderer.js").catch((error: unknown) => {
		// Not remembered: a chunk that failed to load may load next time.
		load = undefined;
		throw error;
	});
	return load;
}

function pluginFor(variant: Variant, renderer: typeof MermaidRenderer): MermaidPlugin {
	let plugin = plugins.get(variant);
	if (!plugin) {
		plugin = renderer.createMermaidMarkdownPlugin({ expandable: variant === "expandable" });
		plugins.set(variant, plugin);
	}
	return plugin;
}

/**
 * The `@pierre/words` Mermaid plugin, shared by every renderer in the window.
 * Pele and the SVG sanitizer load the first time markdown `needed` it (has a
 * `mermaid` fence), so other markdown pays nothing; until they arrive the
 * fence renders as code. `expandable`
 * adds an Expand button to each drawn diagram.
 */
export function useMarkdownMermaid(
	needed: boolean,
	expandable: boolean,
): MermaidPlugin | undefined {
	const variant: Variant = expandable ? "expandable" : "plain";
	const [loaded, setLoaded] = useState<{ variant: Variant; plugin: MermaidPlugin }>();
	const plugin = plugins.get(variant) ?? (loaded?.variant === variant ? loaded.plugin : undefined);

	useEffect(() => {
		if (plugin || !needed) return;
		let cancelled = false;
		loadRenderer().then(
			(renderer) => {
				if (!cancelled) setLoaded({ variant, plugin: pluginFor(variant, renderer) });
			},
			() => undefined,
		);
		return () => {
			cancelled = true;
		};
	}, [needed, plugin, variant]);

	return plugin;
}
