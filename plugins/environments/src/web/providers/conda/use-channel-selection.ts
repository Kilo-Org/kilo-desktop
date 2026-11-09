import { useCallback, useEffect, useMemo, useState } from "react";

import { defaultChannelSelection, selectableChannels } from "./channel-presentation.js";

/**
 * Channel choice for the package-search dialogs (create environment, add
 * packages). Defaults to every selectable channel; the user can toggle any
 * channel off/on freely. Channels backed by an Anaconda API key fail at fetch
 * time with a handled error — there is no in-dialog sign-in step.
 */
export function useChannelSelection(configured: string[] | undefined) {
	const available = useMemo(() => selectableChannels(configured ?? []), [configured]);
	const [selected, setSelected] = useState<string[]>([]);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (available.length > 0 && selected.length === 0) {
			setSelected(defaultChannelSelection(available));
		}
	}, [available]); // eslint-disable-line react-hooks/exhaustive-deps

	const toggle = useCallback((channel: string) => {
		setSelected((prev) =>
			prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel],
		);
	}, []);

	function reset() {
		setSelected(defaultChannelSelection(available));
		setOpen(false);
	}

	const channelsArg = useMemo(() => (selected.length > 0 ? selected : undefined), [selected]);
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
