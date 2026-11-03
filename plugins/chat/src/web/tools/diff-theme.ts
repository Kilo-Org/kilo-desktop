import type { DomainState } from "@kilo-desktop/kernel";
import { useDomainState } from "@kilo-desktop/kernel/web";
import { Theme } from "@kilo-desktop/plugin-shell/contracts";

export interface DiffTheme {
	readonly mode: "light" | "dark";
	readonly shiki: string;
}

/** Without kilo.shell's theme (tests, a removed shell) diffs use Pierre's defaults. */
const FALLBACK: DiffTheme = { mode: "light", shiki: "pierre-light" };

const selectTheme = (state: DomainState<typeof Theme>) => `${state.mode}\n${state.shiki}`;

/** The window's theme as diffs paint it: light or dark, and its Shiki theme. */
export function useDiffTheme(): DiffTheme {
	const key = useDomainState(Theme, selectTheme);
	if (!key) return FALLBACK;
	const [mode, shiki] = key.split("\n") as [DiffTheme["mode"], string];
	return { mode, shiki };
}
