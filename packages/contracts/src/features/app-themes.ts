import type { TerminalPalette, ThemeAppearance } from "@kilo-desktop/feature-sdk";

import { themeChromeColors, type ResolvedColorScheme } from "./theme-tokens.js";

export { APP_THEME_STORAGE_KEY } from "./theme-tokens.js";
const ansiRoles = [
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"brightBlack",
	"brightRed",
	"brightGreen",
	"brightYellow",
	"brightBlue",
	"brightMagenta",
	"brightCyan",
	"brightWhite",
] as const;

type ShikiTheme =
	| "github-light"
	| "github-dark"
	| "pierre-light"
	| "pierre-dark"
	| "catppuccin-latte"
	| "catppuccin-mocha"
	| "dracula"
	| "gruvbox-light-medium"
	| "gruvbox-dark-medium"
	| "everforest-light"
	| "everforest-dark"
	| "nord";

type TerminalRolePalette = {
	background: string;
	foreground: string;
	hover: string;
	ansi: readonly [string, string, string, string, string, string, string, string];
};

function terminalPalette(palette: TerminalRolePalette): TerminalPalette {
	return {
		background: palette.background,
		foreground: palette.foreground,
		cursor: palette.foreground,
		cursorAccent: palette.background,
		selectionBackground: palette.hover,
		selectionForeground: palette.foreground,
		...(Object.fromEntries(
			[...palette.ansi, ...palette.ansi].map((color, index) => [ansiRoles[index], color]),
		) as { [K in (typeof ansiRoles)[number]]: string }),
	};
}

type StringTuple<Tuple extends readonly unknown[]> = { [Index in keyof Tuple]: string };

type RolePalette = {
	background: string;
	foreground: string;
	surface: string;
	draftComposer?: string;
	popover?: string;
	sidebar: string;
	hover: string;
	/** Standing `--muted` fill. Defaults to `hover` when omitted. */
	mutedFill?: string;
	muted: string;
	border: string;
	primary: string;
	primaryForeground: string;
	ring?: string;
	/** Per-theme remap of accent roles onto existing tokens (see ACCENT_ROLE_DEFAULTS). */
	roles?: Partial<typeof ACCENT_ROLE_DEFAULTS>;
	ansi: StringTuple<typeof ansiRoles>;
};

/**
 * Accent roles for places the raw accent can be unreadable. Defaults alias the
 * accent so themes render exactly as with `primary` directly; a theme may
 * remap them onto other existing tokens (never new colors).
 * - ink: link text, spinners, status dots, progress, checked toggle track.
 * - soft: selected/active chips, badges and icon tiles (wash + accent text).
 */
export const ACCENT_ROLE_DEFAULTS = {
	"primary-ink": "var(--primary)",
	"primary-ink-foreground": "var(--primary-foreground)",
	"primary-soft": "color-mix(in oklab, var(--primary) 10%, transparent)",
	"primary-soft-foreground": "var(--primary)",
};

const LIGHT_STATUS = {
	error: "#9f1239",
	info: "#1e40af",
	success: "#166534",
	warning: "#92400e",
	update: "#166534",
};

/** Pale tints that stay readable on the role's own 10–20% tinted chips. */
const DARK_STATUS_TEXT = {
	error: "#ffe4e6",
	info: "#dbeafe",
	success: "#bbf7d0",
	warning: "#fde68a",
	update: "#bbf7d0",
};

/**
 * Saturated dark hues for dots, icons and plain status text, most vivid first
 * (Tailwind 400, then 300). The pale text tint is the last resort.
 */
const DARK_STATUS_CANDIDATES = {
	error: ["#f87171", "#fca5a5", DARK_STATUS_TEXT.error],
	info: ["#60a5fa", "#93c5fd", DARK_STATUS_TEXT.info],
	success: ["#4ade80", "#86efac", DARK_STATUS_TEXT.success],
	warning: ["#fbbf24", "#fcd34d", DARK_STATUS_TEXT.warning],
} as const;

const MIN_TEXT_CONTRAST = 4.5;

function relativeLuminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((start) => {
		const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function isHexColor(value: string): boolean {
	return /^#[0-9a-f]{6}$/i.test(value);
}

function mixHex(top: string, bottom: string, amount: number): string {
	const channel = (hex: string, start: number) => Number.parseInt(hex.slice(start, start + 2), 16);
	return `#${[1, 3, 5]
		.map((start) =>
			Math.round(channel(top, start) * amount + channel(bottom, start) * (1 - amount))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
}

function contrastRatio(a: string, b: string): number {
	const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
		number,
		number,
	];
	return (light + 0.05) / (dark + 0.05);
}

function mostVividReadable(candidates: readonly string[], surfaces: readonly string[]): string {
	return (
		candidates.find((color) =>
			surfaces.every((surface) => contrastRatio(color, surface) >= MIN_TEXT_CONTRAST),
		) ?? candidates[candidates.length - 1]!
	);
}

function statusColors(p: RolePalette, mode: ResolvedColorScheme) {
	if (mode === "light") return { base: LIGHT_STATUS, text: LIGHT_STATUS };
	const surfaces = [p.background, p.surface, p.popover ?? p.surface];
	const pick = (role: keyof typeof DARK_STATUS_CANDIDATES) =>
		mostVividReadable(DARK_STATUS_CANDIDATES[role], surfaces);
	return {
		base: {
			error: pick("error"),
			info: pick("info"),
			success: pick("success"),
			warning: pick("warning"),
			update: DARK_STATUS_TEXT.update,
		},
		text: DARK_STATUS_TEXT,
	};
}

function variant(p: RolePalette, shiki: ShikiTheme, mode: ResolvedColorScheme) {
	// ANSI hues stay canonical. Status roles split in two: the base colour is
	// vivid for dots and icons, `-foreground` stays readable on tinted chips.
	const { base: status, text: statusText } = statusColors(p, mode);
	const ansi = Object.fromEntries(ansiRoles.map((role, index) => [role, p.ansi[index]])) as Record<
		(typeof ansiRoles)[number],
		string
	>;
	return {
		tokens: {
			background: p.background,
			foreground: p.foreground,
			card: p.surface,
			"composer-draft": p.draftComposer ?? p.surface,
			// Pane frames mix this into `--pane-raised`, which backs the glass
			// composer; it must stay solid even when `hover` is an overlay.
			"pane-raised-tint": p.mutedFill ?? p.hover,
			"card-foreground": p.foreground,
			popover: p.popover ?? p.surface,
			"popover-foreground": p.foreground,
			primary: p.primary,
			"primary-foreground": p.primaryForeground,
			secondary: p.hover,
			"secondary-foreground": p.foreground,
			muted: p.mutedFill ?? p.hover,
			"muted-foreground": p.muted,
			accent: p.hover,
			"accent-foreground": p.foreground,
			destructive: status.error,
			"destructive-foreground": statusText.error,
			border: p.border,
			input: p.border,
			ring: p.ring ?? p.primary,
			"chart-1": ansi.blue,
			"chart-2": ansi.green,
			"chart-3": ansi.yellow,
			"chart-4": ansi.magenta,
			"chart-5": ansi.cyan,
			sidebar: p.sidebar,
			"sidebar-foreground": p.foreground,
			"sidebar-primary": p.primary,
			"sidebar-primary-foreground": p.primaryForeground,
			"sidebar-accent": p.hover,
			"sidebar-accent-foreground": p.foreground,
			"sidebar-border": p.border,
			"sidebar-ring": p.ring ?? p.primary,
			...ACCENT_ROLE_DEFAULTS,
			...p.roles,
			info: status.info,
			"info-foreground": statusText.info,
			success: status.success,
			"success-foreground": statusText.success,
			warning: status.warning,
			"warning-foreground": statusText.warning,
			// Thumb derives from muted text, not border: palette borders sit too
			// close to popover and pane surfaces for the thumb to be seen on them.
			"app-scrollbar-thumb": `color-mix(in srgb, ${p.muted} 40%, transparent)`,
			"app-scrollbar-thumb-hover": `color-mix(in srgb, ${p.muted} 60%, transparent)`,
			update: status.update,
			"update-surface": p.surface,
			"update-surface-hover": p.hover,
		},
		terminal: {
			...ansi,
			background: p.background,
			foreground: p.foreground,
			cursor: p.foreground,
			cursorAccent: p.background,
			selectionBackground: isHexColor(p.hover) ? p.hover : mixHex(p.foreground, p.background, 0.05),
			selectionForeground: p.foreground,
		},
		shiki,
	};
}

/** CSS-owned preset: no token overrides, only a Ghostty-ready terminal palette. */
function cssTheme(palette: TerminalRolePalette, shiki: ShikiTheme) {
	return { tokens: null, terminal: terminalPalette(palette), shiki };
}

export type ThemeVariant = {
	tokens: ReturnType<typeof variant>["tokens"] | null;
	terminal: TerminalPalette | null;
	shiki: ShikiTheme;
};

export interface AppTheme {
	id: string;
	name: string;
	variants: Record<ResolvedColorScheme, ThemeVariant | null>;
}

export const APP_THEMES = [
	{
		id: "kilo",
		name: "Kilo",
		variants: {
			light: variant(
				{
					background: "#ffffff",
					foreground: "#0a0a0a",
					surface: "#ffffff",
					sidebar: "#fafafa",
					hover: "#f5f5f5",
					muted: "#737373",
					border: "#e5e5e5",
					primary: "#ffdd00",
					primaryForeground: "#1f1f1f",
					ring: "#737373",
					// Yellow is ~1.35:1 on white: keep it as a filled surface, use gray for small marks.
					roles: {
						"primary-ink": "var(--muted-foreground)",
						"primary-ink-foreground": "var(--background)",
						"primary-soft": "var(--primary)",
						"primary-soft-foreground": "var(--primary-foreground)",
					},
					ansi: [
						"#1f1f1f",
						"#dc2626",
						"#16a34a",
						"#d28100",
						"#2563eb",
						"#9333ea",
						"#009689",
						"#d4d4d8",
						"#71717a",
						"#ef4444",
						"#22c55e",
						"#f0a900",
						"#3b82f6",
						"#a855f7",
						"#00baa9",
						"#fafafa",
					],
				},
				"github-light",
				"light",
			),
			// Based on Kilo design v0.2.0, with neutral surfaces tuned for desktop.
			// neutral-300: near-white halates on these near-black surfaces.
			dark: variant(
				{
					background: "#111111",
					foreground: "#d4d4d4",
					surface: "#181818",
					draftComposer: "#1f1f1f",
					popover: "#2b2b2b",
					sidebar: "#161616",
					// Overlay, not a solid step: #333333 lifts the sidebar too hard,
					// and any solid dark enough for the sidebar reads as a hole on the
					// #2b2b2b popover. 5% matches main's stock foreground/5 hover.
					hover: "color-mix(in oklch, var(--foreground) 5%, transparent)",
					mutedFill: "#333333",
					muted: "#a3a3a3",
					// Translucent so dividers read on every surface: #292929 over the
					// background as before, #404040 over the #2b2b2b popover (a solid
					// #292929 vanished there).
					border: "rgb(255 255 255 / 0.1)",
					primary: "#ffdd00",
					primaryForeground: "#1f1f1f",
					ansi: [
						"#111111",
						"#f87171",
						"#4ade80",
						"#f7f586",
						"#60a5fa",
						"#c084fc",
						"#00d4c2",
						"#a3a3a3",
						"#7a7a7a",
						"#fca5a5",
						"#86efac",
						"#fdd94a",
						"#93c5fd",
						"#d8b4fe",
						"#4ce7d7",
						"#fafafa",
					],
				},
				"github-dark",
				"dark",
			),
		},
	},
	{
		id: "anaconda",
		name: "Anaconda",
		variants: {
			// Surfaces stay in `@anaconda/shadcn-theme` + globals.css; Ghostty needs hex.
			light: cssTheme(
				{
					background: "#ffffff",
					foreground: "#090b0c",
					hover: "#f1f3f3",
					ansi: [
						"#090b0c",
						"#e7000b",
						"#07ca4a",
						"#fe9a00",
						"#155dfc",
						"#9810fa",
						"#0092b8",
						"#f9fbfb",
					],
				},
				"pierre-light",
			),
			dark: cssTheme(
				{
					background: "#101314",
					foreground: "#f9fbfb",
					hover: "#22292b",
					ansi: [
						"#22292b",
						"#ff6467",
						"#96f778",
						"#a5f28d",
						"#50a2ff",
						"#c27aff",
						"#00d3f3",
						"#f9fbfb",
					],
				},
				"pierre-dark",
			),
		},
	},
	{
		id: "dracula",
		name: "Dracula",
		variants: {
			// Curated light companion, not an official Dracula light theme. Latte supplies light syntax.
			light: variant(
				{
					background: "#f8f7fc",
					foreground: "#282a36",
					surface: "#ffffff",
					sidebar: "#efedf6",
					hover: "#e5e1f0",
					muted: "#625b78",
					border: "#d4cde4",
					primary: "#7040b0",
					primaryForeground: "#ffffff",
					ansi: [
						"#282a36",
						"#b42336",
						"#28753c",
						"#886000",
						"#3459a5",
						"#8840a0",
						"#087b83",
						"#d4cde4",
						"#625b78",
						"#bc344b",
						"#347c46",
						"#946600",
						"#4566b0",
						"#9950ae",
						"#16818a",
						"#f8f7fc",
					],
				},
				"catppuccin-latte",
				"light",
			),
			dark: variant(
				{
					background: "#282a36",
					foreground: "#f8f8f2",
					surface: "#303341",
					sidebar: "#21222c",
					hover: "#44475a",
					muted: "#a6a9c6",
					border: "#555970",
					primary: "#bd93f9",
					primaryForeground: "#282a36",
					ansi: [
						"#21222c",
						"#ff5555",
						"#50fa7b",
						"#f1fa8c",
						"#bd93f9",
						"#ff79c6",
						"#8be9fd",
						"#f8f8f2",
						"#6272a4",
						"#ff6e6e",
						"#69ff94",
						"#ffffa5",
						"#d6acff",
						"#ff92df",
						"#a4ffff",
						"#ffffff",
					],
				},
				"dracula",
				"dark",
			),
		},
	},
	{
		id: "catppuccin",
		name: "Catppuccin",
		variants: {
			light: variant(
				{
					background: "#eff1f5",
					foreground: "#4c4f69",
					surface: "#ffffff",
					sidebar: "#e6e9ef",
					hover: "#ccd0da",
					muted: "#5c5f77",
					border: "#bcc0cc",
					primary: "#8839ef",
					primaryForeground: "#ffffff",
					ansi: [
						"#5c5f77",
						"#d20f39",
						"#40a02b",
						"#df8e1d",
						"#1e66f5",
						"#ea76cb",
						"#179299",
						"#acb0be",
						"#6c6f85",
						"#d20f39",
						"#40a02b",
						"#df8e1d",
						"#1e66f5",
						"#ea76cb",
						"#179299",
						"#bcc0cc",
					],
				},
				"catppuccin-latte",
				"light",
			),
			dark: variant(
				{
					background: "#1e1e2e",
					foreground: "#cdd6f4",
					surface: "#313244",
					sidebar: "#181825",
					hover: "#45475a",
					muted: "#a6adc8",
					border: "#585b70",
					primary: "#cba6f7",
					primaryForeground: "#1e1e2e",
					ansi: [
						"#45475a",
						"#f38ba8",
						"#a6e3a1",
						"#f9e2af",
						"#89b4fa",
						"#f5c2e7",
						"#94e2d5",
						"#bac2de",
						"#585b70",
						"#f38ba8",
						"#a6e3a1",
						"#f9e2af",
						"#89b4fa",
						"#f5c2e7",
						"#94e2d5",
						"#a6adc8",
					],
				},
				"catppuccin-mocha",
				"dark",
			),
		},
	},
	{
		id: "gruvbox",
		name: "Gruvbox",
		variants: {
			light: variant(
				{
					background: "#fbf1c7",
					foreground: "#3c3836",
					surface: "#f9f5d7",
					sidebar: "#f2e5bc",
					hover: "#ebdbb2",
					muted: "#665c54",
					border: "#d5c4a1",
					primary: "#9d0006",
					primaryForeground: "#fbf1c7",
					ansi: [
						"#fbf1c7",
						"#cc241d",
						"#98971a",
						"#d79921",
						"#458588",
						"#b16286",
						"#689d6a",
						"#7c6f64",
						"#928374",
						"#9d0006",
						"#79740e",
						"#b57614",
						"#076678",
						"#8f3f71",
						"#427b58",
						"#3c3836",
					],
				},
				"gruvbox-light-medium",
				"light",
			),
			dark: variant(
				{
					background: "#282828",
					foreground: "#ebdbb2",
					surface: "#32302f",
					sidebar: "#1d2021",
					hover: "#3c3836",
					muted: "#bdae93",
					border: "#504945",
					primary: "#fabd2f",
					primaryForeground: "#282828",
					ansi: [
						"#282828",
						"#cc241d",
						"#98971a",
						"#d79921",
						"#458588",
						"#b16286",
						"#689d6a",
						"#a89984",
						"#928374",
						"#fb4934",
						"#b8bb26",
						"#fabd2f",
						"#83a598",
						"#d3869b",
						"#8ec07c",
						"#ebdbb2",
					],
				},
				"gruvbox-dark-medium",
				"dark",
			),
		},
	},
	{
		id: "github",
		name: "GitHub",
		variants: {
			light: variant(
				{
					background: "#ffffff",
					foreground: "#24292f",
					surface: "#ffffff",
					sidebar: "#f6f8fa",
					hover: "#eaeef2",
					muted: "#57606a",
					border: "#d0d7de",
					primary: "#0969da",
					primaryForeground: "#ffffff",
					ansi: [
						"#24292f",
						"#cf222e",
						"#116329",
						"#4d2d00",
						"#0969da",
						"#8250df",
						"#1b7c83",
						"#6e7781",
						"#57606a",
						"#a40e26",
						"#1a7f37",
						"#633c01",
						"#218bff",
						"#a475f9",
						"#3192aa",
						"#8c959f",
					],
				},
				"github-light",
				"light",
			),
			dark: variant(
				{
					background: "#0d1117",
					foreground: "#e6edf3",
					surface: "#161b22",
					sidebar: "#010409",
					hover: "#21262d",
					muted: "#8b949e",
					border: "#30363d",
					primary: "#58a6ff",
					primaryForeground: "#0d1117",
					ansi: [
						"#484f58",
						"#ff7b72",
						"#3fb950",
						"#d29922",
						"#58a6ff",
						"#bc8cff",
						"#39c5cf",
						"#b1bac4",
						"#6e7681",
						"#ffa198",
						"#56d364",
						"#e3b341",
						"#79c0ff",
						"#d2a8ff",
						"#56d4dd",
						"#f0f6fc",
					],
				},
				"github-dark",
				"dark",
			),
		},
	},
	{
		id: "everforest",
		name: "Everforest",
		variants: {
			light: variant(
				{
					background: "#fdf6e3",
					foreground: "#5c6a72",
					surface: "#fffbef",
					sidebar: "#f4f0d9",
					hover: "#efebd4",
					muted: "#626f62",
					border: "#d3d7bf",
					primary: "#526d32",
					primaryForeground: "#ffffff",
					ansi: [
						"#5c6a72",
						"#f85552",
						"#8da101",
						"#dfa000",
						"#3a94c5",
						"#df69ba",
						"#35a77c",
						"#dfddc8",
						"#829181",
						"#e66868",
						"#93b259",
						"#d1b171",
						"#7fbbb3",
						"#d699b6",
						"#83c092",
						"#fdf6e3",
					],
				},
				"everforest-light",
				"light",
			),
			dark: variant(
				{
					background: "#2d353b",
					foreground: "#d3c6aa",
					surface: "#343f44",
					sidebar: "#232a2e",
					hover: "#3d484d",
					muted: "#a7b4aa",
					border: "#4f585e",
					primary: "#a7c080",
					primaryForeground: "#232a2e",
					ansi: [
						"#343f44",
						"#e67e80",
						"#a7c080",
						"#dbbc7f",
						"#7fbbb3",
						"#d699b6",
						"#83c092",
						"#d3c6aa",
						"#859289",
						"#e67e80",
						"#a7c080",
						"#dbbc7f",
						"#7fbbb3",
						"#d699b6",
						"#83c092",
						"#e4e1cd",
					],
				},
				"everforest-dark",
				"dark",
			),
		},
	},
	{
		id: "nord",
		name: "Nord",
		variants: {
			// Curated Snow Storm companion; Nord has no official light Shiki builtin.
			light: variant(
				{
					background: "#eceff4",
					foreground: "#2e3440",
					surface: "#f8fafc",
					sidebar: "#e5e9f0",
					hover: "#d8dee9",
					muted: "#4c566a",
					border: "#b8c2d2",
					primary: "#466a91",
					primaryForeground: "#ffffff",
					ansi: [
						"#2e3440",
						"#a43b4b",
						"#4f6f36",
						"#866320",
						"#466a91",
						"#86547e",
						"#347580",
						"#d8dee9",
						"#4c566a",
						"#ad4454",
						"#597a40",
						"#916e2c",
						"#50759c",
						"#905e88",
						"#3e7f8a",
						"#eceff4",
					],
				},
				"github-light",
				"light",
			),
			dark: variant(
				{
					background: "#2e3440",
					foreground: "#eceff4",
					surface: "#3b4252",
					sidebar: "#292e39",
					hover: "#434c5e",
					muted: "#a5b1c5",
					border: "#4c566a",
					primary: "#88c0d0",
					primaryForeground: "#2e3440",
					ansi: [
						"#3b4252",
						"#bf616a",
						"#a3be8c",
						"#ebcb8b",
						"#81a1c1",
						"#b48ead",
						"#88c0d0",
						"#e5e9f0",
						"#4c566a",
						"#bf616a",
						"#a3be8c",
						"#ebcb8b",
						"#81a1c1",
						"#b48ead",
						"#8fbcbb",
						"#eceff4",
					],
				},
				"nord",
				"dark",
			),
		},
	},
] as const satisfies readonly AppTheme[];

export const ACCENTS = [
	{
		id: "theme",
		name: "Theme",
		light: { color: "#07ca4a", foreground: "#161b1d" },
		dark: { color: "#96f778", foreground: "#161b1d" },
	},
	{
		id: "blue",
		name: "Blue",
		light: { color: "#1d4ed8", foreground: "#ffffff" },
		dark: { color: "#93c5fd", foreground: "#172554" },
	},
	{
		id: "purple",
		name: "Purple",
		light: { color: "#7e22ce", foreground: "#ffffff" },
		dark: { color: "#d8b4fe", foreground: "#3b0764" },
	},
	{
		id: "pink",
		name: "Pink",
		light: { color: "#be185d", foreground: "#ffffff" },
		dark: { color: "#f9a8d4", foreground: "#500724" },
	},
	{
		id: "red",
		name: "Red",
		light: { color: "#b91c1c", foreground: "#ffffff" },
		dark: { color: "#fca5a5", foreground: "#450a0a" },
	},
	{
		id: "orange",
		name: "Orange",
		light: { color: "#9a3412", foreground: "#ffffff" },
		dark: { color: "#fdba74", foreground: "#431407" },
	},
	{
		id: "green",
		name: "Green",
		light: { color: "#166534", foreground: "#ffffff" },
		dark: { color: "#86efac", foreground: "#052e16" },
	},
] as const;

export interface AppThemePreferences {
	themeId: string;
	accentId: string;
}

export const DEFAULT_APP_THEME_PREFERENCES: AppThemePreferences = {
	themeId: "kilo",
	accentId: "theme",
};

export function normalizeAppThemePreferences(value: unknown): AppThemePreferences {
	const input =
		value !== null && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	return {
		themeId:
			APP_THEMES.find(({ id }) => id === input.themeId)?.id ??
			DEFAULT_APP_THEME_PREFERENCES.themeId,
		accentId: ACCENTS.find(({ id }) => id === input.accentId)?.id ?? "theme",
	};
}

export function getThemeVariant(themeId: string, mode: ResolvedColorScheme): ThemeVariant | null {
	const theme =
		APP_THEMES.find(({ id }) => id === themeId) ??
		APP_THEMES.find(({ id }) => id === DEFAULT_APP_THEME_PREFERENCES.themeId)!;
	return theme.variants[mode];
}

export function themeCss(preferences: AppThemePreferences): string {
	const { themeId, accentId } = normalizeAppThemePreferences(preferences);
	const accent = ACCENTS.find(({ id }) => id === accentId && id !== "theme");
	return (["light", "dark"] as const)
		.map((mode) => {
			const tokens: Partial<ThemeVariant["tokens"]> = { ...getThemeVariant(themeId, mode)?.tokens };
			if (accent) {
				const { color, foreground } = accent[mode];
				Object.assign(tokens, {
					...ACCENT_ROLE_DEFAULTS,
					primary: color,
					"primary-foreground": foreground,
					ring: color,
					"sidebar-primary": color,
					"sidebar-primary-foreground": foreground,
					"sidebar-ring": color,
				});
			}
			const declarations = Object.entries(tokens)
				.map(([key, value]) => `--${key}:${value};`)
				.join("");
			if (!declarations) return "";
			return `${mode === "light" ? "html:root" : 'html:root[data-theme="dark"]'}{${declarations}}`;
		})
		.join("");
}

export function getThemeAppearance(
	preferences: AppThemePreferences,
	mode: ResolvedColorScheme,
): ThemeAppearance {
	const { themeId } = normalizeAppThemePreferences(preferences);
	const resolved = getThemeVariant(themeId, mode);
	return {
		mode,
		themeId,
		terminal: resolved?.terminal ?? null,
		shiki: resolved?.shiki ?? `pierre-${mode}`,
	};
}

export function getThemeChrome(themeId: string): {
	light: { background: string; foreground: string };
	dark: { background: string; foreground: string };
} {
	const light = getThemeVariant(themeId, "light")?.tokens ?? themeChromeColors.light;
	const dark = getThemeVariant(themeId, "dark")?.tokens ?? themeChromeColors.dark;
	return {
		light: { background: light.background, foreground: light.foreground },
		dark: { background: dark.background, foreground: dark.foreground },
	};
}
