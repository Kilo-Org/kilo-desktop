/**
 * Create a new parser suitable for parsing --format output from commands such
 * as `git for-each-ref`, `git branch`, and other commands that are not derived
 * from `git log`.
 *
 * Returns an object with the arguments that need to be appended to the git
 * call and the parse function itself
 *
 * @param fields An object keyed on the friendly name of the value being
 *               parsed with the value being the format string of said value.
 *
 *               Example:
 *
 *               `const { args, parse } = createForEachRefParser({ sha: '%(objectname)' })`
 */
export function createForEachRefParser<T extends Record<string, string>>(fields: T) {
	const keys: Array<keyof T> = Object.keys(fields);
	const format = Object.values(fields).join("%00");
	const formatArgs = [`--format=%00${format}%00`];

	const parse = (value: string) => {
		const records = value.split("\0");
		const entries = new Array<{ [K in keyof T]: string }>();

		let entry: { [K in keyof T]: string } | undefined;
		let consumed = 0;

		// start at 1 to avoid 0 modulo X problem. The first record is guaranteed
		// to be empty anyway (due to %00 at the start of --format)
		for (let i = 1; i < records.length - 1; i++) {
			if (i % (keys.length + 1) === 0) {
				if (records[i] !== "\n") {
					throw new Error("Expected newline");
				}
				continue;
			}

			entry = entry ?? ({} as { [K in keyof T]: string });
			const key = keys[consumed % keys.length]!;
			entry[key] = records[i]!;
			consumed++;

			if (consumed % keys.length === 0) {
				entries.push(entry);
				entry = undefined;
			}
		}

		return entries;
	};

	return { formatArgs, parse };
}
