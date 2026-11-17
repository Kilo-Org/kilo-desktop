import { useState } from "react";

import { defaultChannelSelection, selectableChannels } from "./channel-presentation";

/**
 * Channel choice for the package-search dialogs (create environment, add
 * packages). Defaults to every selectable channel; the user can toggle any
 * channel off/on freely. Channels backed by an Anaconda API key fail at fetch
 * time with a handled error — there is no in-dialog sign-in step.
 */
export function useChannelSelection(configured: string[] | undefined) {
	const available = selectableChannels(configured ?? []);
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

	const toggle = (channel: string) => {
		setSelected((prev) =>
			prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel],
		);
	};

	function reset() {
		setSelected(defaultChannelSelection(available));
		setOpen(false);
	}

	const channelsArg = selected.length > 0 ? selected : undefined;
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
		available,
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
