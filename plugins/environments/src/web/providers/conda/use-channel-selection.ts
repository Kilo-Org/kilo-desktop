import { useCallback, useEffect, useMemo, useState } from "react";

import type { AnacondaSignIn } from "@kilo-desktop/sdk-react";

import {
	defaultChannelSelection,
	getChannelPresentation,
	selectableChannels,
} from "./channel-presentation.js";

/**
 * Channel choice for the package-search dialogs (create environment, add
 * packages). Defaults to every selectable channel except sign-in-gated
 * Anaconda channels while signed out; picking a gated channel opens the
 * shared sign-in modal and applies the choice once the session lands.
 */
export function useChannelSelection(configured: string[] | undefined, signIn: AnacondaSignIn) {
	const available = useMemo(() => selectableChannels(configured ?? []), [configured]);
	const [selected, setSelected] = useState<string[]>([]);
	const [open, setOpen] = useState(false);
	const [signInOpen, setSignInOpen] = useState(false);
	// The Anaconda channel whose selection was deferred to sign-in.
	const [pendingChannel, setPendingChannel] = useState<string>();
	const { authenticated } = signIn;

	useEffect(() => {
		if (available.length > 0 && selected.length === 0) {
			setSelected(defaultChannelSelection(available, authenticated));
		}
	}, [available, authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

	const toggle = useCallback((channel: string) => {
		setSelected((prev) =>
			prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel],
		);
	}, []);

	const request = useCallback(
		(channel: string) => {
			if (getChannelPresentation(channel).requiresSignIn && !authenticated) {
				setPendingChannel(channel);
				setSignInOpen(true);
				return;
			}
			toggle(channel);
		},
		[authenticated, toggle],
	);

	async function completeSignIn(): Promise<void> {
		const ok = await signIn.signIn();
		if (!ok) return;
		setSignInOpen(false);
		const channel = pendingChannel;
		setPendingChannel(undefined);
		if (channel && available.includes(channel)) {
			setSelected((prev) => (prev.includes(channel) ? prev : [...prev, channel]));
		}
	}

	function reset() {
		setSelected(defaultChannelSelection(available, authenticated));
		setOpen(false);
		setPendingChannel(undefined);
		setSignInOpen(false);
	}

	const channelsArg = useMemo(() => (selected.length > 0 ? selected : undefined), [selected]);
	const allSelected = available.length > 0 && available.every((c) => selected.includes(c));
	const summary = allSelected
		? "All channels"
		: selected.length === 0
			? "No channels"
			: `${selected.length} channel${selected.length === 1 ? "" : "s"}`;
	const defaults = defaultChannelSelection(available, authenticated);
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
		signInOpen,
		setSignInOpen,
		toggle,
		request,
		completeSignIn,
		reset,
	};
}
