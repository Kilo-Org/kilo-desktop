import { FastForwardIcon, HandIcon } from "lucide-react";

import { useDomain, useDomainState } from "@kilo-desktop/kernel/web";

import {
	AutoApprove,
	type ApprovalMode,
	type ComposerActionImplementation,
	type ComposerActionMenu,
} from "../../contracts";

const APPROVAL_MODES = [
	{ id: "manual", label: "Manually approve", shortLabel: "Manual", icon: HandIcon },
	{ id: "auto", label: "Automatically approve", shortLabel: "Auto", icon: FastForwardIcon },
] as const;

const selectMode = (state: { mode: ApprovalMode }) => state.mode;

/** The approval picker: whether permission requests are answered for the person. */
export function useApprovalMenu(): ComposerActionMenu {
	const autoApprove = useDomain(AutoApprove);
	const mode = useDomainState(AutoApprove, selectMode) ?? "manual";
	const selected = APPROVAL_MODES.find((entry) => entry.id === mode) ?? APPROVAL_MODES[0];
	return {
		label: selected.shortLabel,
		icon: selected.icon,
		ariaLabel: `Approval mode: ${selected.shortLabel}`,
		disabled: !autoApprove,
		value: mode,
		align: "end",
		items: APPROVAL_MODES.map(({ id, label, icon }) => ({ id, label, icon })),
		select: (id) =>
			void autoApprove?.methods
				.setMode({ mode: id === "auto" ? "auto" : "manual" })
				.catch(() => undefined),
	};
}

/** kilo.chat's approval picker, through its own `composer-action` point. */
export const approvalAction: ComposerActionImplementation = {
	kind: "menu",
	useMenu: useApprovalMenu,
};
