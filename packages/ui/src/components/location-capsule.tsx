import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * A row of labelled fields as one capsule, as the New Session page shows
 * where a session runs (Workspace › Use › Branch) and its workbook. It sizes
 * to its content, and its width animates when a value changes, so the
 * capsule eases to its new size instead of jumping. Put it in an `@container`
 * element: it is never wider than that, and its segments truncate instead.
 */
export function LocationCapsule({
	children,
	"data-qa-id": qaId = "launcher-location-capsule",
}: {
	readonly children: ReactNode;
	readonly "data-qa-id"?: string;
}) {
	const content = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState<number>();
	useLayoutEffect(() => {
		const element = content.current;
		if (!element) return;
		const observer = new ResizeObserver(() => setWidth(element.offsetWidth));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return (
		<div
			data-qa-id={qaId}
			// Width is measured from the content, so the first frame is unanimated (undefined → auto).
			style={width === undefined ? undefined : { width }}
			className="bg-foreground/6 max-w-full overflow-hidden rounded-[10px] transition-[width] duration-250 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
		>
			<div
				ref={content}
				// Never wider than the row (the enclosing container): segments then
				// shrink and truncate instead of being clipped. Separators: every segment after
				// the first starts with a thin vertical rule.
				className="[&_[role=group]]:before:bg-foreground/15 flex w-max max-w-[100cqw] items-center p-0.5 text-[0.8rem] [&_[role=group]]:before:mx-1 [&_[role=group]]:before:h-4 [&_[role=group]]:before:w-px [&_[role=group]]:before:content-[''] [&>[role=group]:first-child]:before:content-none"
			>
				{children}
			</div>
		</div>
	);
}

/**
 * One segment of a `LocationCapsule`: a picker (a ghost trigger button, possibly contributed)
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
