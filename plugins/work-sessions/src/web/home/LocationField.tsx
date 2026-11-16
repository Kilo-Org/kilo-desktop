import { useId, type ReactNode } from "react";

/**
 * One segment of the New Session page's location capsule (see
 * `LocationCapsule`): a picker (a ghost trigger button, possibly contributed)
 * or a read-only value (the current branch). Its label is drawn inside the
 * picker, ahead of its value, so label and value are one target that fills
 * on hover, and the picker's menu opens under the label.
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
			<div className="[&>*]:before:text-muted-foreground [&>button]:hover:bg-foreground/7! [&>button]:aria-expanded:bg-foreground/7! flex min-w-0 items-center [&>*]:before:me-1.5 [&>*]:before:font-normal [&>*]:before:content-(--location-label) [&>:not(button)]:px-2.5 [&>button]:h-7.5 [&>button]:min-w-0 [&>button]:shrink [&>button]:gap-1.5 [&>button]:rounded-[8px] [&>button]:px-2.5!">
				{children}
			</div>
		</div>
	);
}
