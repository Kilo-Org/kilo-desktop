import { FastForwardIcon, HandIcon } from "lucide-react";

import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";

import {
	AutoApprove,
	type ApprovalMode,
	type ComposerActionImplementation,
	type ComposerActionMenu,
	type ComposerActionStateProps,
} from "../../contracts";

const APPROVAL_MODES = [
	{ id: "manual", label: "Manually approve", shortLabel: "Manual", icon: HandIcon },
	{ id: "auto", label: "Automatically approve", shortLabel: "Auto", icon: FastForwardIcon },
] as const;

const selectMode = (state: { mode: ApprovalMode }) => state.mode;

/** The approval picker: whether permission requests are answered for the person. */
function ApprovalMenu({ children }: ComposerActionStateProps<ComposerActionMenu>) {
	const autoApprove = useDomainObject(AutoApprove);
	const mode = useDomainObjectState(AutoApprove, selectMode) ?? "manual";
	const selected = APPROVAL_MODES.find((entry) => entry.id === mode) ?? APPROVAL_MODES[0];
	return children({
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
	});
}

/** kilo.chat's approval picker, through its own `composer-action` point. */
export const approvalAction: ComposerActionImplementation = {
	kind: "menu",
	Menu: ApprovalMenu,
};
