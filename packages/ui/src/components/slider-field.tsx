import type { ComponentProps, ReactNode } from "react";

import { cn } from "@kilo-desktop/ui/lib/utils";
import { Input } from "@kilo-desktop/ui/components/input";
import { Label } from "@kilo-desktop/ui/components/label";
import { Slider } from "@kilo-desktop/ui/components/slider";

type SliderFieldProps = Omit<ComponentProps<typeof Slider>, "value" | "defaultValue"> & {
	/** A single-thumb value; stock Slider takes arrays, so it is wrapped here. */
	value: number;
	input: ComponentProps<typeof Input>;
	inputAddon?: ReactNode;
	label?: ReactNode;
	labelAddon?: ReactNode;
};

/**
 * Labelled single-value slider with a numeric input beside it: the label row
 * holds the label, its addon, and the input (plus an optional addon), with the
 * stock Slider underneath. Composes stock primitives only.
 */
function SliderField({
	id,
	value,
	input,
	inputAddon,
	label,
	labelAddon,
	...sliderProps
}: SliderFieldProps) {
	const { className: inputClassName, ...inputProps } = input;
	return (
		<div className="flex min-w-0 flex-col gap-2" data-slot="slider-field">
			<div className="flex items-center justify-between gap-3">
				{label || labelAddon ? (
					<div className="flex min-w-0 items-center gap-1">
						{label ? <Label htmlFor={id}>{label}</Label> : null}
						{labelAddon}
					</div>
				) : null}
				<div className="ml-auto flex shrink-0 items-center gap-1">
					{inputAddon}
					<Input
						className={cn(
							"h-6 w-auto max-w-28 min-w-10 shrink-0 px-1.5 text-right text-xs tabular-nums [appearance:textfield] [field-sizing:content] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
							inputClassName,
						)}
						{...inputProps}
					/>
				</div>
			</div>
			<Slider id={id} value={[value]} {...sliderProps} />
		</div>
	);
}

export { SliderField };
