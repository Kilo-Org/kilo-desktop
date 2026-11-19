import { useQuery } from "@tanstack/react-query";

import { ShieldIcon } from "lucide-react";

import type { CondaChannelPoliciesResult } from "../../../contracts/providers/conda";
import { condaQueryOptions, useConda } from "../../conda";
import { getChannelPresentation } from "./channel-presentation";

/** The chooser's name for a channel, e.g. "Anaconda Main" for `defaults`. */
function channelLabel(channel: string): string {
	const { title, badge } = getChannelPresentation(channel);
	return badge ? `${title} ${badge}` : title;
}

function listLabels(labels: readonly string[]): string {
	if (labels.length <= 1) return labels[0] ?? "";
	return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/** The selected channels repo.anaconda.cloud assigns an organization package policy to. */
export function channelsWithPolicy(
	result: CondaChannelPoliciesResult | undefined,
	selected: readonly string[],
): string[] {
	const governed = new Set(
		(result?.channels ?? [])
			.filter(({ entries }) => entries.some((entry) => entry.policyId || entry.policyName))
			.map(({ channel }) => channel),
	);
	return selected.filter((channel) => governed.has(channel));
}

/**
 * "Your organization's package policy may hide some packages on <channel>."
 * under the package search, for selected channels that have a policy. It
 * is only ever a "may": the policy filters repodata, so a package missing
 * from search is never claimed to be blocked. Results never wait for it, an
 * older bridge (no policies) or a failed lookup shows nothing, and it stays
 * out of the channel chooser itself.
 */
export function ChannelPolicyHint({
	channels,
	qaId,
}: {
	/** The selected channels, once the configured ones are known. */
	channels: readonly string[] | undefined;
	qaId: string;
}) {
	const conda = useConda();
	const selected = channels ?? [];
	const policies = useQuery({
		...condaQueryOptions(conda, "channelPolicies", { channels: [...selected] }),
		enabled: selected.length > 0,
		retry: false,
	});
	const governed = channelsWithPolicy(policies.data, selected);
	if (governed.length === 0) return null;
	return (
		<p
			className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs"
			data-qa-id={qaId}
		>
			<ShieldIcon className="size-3.5 shrink-0" aria-hidden="true" />
			Your organization's package policy may hide some packages on{" "}
			{listLabels(governed.map(channelLabel))}.
		</p>
	);
}
