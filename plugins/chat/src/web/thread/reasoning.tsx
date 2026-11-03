import type { ReasoningMessagePartComponent } from "@assistant-ui/react";
import { memo, useRef } from "react";

import { cn } from "@kilo-desktop/ui/lib/utils";

import { MarkdownText } from "./markdown-text";
import { useBottomPin } from "./use-bottom-pin";

/** Reasoning in a capped scroll box: the thinking activity subgroup's body. */
export function ReasoningText({
	className,
	children,
	pinning,
	...props
}: React.ComponentProps<"div"> & {
	/** Pin the scroll box to the bottom while new content streams in. */
	pinning?: boolean;
}) {
	const isPreview = pinning ?? false;
	const scrollRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	useBottomPin(scrollRef, contentRef, isPreview);

	return (
		<div
			ref={scrollRef}
			data-slot="reasoning-text"
			className={cn(
				"aui-reasoning-text scroll-fade-y relative z-0 max-h-64 overflow-y-auto ps-6 pt-2 pb-2 leading-relaxed text-pretty",
				"transform-gpu transition-[transform,opacity] ease-[cubic-bezier(0.32,0.72,0,1)]",
				"motion-reduce:animate-none",
				"group-data-open/collapsible-content:animate-in",
				"group-data-closed/collapsible-content:animate-out",
				"group-data-open/collapsible-content:fade-in-0",
				"group-data-closed/collapsible-content:fade-out-0",
				"group-data-open/collapsible-content:slide-in-from-top-4",
				"group-data-closed/collapsible-content:slide-out-to-top-4",
				"group-data-open/collapsible-content:blur-in-[2px]",
				"group-data-closed/collapsible-content:blur-out-[2px]",
				"group-data-open/collapsible-content:duration-(--animation-duration)",
				"group-data-closed/collapsible-content:duration-(--animation-duration)",
				className,
			)}
			{...props}
		>
			<div ref={contentRef} className="aui-reasoning-text-content space-y-4">
				{children}
			</div>
		</div>
	);
}

const ReasoningImpl: ReasoningMessagePartComponent = () => <MarkdownText />;

/** A reasoning part outside any activity group, as markdown. */
export const Reasoning = memo(ReasoningImpl);
Reasoning.displayName = "Reasoning";
