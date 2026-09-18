import { useEffect, useState } from "react";

import type { Contribution } from "@kilo-desktop/feature-sdk";

import { useFeatureSystem } from "./SdkProvider.js";

/**
 * Live, priority-ordered contributions for any SDK zone.
 *
 * Shell components and plugin-owned hosts use this hook instead of reaching
 * into FeatureSystem registries directly.
 */
export function useSdkContributions(zone: string): readonly Contribution[] {
	const registry = useFeatureSystem().services.contributionRegistry;
	const [contributions, setContributions] = useState<readonly Contribution[]>(() =>
		registry.getForZone(zone),
	);

	useEffect(() => {
		setContributions(registry.getForZone(zone));
		return registry.onChange(() => {
			setContributions(registry.getForZone(zone));
		});
	}, [registry, zone]);

	return contributions;
}
