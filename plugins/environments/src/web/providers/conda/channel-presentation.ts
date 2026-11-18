export type ChannelKind = "conda-forge" | "anaconda" | "other";

export interface ChannelPresentation {
	kind: ChannelKind;
	title: string;
	badge?: string;
	description: string;
}

export const CONDA_FORGE_CHANNEL = "conda-forge";
export const ANACONDA_MAIN_CHANNEL = "defaults";

/**
 * Product channels are always offered, even when `conda info` reports no
 * configured channels. Keep custom configured channels after these defaults.
 */
export function selectableChannels(configuredChannels: string[]): string[] {
	return [
		CONDA_FORGE_CHANNEL,
		ANACONDA_MAIN_CHANNEL,
		...configuredChannels.filter(
			(channel) =>
				channel !== CONDA_FORGE_CHANNEL &&
				channel !== ANACONDA_MAIN_CHANNEL &&
				!isAnacondaChannel(channel),
		),
	];
}

/**
 * Channel names that resolve to Anaconda's vetted repository, either directly
 * ("defaults", "main", …) or as a full URL to repo.anaconda.com / the
 * anaconda channel on anaconda.org.
 */
const ANACONDA_NAMES = new Set(["defaults", "anaconda", "main", "r", "msys2", "pro"]);

function isAnacondaChannel(channel: string): boolean {
	const normalized = channel.toLowerCase().replace(/\/+$/, "");
	if (ANACONDA_NAMES.has(normalized)) return true;
	if (normalized.includes("repo.anaconda.com")) return true;
	if (/conda\.anaconda\.org\/anaconda(\/|$)/.test(normalized)) return true;
	return false;
}

/**
 * Human presentation for a conda channel in the channel chooser. Known
 * channels get marketing copy from the design spec; anything else falls back
 * to the raw channel name with a neutral description.
 *
 * An install link's channel (`fromLink`) shows as given, even when it names
 * part of Anaconda's repository: it is a different channel from `defaults`,
 * and merging the two rows would hide which one the link asked for.
 */
export function getChannelPresentation(
	channel: string,
	options: { readonly fromLink?: boolean } = {},
): ChannelPresentation {
	if (options.fromLink && channel !== CONDA_FORGE_CHANNEL && channel !== ANACONDA_MAIN_CHANNEL) {
		return { kind: "other", title: channel, description: "From the install link." };
	}
	if (channel === CONDA_FORGE_CHANNEL) {
		return {
			kind: "conda-forge",
			title: CONDA_FORGE_CHANNEL,
			description: "Community-maintained, open-source.",
		};
	}
	if (isAnacondaChannel(channel)) {
		return {
			kind: "anaconda",
			title: "Anaconda",
			badge: "Main",
			description: "Secure, vetted packages hosted by Anaconda.",
		};
	}
	return {
		kind: "other",
		title: channel,
		description: "Configured in your conda settings.",
	};
}

/** Initial channel selection: every offered channel. */
export function defaultChannelSelection(channels: string[]): string[] {
	return channels;
}
