export function dominantOpaqueColor(pixels: Uint8ClampedArray): string | null {
	const counts = new Map<number, number>();
	let dominant = -1;
	let dominantCount = 0;
	for (let index = 0; index + 3 < pixels.length; index += 4) {
		if (pixels[index + 3]! < 128) continue;
		const color = (pixels[index]! << 16) | (pixels[index + 1]! << 8) | pixels[index + 2]!;
		const count = (counts.get(color) ?? 0) + 1;
		counts.set(color, count);
		if (count > dominantCount) {
			dominant = color;
			dominantCount = count;
		}
	}
	if (dominant < 0) return null;
	return `rgb(${(dominant >> 16) & 0xff} ${(dominant >> 8) & 0xff} ${dominant & 0xff})`;
}
