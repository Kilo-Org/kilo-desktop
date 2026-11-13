import { useEffect, useMemo, useState } from "react";

import type { QualifiedId } from "@kilo-desktop/kernel";
import { useKernel } from "@kilo-desktop/kernel/web";

import { buildDomainMap, type DomainMap, type DomainMapInput } from "./model";

/** Domain objects come and go in bursts (a plugin starting); redraw at most this often. */
const REFRESH_MS = 250;

/** A number that moves whenever domain objects are provided or withdrawn, or plugins change state. */
function useKernelChanges(): number {
	const kernel = useKernel();
	const [version, setVersion] = useState(0);
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const bump = () => {
			timer ??= setTimeout(() => {
				timer = undefined;
				setVersion((current) => current + 1);
			}, REFRESH_MS);
		};
		const stops = [kernel.domainObjects.onChange(bump), kernel.onPluginStateChange(bump)];
		return () => {
			clearTimeout(timer);
			for (const stop of stops) stop();
		};
	}, [kernel]);
	return version;
}

/**
 * The map's input, from what the kernel discovered: every plugin's manifest
 * (where it runs, what it requires), domain object and extension point
 * definitions, the contributions plugins declare, and which domain objects
 * are provided as this window sees them (main's through their mirrors).
 */
export function useDomainMapInput(): Omit<DomainMapInput, "includeUnprovided" | "includePoints"> {
	const kernel = useKernel();
	const version = useKernelChanges();
	return useMemo(() => {
		const { discovery } = kernel;
		const plugins = discovery.plugins
			.filter((plugin) => plugin.status === "resolved")
			.map(({ manifest }) => ({
				id: manifest.id,
				name: manifest.displayName ?? manifest.id,
				main: Boolean(manifest.main),
				web: Boolean(manifest.web),
				requires: Object.keys(manifest.requires ?? {}),
			}));
		const domains = [...discovery.domainObjects.values()].map(({ owner, definition }) => ({
			id: definition.id,
			owner,
			home: definition.home,
			events: Object.keys(definition.events),
			...(definition.description ? { description: definition.description } : {}),
		}));
		const points = [...discovery.extensionPoints.values()].map(({ owner, definition }) => ({
			id: definition.id,
			owner,
			process: definition.implementation?.process ?? "data",
		}));
		const contributions = discovery.contributions.map(({ pointId, pluginId }) => ({
			pointId,
			pluginId,
		}));
		return {
			plugins,
			domains,
			points,
			contributions,
			isProvided: (id: string) => kernel.domainObjects.isProvided(id as QualifiedId),
		};
		// `version` moves when what's provided, or which plugins run, changes.
		// oxlint-disable-next-line react-hooks/exhaustive-deps
	}, [kernel, version]);
}

/** The live map, as this window's preferences ask for it. */
export function useDomainMap(options: {
	readonly includeUnprovided: boolean;
	readonly includePoints: boolean;
}): DomainMap {
	const input = useDomainMapInput();
	return useMemo(
		() => buildDomainMap({ ...input, ...options }),
		// oxlint-disable-next-line react-hooks/exhaustive-deps
		[input, options.includeUnprovided, options.includePoints],
	);
}
