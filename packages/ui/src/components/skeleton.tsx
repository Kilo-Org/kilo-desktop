import { cn } from "@kilo-desktop/ui/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="skeleton"
			className={cn("animate-pulse rounded-md bg-muted", className)}
			{...props}
		/>
	);
}

/**
 * A skeleton bar that occupies one line of the surrounding text. The
 * zero-width strut takes on the inherited font and line-height, so placing it
 * inside the real title/description element (e.g. `SummaryCard.Description`)
 * reserves exactly the height the loaded text will use. Renders only spans, so
 * it is valid inside `<p>` and inline contexts. Size the bar with `className`.
 */
function SkeletonText({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="skeleton-text"
			aria-hidden="true"
			className="inline-flex max-w-full min-w-0 items-center align-top"
		>
			{"\u200B"}
			<span
				className={cn(
					"animate-pulse rounded-md bg-muted inline-block h-[1em] max-w-full",
					className,
				)}
				{...props}
			/>
		</span>
	);
}

export { Skeleton, SkeletonText };
