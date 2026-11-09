import type { ReactNode } from "react";
import type { VariantProps } from "class-variance-authority";

import { buttonVariants } from "./button";
import { cn } from "../lib/utils";

/**
 * A pulsing placeholder with the exact box of a real `Button`: it reuses the
 * button's size classes and renders the real label (and icons, via
 * currentColor) in transparent text, so width, height, and radius match the
 * control that replaces it.
 */
export function ButtonSkeleton({
	size = "sm",
	className,
	children,
}: {
	size?: VariantProps<typeof buttonVariants>["size"];
	className?: string;
	children: ReactNode;
}) {
	return (
		<span
			aria-hidden="true"
			data-slot="skeleton"
			className={cn(
				buttonVariants({ variant: "ghost", size }),
				"bg-muted pointer-events-none animate-pulse text-transparent",
				className,
			)}
		>
			{children}
		</span>
	);
}
