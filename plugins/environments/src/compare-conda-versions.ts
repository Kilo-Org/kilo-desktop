/**
 * Compare two conda version strings, returning a negative number when
 * `a < b`, zero when equal, and a positive number when `a > b`.
 *
 * This is a pragmatic dotted-component comparison: it splits on `.`/`-`/`_`,
 * then compares component-by-component numerically when both sides are
 * integers and lexically otherwise (a numeric component sorts ahead of an
 * alphabetic one, so `1.1` > `1.1a`). It covers the numeric, CalVer, and
 * dotted-release strings conda repodata actually produces.
 *
 * Shared between main and renderer — keep this module free of process-
 * specific imports.
 */
export function compareCondaVersions(a: string, b: string): number {
	const aParts = a.split(/[._-]/);
	const bParts = b.split(/[._-]/);
	const length = Math.max(aParts.length, bParts.length);

	for (let i = 0; i < length; i++) {
		const aPart = aParts[i];
		const bPart = bParts[i];
		if (aPart === undefined) return -1;
		if (bPart === undefined) return 1;
		if (aPart === bPart) continue;

		const aNum = /^\d+$/.test(aPart) ? Number(aPart) : null;
		const bNum = /^\d+$/.test(bPart) ? Number(bPart) : null;

		if (aNum !== null && bNum !== null) {
			if (aNum !== bNum) return aNum - bNum;
			continue;
		}
		if (aNum !== null) return 1;
		if (bNum !== null) return -1;
		return aPart < bPart ? -1 : 1;
	}
	return 0;
}
