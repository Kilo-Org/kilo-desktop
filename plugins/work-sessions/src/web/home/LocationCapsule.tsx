import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * The New Session page's location fields as one centered capsule:
 * Workspace › Use › Branch, the order each depends on the one before. It
 * sizes to its content, and its width animates when a value changes, so the
 * capsule eases to its new size instead of jumping. A segment that isn't
 * there (no git repository: no Use, no Branch) simply ends the crumb.
 */
export function LocationCapsule({ children }: { readonly children: ReactNode }) {
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
			data-qa-id="launcher-location-capsule"
			// Width is measured from the content, so the first frame is unanimated (undefined → auto).
			style={width === undefined ? undefined : { width }}
			className="bg-foreground/6 max-w-full overflow-hidden rounded-[10px] transition-[width] duration-250 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
		>
			<div
				ref={content}
				// Never wider than the row (`launcher-location` is the container): segments then
				// shrink and truncate instead of being clipped. Separators: every segment after
				// the first starts with a thin vertical rule.
				className="[&_[role=group]]:before:bg-foreground/15 flex w-max max-w-[100cqw] items-center p-0.5 text-[0.8rem] [&_[role=group]]:before:mx-1 [&_[role=group]]:before:h-4 [&_[role=group]]:before:w-px [&_[role=group]]:before:content-[''] [&>[role=group]:first-child]:before:content-none"
			>
				{children}
			</div>
		</div>
	);
}
