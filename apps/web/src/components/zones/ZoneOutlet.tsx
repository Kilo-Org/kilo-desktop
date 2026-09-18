import type { ComponentType } from "react";

import { useSdkContributions } from "@kilo-desktop/sdk-react";

import type { ShellZone } from "@kilo-desktop/feature-sdk";

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
	const contributions = useSdkContributions(zone);
	if (contributions.length === 0) return null;

	return (
		<div data-zone={zone} data-qa-id={`zone-${zone}`} className={className}>
			{contributions.map((contribution) => {
				if (typeof contribution.component !== "function") {
					console.warn(
						`[ZoneOutlet] Skipping contribution "${contribution.label}" from ` +
							`"${contribution.featureId}" in zone "${zone}": component is not a React component.`,
					);
					return null;
				}
				const Component = contribution.component as ComponentType;
				return <Component key={`${contribution.featureId}:${contribution.id}`} />;
			})}
		</div>
	);
}
