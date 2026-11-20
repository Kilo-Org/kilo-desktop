/**
 * Split work across CI shards by recorded duration, so shards finish together
 * instead of one shard holding the slowest items.
 *
 * Every shard must compute the same plan from the same inputs, so the result
 * is deterministic: items are placed longest first (ties by id) onto the
 * currently lightest shard (ties by index). Each item lands in exactly one
 * shard; shards may end up empty when there are fewer items than shards.
 *
 * Durations only steer the balance. Items without a recorded duration get the
 * median of the known ones, so a new spec or package is still placed sensibly
 * and stale data can never drop an item.
 */

/**
 * @param {string | undefined} value "current/total", 1-based, e.g. "2/3"; empty means no sharding
 * @returns {{ current: number, total: number } | undefined}
 */
export function parseShard(value) {
	if (!value?.trim()) return undefined;
	// A malformed value must not quietly mean "no sharding": that shard
	// would run everything.
	const match = /^(\d+)\/(\d+)$/.exec(value.trim());
	if (!match) throw new Error(`Invalid shard "${value}": expected current/total, e.g. 2/3`);
	const current = Number(match[1]);
	const total = Number(match[2]);
	if (total < 1 || current < 1 || current > total) {
		throw new Error(`Invalid shard "${value}": expected current/total with 1 <= current <= total`);
	}
	return { current, total };
}

/**
 * @param {readonly string[]} ids
 * @param {Readonly<Record<string, number>>} durations seconds per id
 * @returns {Map<string, number>}
 */
export function weigh(ids, durations) {
	const known = ids
		.map((id) => durations[id])
		// Zero is a spec whose tests the run's grep filtered out, not a time.
		.filter((value) => typeof value === "number" && value > 0)
		.sort((a, b) => a - b);
	const fallback = known.length ? known[Math.floor(known.length / 2)] : 1;
	return new Map(ids.map((id) => [id, durations[id] ?? fallback]));
}

/**
 * @param {ReadonlyMap<string, number>} weights seconds per id
 * @param {number} total number of shards
 * @returns {string[][]} ids per shard, index 0 is shard 1
 */
export function assignShards(weights, total) {
	const shards = Array.from({ length: total }, () => ({ ids: [], load: 0 }));
	const ordered = [...weights].sort(([idA, a], [idB, b]) => b - a || (idA < idB ? -1 : 1));
	for (const [id, weight] of ordered) {
		let lightest = shards[0];
		for (const shard of shards) if (shard.load < lightest.load) lightest = shard;
		lightest.ids.push(id);
		lightest.load += weight;
	}
	return shards.map((shard) => shard.ids.sort());
}

/**
 * Seconds per spec file, counting only recorded tests the run's `grep` keeps.
 * Playwright matches `grep` against the title path, which starts with the
 * spec file path; recorded titles join describe and test with " › ".
 * Files with no recorded tests are left out, so `weigh` gives them the median.
 *
 * @param {readonly string[]} files repo-relative posix paths
 * @param {Readonly<Record<string, Readonly<Record<string, number>>>>} durations seconds per test title, per file
 * @param {RegExp} [grep]
 * @returns {Record<string, number>}
 */
export function weighSpecFiles(files, durations, grep) {
	/** @type {Record<string, number>} */
	const weights = {};
	for (const file of files) {
		const tests = durations[file];
		if (!tests) continue;
		weights[file] = Object.entries(tests)
			.filter(([title]) => !grep || grep.test(`${file} ${title.replaceAll(" › ", " ")}`))
			.reduce((sum, [, seconds]) => sum + seconds, 0);
	}
	return weights;
}

/**
 * The ids one shard runs.
 *
 * @param {readonly string[]} ids
 * @param {Readonly<Record<string, number>>} durations
 * @param {{ current: number, total: number }} shard
 */
export function idsForShard(ids, durations, shard) {
	return assignShards(weigh(ids, durations), shard.total)[shard.current - 1];
}
