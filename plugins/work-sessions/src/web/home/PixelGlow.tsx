import { useEffect, useRef } from "react";

/**
 * A static dot-matrix glow in Kilo yellow rising from the bottom of the New
 * Session page, spanning its full width. Dots sit on a fixed CSS-pixel grid
 * so they stay the same size at any window size. Which dots show is mostly
 * ordered (Bayer) dithering of the falloff, with a little hashed jitter so
 * the sparse upper edge doesn't read as a regular pattern; both key off the
 * grid position counted from the bottom-centre, so the pattern is stable
 * across resizes. Drawn once per size on a canvas: nothing animates.
 */

const KILO_YELLOW = "255 221 0";
const PITCH = 5;
const DOT = 2;
const ALPHA_STEPS = 24;
const MAX_ALPHA = 0.8;
const BAYER_4X4 = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5],
] as const;

function hash(column: number, row: number, seed: number): number {
	let h = Math.imul(column, 374761393) ^ Math.imul(row, 668265263) ^ Math.imul(seed, 2147483647);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Glow strength at `dx` (−1 left … 1 right) and `rise` (0 bottom … 1 top). */
function intensityAt(dx: number, rise: number): number {
	const band = (1 - rise) ** 2.2 * (1 - 0.55 * dx * dx);
	const core = Math.exp(-(dx * dx) / 0.25 - (rise * rise) / 0.1);
	return Math.min(1, band * 0.7 + core * 0.5);
}

function threshold(column: number, row: number): number {
	const ordered = (BAYER_4X4[row & 3]![column & 3]! + 0.5) / 16;
	return 0.75 * ordered + 0.25 * hash(column, row, 1);
}

function drawGlow(canvas: HTMLCanvasElement, width: number, height: number) {
	const ratio = window.devicePixelRatio || 1;
	canvas.width = Math.round(width * ratio);
	canvas.height = Math.round(height * ratio);
	const context = canvas.getContext("2d");
	if (!context) return;
	context.setTransform(ratio, 0, 0, ratio, 0, 0);
	context.clearRect(0, 0, width, height);

	const half = Math.ceil(width / PITCH / 2);
	const rows = Math.ceil(height / PITCH);
	const buckets: number[][] = Array.from({ length: ALPHA_STEPS + 1 }, () => []);
	for (let row = 0; row < rows; row++) {
		const rise = row / rows;
		const y = height - (row + 1) * PITCH;
		for (let column = -half; column <= half; column++) {
			const strength = intensityAt(column / half, rise);
			if (strength <= 0.02 || threshold(column, row) > strength * 1.6) continue;
			const alpha = strength * (0.8 + 0.2 * hash(column, row, 2));
			const step = Math.round(alpha * ALPHA_STEPS);
			if (step === 0) continue;
			buckets[step]!.push(width / 2 + column * PITCH - DOT / 2, y);
		}
	}

	buckets.forEach((points, step) => {
		if (points.length === 0) return;
		context.fillStyle = `rgb(${KILO_YELLOW} / ${(step / ALPHA_STEPS) * MAX_ALPHA})`;
		for (let i = 0; i < points.length; i += 2)
			context.fillRect(points[i]!, points[i + 1]!, DOT, DOT);
	});
}

export function PixelGlow() {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const observer = new ResizeObserver(([entry]) => {
			if (!entry) return;
			const { width, height } = entry.contentRect;
			drawGlow(canvas, width, height);
		});
		observer.observe(canvas);
		return () => observer.disconnect();
	}, []);

	return (
		<canvas
			ref={canvasRef}
			aria-hidden
			data-qa-id="launcher-pixel-glow"
			className="pointer-events-none absolute inset-x-0 bottom-0 h-[50%] w-full"
		/>
	);
}
