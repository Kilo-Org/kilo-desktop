import { useEffect, useState, type ComponentType } from "react";

import { useFeatureSystem } from "@anaconda-agentic-desktop/sdk-react";

import type { Contribution, ShellZone } from "@anaconda-agentic-desktop/feature-sdk";

/**
 * Live view of a zone's contributions, priority-ordered (higher first).
 * Re-renders whenever any feature registers or unregisters a contribution.
 */
export function useZoneContributions(zone: ShellZone): readonly Contribution[] {
	const registry = useFeatureSystem().services.contributionRegistry;
	const [contributions, setContributions] = useState<readonly Contribution[]>(() =>
		registry.getForZone(zone),
	);

	useEffect(() => {
		// Re-read on mount: registrations may have landed between the initial
		// state snapshot and the subscription becoming active.
		setContributions(registry.getForZone(zone));
		return registry.onChange(() => {
			setContributions(registry.getForZone(zone));
		});
	}, [registry, zone]);

	return contributions;
}

type ZoneOutletProps = {
	/** Canonical zone to render — the shell renders only ShellZone ids (Decision #21). */
	zone: ShellZone;
	className?: string;
};

/**
 * Renders every `sdk.contribute(zone, ...)` contribution for a shell zone,
 * priority-ordered. Returns null while the zone is empty so layouts can drop
 * the surrounding chrome entirely.
 *
 * Contributions whose `component` is not a renderable component (the SDK
 * accepts `unknown`) are skipped with a warning instead of crashing the shell.
 */
export function ZoneOutlet({ zone, className }: ZoneOutletProps) {
	const contributions = useZoneContributions(zone);
	if (contributions.length === 0) return null;

	return (
		<div data-zone={zone} data-qa-id={`zone-${zone}`} className={className}>
			{contributions.map((contribution, index) => {
				if (typeof contribution.component !== "function") {
					console.warn(
						`[ZoneOutlet] Skipping contribution "${contribution.label}" from ` +
							`"${contribution.featureId}" in zone "${zone}": component is not a React component.`,
					);
					return null;
				}
				const Component = contribution.component as ComponentType;
				return (
					<Component key={`${contribution.featureId}:${contribution.label}:${String(index)}`} />
				);
			})}
		</div>
	);
}
