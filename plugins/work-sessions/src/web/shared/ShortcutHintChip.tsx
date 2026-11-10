export function ShortcutHintChip({ label }: { label: string }) {
	return (
		<kbd
			aria-hidden
			data-slot="shortcut-hint"
			className="bg-foreground/10 text-foreground inline-flex h-4 shrink-0 items-center rounded-[4px] px-1 font-sans text-[10px] leading-none font-medium tabular-nums [[data-shortcut-hints-hidden]_&]:hidden"
		>
			{label}
		</kbd>
	);
}
