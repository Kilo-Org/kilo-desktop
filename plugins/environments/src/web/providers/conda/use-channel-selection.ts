import { useState } from "react";

import { defaultChannelSelection, selectableChannels } from "./channel-presentation";

/**
 * Channel choice for the package-search dialogs (create environment, add
 * packages). Defaults to every selectable channel; the user can toggle any
 * channel off/on freely. Channels backed by an Anaconda API key fail at fetch
 * time with a handled error — there is no in-dialog sign-in step.
 *
 * `extra` channels (an install link's channel) are offered and selected
 * ahead of the configured ones, even before `configured` is known: conda
 * prefers the channels it is given first. The selection is seeded once, from
 * what is offered when the first channels arrive.
 */
const NO_CHANNELS: readonly string[] = [];

export function useChannelSelection(configured: string[] | undefined, extra?: readonly string[]) {
	const availableSet = new Set([...(extra ?? []), ...selectableChannels(configured ?? [])]);
	const available = [...availableSet];
	const availableKey = available.join("\n");
	const [selected, setSelected] = useState<string[]>(() => defaultChannelSelection(available));
	const [seededFor, setSeededFor] = useState(availableKey);
	const [open, setOpen] = useState(false);

	// Seed the defaults once channels arrive, without overriding a selection the
	// user already made.
	if (seededFor !== availableKey) {
		setSeededFor(availableKey);
		if (available.length > 0 && selected.length === 0) {
			setSelected(defaultChannelSelection(available));
		}
	}

	// Selection order is the channel priority conda solves with, so a channel
	// toggled back on returns to its offered position rather than the end.
	const toggle = (channel: string) => {
		setSelected((prev) => {
			if (prev.includes(channel)) return prev.filter((c) => c !== channel);
			if (!availableSet.has(channel)) return [...prev, channel];
			const next = new Set([...prev, channel]);
			return [...available.filter((c) => next.has(c)), ...prev.filter((c) => !availableSet.has(c))];
		});
	};

	function reset() {
		setSelected(defaultChannelSelection(available));
		setOpen(false);
	}

	const channelsArg = selected.length > 0 ? selected : undefined;
	const selectedSet = new Set(selected);
	const allSelected = available.length > 0 && available.every((c) => selectedSet.has(c));
	const summary = allSelected
		? "All channels"
		: selected.length === 0
			? "No channels"
			: `${selected.length} channel${selected.length === 1 ? "" : "s"}`;
	const defaults = defaultChannelSelection(available);
	const customized =
		defaults.length !== selected.length || defaults.some((channel) => !selectedSet.has(channel));

	return {
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
