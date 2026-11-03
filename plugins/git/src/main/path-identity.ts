import { realpath as realpathCallback } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

export type Realpath = (target: string) => Promise<string>;

/**
 * How kilo.git decides that two paths name the same place, or that one is
 * inside another, before matching caller paths against workspace folders and
 * `git worktree list` output. The two sides routinely disagree in spelling:
 *
 * - Windows 8.3 short names (`C:\Users\RUNNER~1\…` from a `TEMP` or a long
 *   user name) versus the long form git prints; macOS symlinked folders
 *   (`/var` → `/private/var`). `canonical` resolves these with the native
 *   realpath, which expands short names, for the longest existing prefix.
 * - Letter case: Windows and the default macOS volume ignore it, so
 *   comparisons fold case there (a case-sensitive APFS volume is the
 *   accepted exception); Linux keeps it significant.
 *
 * Comparisons only ever use these canonical keys — callers keep returning
 * the paths git or the user gave them, so nothing they display changes.
 */
export interface PathIdentity {
	/** `target` with symlinks and short names resolved as far as it exists. */
	canonical(target: string): Promise<string>;
	/** Whether `a` and `b` spell the same path. Lexical: canonicalize first. */
	same(a: string, b: string): boolean;
	/** Whether `candidate` is `folder` itself or inside it. Lexical: canonicalize first. */
	within(folder: string, candidate: string): boolean;
}

export interface PathIdentityOptions {
	readonly platform?: NodeJS.Platform;
	readonly realpath?: Realpath;
}

const nativeRealpath: Realpath = promisify(realpathCallback.native);

export function createPathIdentity(options: PathIdentityOptions = {}): PathIdentity {
	const platform = options.platform ?? process.platform;
	const realpath = options.realpath ?? nativeRealpath;
	const api = platform === "win32" ? path.win32 : path.posix;
	const ignoresCase = platform === "win32" || platform === "darwin";
	const key = (target: string) => {
		const resolved = api.resolve(target);
		return ignoresCase ? resolved.toLowerCase() : resolved;
	};

	const canonical = async (target: string): Promise<string> => {
		const absolute = api.resolve(target);
		try {
			return await realpath(absolute);
		} catch {
			const parent = api.dirname(absolute);
			if (parent === absolute) return absolute;
			return api.join(await canonical(parent), api.basename(absolute));
		}
	};

	return {
		canonical,
		same: (a, b) => key(a) === key(b),
		within: (folder, candidate) => {
			const relative = api.relative(key(folder), key(candidate));
			return (
				relative === "" ||
				(relative !== ".." && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative))
			);
		},
	};
}

/** The host's path identity. */
export const hostPathIdentity: PathIdentity = createPathIdentity();
