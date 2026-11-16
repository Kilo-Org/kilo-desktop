import type { Contribution } from "@kilo-desktop/kernel";
import { RenderContribution, useExtensions } from "@kilo-desktop/kernel/web";

import { AiProviderPanel } from "../../contracts";
// The provider list is the ai-providers area's; this page only frames it.
import { AiProviderList } from "../ai-providers/AiProviderList";

function hiddenAiProviderIds(panels: readonly Contribution<typeof AiProviderPanel>[]): string[] {
	return panels.map((panel) => panel.metadata.aiProviderId);
}

/**
 * Settings → AI Providers: the panels AI provider owners contribute
 * (`kilo.shell/ai-provider-panel`, e.g. Kilo Gateway) as the first rows of
 * the provider list, which leaves those AI providers out.
 */
export function AiProvidersSettings() {
	const panels = useExtensions(AiProviderPanel);
	const featured =
		panels.length > 0 ? (
			<div className="divide-border divide-y" data-qa-id="ai-provider-panels">
				{panels.map((panel) => (
					<div key={panel.key} data-qa-id={`ai-provider-panel-${panel.key}`}>
						<RenderContribution contribution={panel} />
					</div>
				))}
			</div>
		) : null;

	return (
		<div className="min-w-0" data-qa-id="ai-providers-settings">
			<AiProviderList hiddenAiProviderIds={hiddenAiProviderIds(panels)} featured={featured} />
		</div>
	);
}
