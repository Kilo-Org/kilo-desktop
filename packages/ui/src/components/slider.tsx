"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import type { ComponentProps, ReactNode } from "react";

import { Input } from "@kilo-desktop/ui/components/input";
import { Label } from "@kilo-desktop/ui/components/label";
import { cn } from "@kilo-desktop/ui/lib/utils";

type SliderProps = SliderPrimitive.Root.Props & {
	input?: ComponentProps<typeof Input> | undefined;
	inputAddon?: ReactNode;
	label?: ReactNode;
	labelAddon?: ReactNode;
};

function thumbsFor(value: unknown, defaultValue: unknown, min: number): number[] {
	if (Array.isArray(value)) return value as number[];
	if (typeof value === "number") return [value];
	if (Array.isArray(defaultValue)) return defaultValue as number[];
	if (typeof defaultValue === "number") return [defaultValue];
	return [min];
}

function Slider({
	className,
	defaultValue,
	input,
	inputAddon,
	label,
	labelAddon,
	value,
	min = 0,
	max = 100,
	...props
}: SliderProps) {
	const thumbs = thumbsFor(value, defaultValue, min);

	const slider = (
		<SliderPrimitive.Root
			className={cn("data-horizontal:w-full data-vertical:h-full", className)}
			data-slot="slider"
			defaultValue={defaultValue}
			value={value}
			min={min}
			max={max}
			thumbAlignment="edge"
			{...props}
		>
			<SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
				<SliderPrimitive.Track
					data-slot="slider-track"
					className="bg-muted relative grow overflow-hidden rounded-full select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
				>
					<SliderPrimitive.Indicator
						data-slot="slider-range"
						className="bg-primary select-none data-horizontal:h-full data-vertical:w-full"
					/>
				</SliderPrimitive.Track>
				{thumbs.map((_, index) => (
					<SliderPrimitive.Thumb
						data-slot="slider-thumb"
						key={index}
						className="border-ring ring-ring/50 bg-background relative block size-3 shrink-0 rounded-full border transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50"
					/>
				))}
			</SliderPrimitive.Control>
		</SliderPrimitive.Root>
	);

	if (!input) return slider;

	const { className: inputClassName, ...inputProps } = input;
	return (
		<div className="flex min-w-0 flex-col gap-2" data-slot="slider-with-input">
			<div className="flex items-center justify-between gap-3">
				{label || labelAddon ? (
					<div className="flex min-w-0 items-center gap-1">
						{label ? <Label htmlFor={props.id}>{label}</Label> : null}
						{labelAddon}
					</div>
				) : null}
				<div className="ml-auto flex shrink-0 items-center gap-1">
					{inputAddon}
					<Input
						className={cn(
							"h-6 w-auto min-w-10 max-w-28 shrink-0 px-1.5 text-right text-xs tabular-nums [appearance:textfield] [field-sizing:content] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
							inputClassName,
						)}
						{...inputProps}
					/>
				</div>
			</div>
			<div className="min-w-0">{slider}</div>
		</div>
	);
}

export { Slider };
