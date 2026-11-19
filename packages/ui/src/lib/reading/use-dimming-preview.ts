import { useState } from "react";

/**
 * The Dimming Focus shows: the slider's value while it is dragged, else the
 * saved one. A preview is made over the saved value of its time, so the
 * saved value takes over as soon as a newer one arrives (the release saved
 * it), without flicking back to the old value in between.
 */
export function useDimmingPreview(saved: number): {
	dimming: number;
	onDimmingInput: (dimming: number) => void;
} {
	const [preview, setPreview] = useState<{ value: number; over: number } | null>(null);
	const onDimmingInput = (value: number) => setPreview({ value, over: saved });
	return { dimming: preview?.over === saved ? preview.value : saved, onDimmingInput };
}
