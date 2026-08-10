import type { ComponentProps, HTMLAttributes } from "react";

import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			data-slot="interaction-card"
			className={cn(
				"bg-card text-card-foreground flex flex-col rounded-xl border shadow-sm",
				className,
			)}
			{...props}
		/>
	);
}

function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			data-slot="interaction-card-header"
			className={cn("flex flex-col gap-1.5", className)}
			{...props}
		/>
	);
}

function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
	return (
		<h3
			data-slot="interaction-card-title"
			className={cn("leading-none font-semibold tracking-tight", className)}
			{...props}
		/>
	);
}

function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
	return (
		<p
			data-slot="interaction-card-description"
			className={cn("text-muted-foreground text-sm", className)}
			{...props}
		/>
	);
}

function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div data-slot="interaction-card-content" className={cn("", className)} {...props} />;
}

function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			data-slot="interaction-card-footer"
			className={cn("flex items-center", className)}
			{...props}
		/>
	);
}

function Badge({
	className,
	variant = "secondary",
	...props
}: ComponentProps<"span"> & { variant?: "secondary" | "outline" }) {
	return (
		<span
			data-slot="interaction-badge"
			className={cn(
				"inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
				variant === "secondary" && "bg-secondary text-secondary-foreground border-transparent",
				variant === "outline" && "text-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export { Badge, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
