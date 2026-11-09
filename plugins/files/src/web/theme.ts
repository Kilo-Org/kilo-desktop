import type { DomainState } from "@kilo-desktop/kernel";
import { useDomainState } from "@kilo-desktop/kernel/web";
import { Theme } from "@kilo-desktop/plugin-shell/contracts";

export interface FilesTheme {
	readonly mode: "light" | "dark";
	readonly shiki: string;
}

/** Without kilo.shell's theme (tests, a removed shell) files use Pierre's defaults. */
const FALLBACK: FilesTheme = { mode: "light", shiki: "pierre-light" };

const selectTheme = (state: DomainState<typeof Theme>) => `${state.mode}\n${state.shiki}`;

/** The window's theme as the editor and the file tree paint it: light or dark, and its Shiki theme. */
export function useFilesTheme(): FilesTheme {
	const key = useDomainState(Theme, selectTheme);
	if (!key) return FALLBACK;
	const [mode, shiki] = key.split("\n") as [FilesTheme["mode"], string];
	return { mode, shiki };
}
