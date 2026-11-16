import { useId, type ReactNode } from "react";

/**
 * One of the New Session page's "where it runs" fields, inline in one row:
 * its label is drawn inside the picker, ahead of its value, so label and
 * value are one target that fills on hover, and the picker's menu opens under
 * the label, where the control starts. The picker (a ghost trigger button,
 * possibly contributed) gets the composer toolbar's hover box; a read-only
 * value (the current branch) sits in it as text.
 */
export function LocationField({
	label,
	children,
}: {
	readonly label: string;
	readonly children: ReactNode;
}) {
	const id = useId();
	return (
		<div
			role="group"
			aria-labelledby={id}
			className="flex min-w-0 items-center"
			style={{ ["--location-label" as string]: JSON.stringify(label) }}
		>
			<span id={id} className="sr-only">
				{label}
			</span>
			{/* The label is generated content of the picker, not a sibling, so the picker's menu anchors at it. */}
			<div className="[&>*]:before:text-muted-foreground [&>button]:hover:bg-foreground/7! [&>button]:aria-expanded:bg-foreground/7! flex min-w-0 items-center [&>*]:before:me-1.5 [&>*]:before:text-[0.8rem] [&>*]:before:font-normal [&>*]:before:content-(--location-label) [&>:not(button)]:ps-3 [&>button]:h-8 [&>button]:min-w-0 [&>button]:gap-1.5 [&>button]:rounded-md [&>button]:px-3!">
				{children}
			</div>
		</div>
	);
}
