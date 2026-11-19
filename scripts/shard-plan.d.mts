export interface Shard {
	current: number;
	total: number;
}

export function parseShard(value: string | undefined): Shard | undefined;
export function weigh(
	ids: readonly string[],
	durations: Readonly<Record<string, number>>,
): Map<string, number>;
export function assignShards(weights: ReadonlyMap<string, number>, total: number): string[][];
export function weighSpecFiles(
	files: readonly string[],
	durations: Readonly<Record<string, Readonly<Record<string, number>>>>,
	grep?: RegExp,
): Record<string, number>;
export function idsForShard(
	ids: readonly string[],
	durations: Readonly<Record<string, number>>,
	shard: Shard,
): string[];
