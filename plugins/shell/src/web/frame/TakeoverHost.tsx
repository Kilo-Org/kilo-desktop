import { useEffect } from "react";

import { RenderContribution, useExtensions } from "@kilo-desktop/kernel/web";

import { Takeover, type TakeoverProps } from "../../contracts";
import { useShellUi, useShownTakeover } from "./ui-state";

/**
 * The `kilo.shell/takeover` this window was asked to show
 * (`navigation.openTakeover`), over the whole frame. The frame marks its own
 * areas inert while one is shown (see `Frame`); they stay mounted, so open
 * sessions keep running underneath. The layer sits above the sidebar and the
 * top bar's fixed toggles but below popovers, dialogs and toasts (z-50 and
 * up), which a take-over's own controls open. A top strip keeps the window
 * draggable (Electron reads `app-region` whatever the stacking, so it takes no
 * pointer events here); controls placed over it opt out with
 * `-webkit-app-region: no-drag`. A take-over whose contribution goes away is
 * closed.
 */
export function TakeoverHost() {
	const ui = useShellUi();
	const shown = useShownTakeover();
	const takeovers = useExtensions(Takeover);
	const contribution = shown
		? takeovers.find((candidate) => candidate.key === shown.key)
		: undefined;

	useEffect(() => {
		if (shown && !contribution) ui.closeTakeover();
	}, [contribution, shown, ui]);

	if (!shown || !contribution) return null;
	const props: TakeoverProps = { close: () => ui.closeTakeover(), input: shown.input };
	return (
		<div
			role="region"
			aria-label={contribution.metadata.title}
			data-qa-id="shell-takeover"
			data-takeover={shown.key}
			className="fixed inset-0 z-[45] flex flex-col"
		>
			<div
				aria-hidden
				className="drag-region pointer-events-none absolute inset-x-0 top-0 h-(--shell-titlebar-height)"
			/>
			<RenderContribution key={shown.key} contribution={contribution} props={props} />
		</div>
	);
}
