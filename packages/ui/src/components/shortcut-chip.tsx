import { Fragment } from "react";

export const SHORTCUT_CHIP =
	"text-foreground/80 inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-(color:--state-selected) px-2.5 text-xs font-medium tracking-wide whitespace-nowrap";

/** Several shortcuts for one command read "A or B", so they don't look like one combination. */
export function ShortcutLabels({ labels }: { readonly labels: readonly string[] }) {
	return labels.map((label, index) => (
		<Fragment key={label}>
			{index > 0 ? <span className="text-muted-foreground text-xs font-normal">or</span> : null}
			<span>{label}</span>
		</Fragment>
	));
}

export function ShortcutChip({ labels }: { readonly labels: readonly string[] }) {
	return (
		<span className={SHORTCUT_CHIP}>
			<ShortcutLabels labels={labels} />
		</span>
	);
}
