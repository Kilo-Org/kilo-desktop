import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@kilo-desktop/ui/lib/utils";

/**
 * Loading spinner: three dots orbiting an equilateral triangle.
 *
 * Implements the Kendo `infinite-spinner` loading motion. Geometry follows
 * Kendo's tokens: the dot is
 * the only free variable, and the canvas derives from it —
 * `width = dot * 3`, `height = dot * 4 * sin(60°) - dot`. Expressing that as
 * `calc()` off a single `--spinner-dot` keeps the triangle equilateral at
 * every size instead of hard-coding three sets of fractional pixels.
 *
 * Requires `@kilo-desktop/ui/styles/animations.css` for the
 * `spinner-orbit` keyframes. Colour comes from `currentColor`, so set it with
 * a text utility (`text-primary`, `text-muted-foreground`, …).
 */
const spinnerVariants = cva("relative inline-block shrink-0 leading-none", {
	variants: {
		size: {
			sm: "[--spinner-dot:0.25rem]",
			md: "[--spinner-dot:0.5rem]",
			lg: "[--spinner-dot:1rem]",
		},
	},
	defaultVariants: {
		size: "md",
	},
});

/** sin(60°) — height of an equilateral triangle relative to its side. */
const EQUILATERAL_HEIGHT = 0.8660254038;

/** Stagger, in seconds, between each dot. One third of the 2s cycle. */
const CYCLE_SECONDS = 2;

function Spinner({
	className,
	size,
	label = "Loading",
	...props
}: React.ComponentProps<"span"> &
	VariantProps<typeof spinnerVariants> & {
		/** Accessible name announced by assistive tech. */
		label?: string;
	}) {
	return (
		<span
			data-slot="spinner"
			role="status"
			aria-label={label}
			className={cn(spinnerVariants({ size }), className)}
			style={{ padding: "calc(var(--spinner-dot) / 2)" }}
			{...props}
		>
			<span
				aria-hidden="true"
				className="relative block"
				style={{
					width: "calc(var(--spinner-dot) * 3)",
					height: `calc(var(--spinner-dot) * 4 * ${EQUILATERAL_HEIGHT} - var(--spinner-dot))`,
				}}
			>
				{[0, 1, 2].map((index) => (
					<span
						key={index}
						className="absolute block -translate-x-1/2 -translate-y-1/2 rounded-full bg-current"
						style={{
							width: "var(--spinner-dot)",
							height: "var(--spinner-dot)",
							// Start each dot on its own vertex so the first frame is a
							// complete triangle rather than three stacked dots.
							top: index === 0 ? "0" : "100%",
							left: index === 0 ? "50%" : index === 1 ? "0" : "100%",
							animation: `spinner-orbit ${CYCLE_SECONDS}s ease infinite`,
							animationDelay: `-${((CYCLE_SECONDS / 3) * index).toFixed(4)}s`,
						}}
					/>
				))}
			</span>
		</span>
	);
}

export { Spinner, spinnerVariants };
