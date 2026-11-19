import { useState } from "react";

import { defaultChannelSelection, selectableChannels } from "./channel-presentation";

/** The configured channels as the dialogs know them: still loading, failed, or loaded (maybe empty). */
export type ConfiguredChannels =
	| { readonly status: "loading" }
	| { readonly status: "failed"; readonly error: unknown }
	| { readonly status: "loaded"; readonly channels: readonly string[] };

/** {@link ConfiguredChannels} from a `prefixOptions` query. */
export function configuredChannelsOf(query: {
	readonly isPending: boolean;
	readonly isError: boolean;
	readonly error: unknown;
	readonly data?: { readonly channels: readonly string[] } | undefined;
}): ConfiguredChannels {
	if (query.data) return { status: "loaded", channels: query.data.channels };
	if (query.isError) return { status: "failed", error: query.error };
	return { status: "loading" };
}

const NO_CHANNELS: readonly string[] = [];

/**
 * Channel choice for the package-search dialogs (create environment, add
 * packages). Offers {@link selectableChannels}: the configured channels, or
 * `defaults` and `conda-forge` only once the list has loaded empty. While the
 * list loads, or after it failed, nothing is offered but `extra`, and `ready`
 * stays false so the dialogs hold search and preview; a failure is exposed as
 * `error` and never replaced by the fixed channels.
 *
 * `extra` channels (an install link's channel) are offered and selected
 * ahead of the configured ones, even before the list is known: conda prefers
 * the channels it is given first. Until the person changes the selection, it
 * follows what is offered; afterwards their choice is kept (re-seeded only
 * when they have deselected everything).
 */
export function useChannelSelection(configured: ConfiguredChannels, extra?: readonly string[]) {
	const loadedChannels =
		configured.status === "loaded" ? selectableChannels(configured.channels) : [];
	const available = [...new Set([...(extra ?? []), ...loadedChannels])];
	const availableKey = available.join("\n");
	const [selected, setSelected] = useState<string[]>(() => defaultChannelSelection(available));
	const [seededFor, setSeededFor] = useState(availableKey);
	const [touched, setTouched] = useState(false);
	const [open, setOpen] = useState(false);

	if (seededFor !== availableKey) {
		setSeededFor(availableKey);
		if (available.length > 0 && (!touched || selected.length === 0)) {
			setSelected(defaultChannelSelection(available));
		}
	}

	// Selection order is the channel priority conda solves with, so a channel
	// toggled back on returns to its offered position rather than the end.
	const toggle = (channel: string) => {
		setTouched(true);
		setSelected((prev) => {
			if (prev.includes(channel)) return prev.filter((c) => c !== channel);
			if (!available.includes(channel)) return [...prev, channel];
			const next = new Set([...prev, channel]);
			return [
				...available.filter((c) => next.has(c)),
				...prev.filter((c) => !available.includes(c)),
			];
		});
	};

	function reset() {
		setTouched(false);
		setSelected(defaultChannelSelection(available));
		setOpen(false);
	}

	const ready = configured.status === "loaded";
	const channelsArg = ready && selected.length > 0 ? selected : undefined;
	const allSelected = available.length > 0 && available.every((c) => selected.includes(c));
	const summary = allSelected
		? "All channels"
		: selected.length === 0
			? "No channels"
			: `${selected.length} channel${selected.length === 1 ? "" : "s"}`;
	const defaults = defaultChannelSelection(available);
	const customized =
		defaults.length !== selected.length || defaults.some((channel) => !selected.includes(channel));

	return {
		/** Whether the configured channels are known; search and preview wait for it. */
		ready,
		status: configured.status,
		/** Why the configured channels could not be read, when they could not. */
		error: configured.status === "failed" ? configured.error : undefined,
		available,
		/** The `extra` channels, which the chooser labels as the install link's. */
		linkChannels: extra ?? NO_CHANNELS,
		selected,
		channelsArg,
		summary,
		customized,
		open,
		setOpen,
		toggle,
		reset,
	};
}
