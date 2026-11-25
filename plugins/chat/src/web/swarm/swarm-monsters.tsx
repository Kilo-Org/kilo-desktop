import type { FC, ReactNode } from "react";

/**
 * The subagents' monster avatars, from the design's "Sub Agent Monsters"
 * sheet: on a 24px grid, a 2px round stroke in `currentColor`, so the avatar
 * circle sets the tint. Each comes with its colour, from the tool icons'
 * palette, and the circle it sits in while it works; a worker's monster and
 * colour go together, in this order.
 */
export interface Monster {
	readonly name: string;
	readonly color: string;
	/**
	 * Its circle while it works, in the tool icons' style (light and dark):
	 * a soft fill, the monster in its colour, and a ring at 40%.
	 */
	readonly circleClassName: string;
	readonly Icon: FC<{ readonly className?: string }>;
}

function icon(name: string, children: ReactNode): FC<{ readonly className?: string }> {
	const Icon: FC<{ readonly className?: string }> = ({ className }) => (
		<svg
			viewBox="0 0 24 24"
			aria-hidden
			className={className}
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			{children}
		</svg>
	);
	Icon.displayName = `${name}Monster`;
	return Icon;
}

const DOT = { fill: "currentColor", stroke: "none" } as const;

export const MONSTERS: readonly Monster[] = [
	{
		name: "Dapper",
		circleClassName:
			"border-sky-600/40 bg-sky-100 text-sky-600 dark:border-sky-400/40 dark:bg-sky-950 dark:text-sky-400",
		color: "#38BDF8",
		Icon: icon(
			"Dapper",
			<>
				<rect x="3" y="5" width="18" height="11" rx="5.5" />
				<path d="M7 5 5.5 1.5M17 5l1.5-3.5" />
				<rect x="7" y="9" width="3.5" height="3" rx="1" />
				<rect x="13.5" y="9" width="3.5" height="3" rx="1" />
				<path d="M10.5 10.5h3" />
				<path d="M9 19v3l3-1.5zM15 19v3l-3-1.5z" />
			</>,
		),
	},
	{
		name: "Grizz",
		circleClassName:
			"border-orange-600/40 bg-orange-100 text-orange-600 dark:border-orange-400/40 dark:bg-orange-950 dark:text-orange-400",
		color: "#FB923C",
		Icon: icon(
			"Grizz",
			<>
				<path d="M4.7 7.4a2.5 2.5 0 1 1 3.4-3.1M19.3 7.4a2.5 2.5 0 1 0-3.4-3.1" />
				<path d="M4 13v-2a8 7 0 0 1 16 0v2l-2 5-2-2-2 4-2-2-2 2-2-4-2 2z" />
				<path
					d="M7 10.5h3.5v1a1.75 1.75 0 0 1-3.5 0zM13.5 10.5H17v1a1.75 1.75 0 0 1-3.5 0z"
					{...DOT}
				/>
				<path d="M10.5 10.5h3" />
			</>,
		),
	},
	{
		name: "Sunny",
		circleClassName:
			"border-amber-600/40 bg-amber-100 text-amber-600 dark:border-amber-400/40 dark:bg-amber-950 dark:text-amber-400",
		color: "#FBBF24",
		Icon: icon(
			"Sunny",
			<>
				<path d="M6 11a6 5.5 0 0 1 12 0" />
				<path d="M3 11h16.5c1.5 0 2.75.5 3.25 1.25" />
				<path d="M12 5.5V4.25" />
				<circle cx="12" cy="2.5" r="1" {...DOT} />
				<path d="M4.5 11v3a7.5 7.5 0 0 0 15 0v-3" />
				<path d="M7.25 13.25h4v.5a2 2 0 0 1-4 0zM12.75 13.25h4v.5a2 2 0 0 1-4 0z" {...DOT} />
				<path d="M10.75 13.6h2.5" strokeWidth={1.25} />
				<path d="M9.5 17.75c1.6 1.1 3.4 1.1 5 0" />
			</>,
		),
	},
	{
		name: "Specs",
		circleClassName:
			"border-violet-600/40 bg-violet-100 text-violet-600 dark:border-violet-400/40 dark:bg-violet-950 dark:text-violet-400",
		color: "#A78BFA",
		Icon: icon(
			"Specs",
			<>
				<path d="M4 21v-9a8 8 0 0 1 16 0v9" />
				<path d="M9 3.6 8 1.5M15 3.6l1-2.1" />
				<circle cx="9.25" cy="12" r="1.75" />
				<circle cx="14.75" cy="12" r="1.75" />
				<path d="M11 12h2M10.5 16.5c1 .6 2 .6 3 0" />
			</>,
		),
	},
	{
		name: "Mop",
		circleClassName:
			"border-emerald-600/40 bg-emerald-100 text-emerald-600 dark:border-emerald-400/40 dark:bg-emerald-950 dark:text-emerald-400",
		color: "#34D399",
		Icon: icon(
			"Mop",
			<>
				<path d="M4.5 12a7.5 7.5 0 0 1 15 0v1.5a7.5 7.5 0 0 1-15 0z" />
				<path d="M7.5 6 6 2.5M16.5 6 18 2.5" />
				<path d="M5.1 10.5L9.262 8.75l1.892 2 2.837-2.5 5.109 2.25" />
				<circle cx="11.1" cy="13.75" r="1.1" {...DOT} />
				<circle cx="14.1" cy="13.1" r="1.1" {...DOT} />
				<path d="M10.5 16.75c1.75 0.9 3.25 0.6 4.5-0.75" />
			</>,
		),
	},
	{
		name: "Hoodie",
		circleClassName:
			"border-zinc-600/40 bg-zinc-100 text-zinc-600 dark:border-zinc-400/40 dark:bg-zinc-950 dark:text-zinc-400",
		color: "#A1A1AA",
		Icon: icon(
			"Hoodie",
			<>
				<path d="M4 21v-8.5a8 8 0 0 1 2-5.3L5 2.5l4.25 3a8 8 0 0 1 5.5 0L19 2.5l-1 4.7a8 8 0 0 1 2 5.3V21" />
				<path d="M7 21v-6.5a5 5 0 0 1 10 0V21" />
				<circle cx="10.5" cy="14" r="1" {...DOT} />
				<circle cx="13.5" cy="14" r="1" {...DOT} />
				<path d="M11 17.5h2" />
			</>,
		),
	},
	{
		name: "Wavy",
		circleClassName:
			"border-fuchsia-600/40 bg-fuchsia-100 text-fuchsia-600 dark:border-fuchsia-400/40 dark:bg-fuchsia-950 dark:text-fuchsia-400",
		color: "#E879F9",
		Icon: icon(
			"Wavy",
			<>
				<path d="M7.5 11a4.5 4.5 0 0 1 9 0v3.5a4.5 4.5 0 0 1-9 0z" />
				<path d="M12 3.5C7.5 3.5 4.5 6.5 4.5 11c0 3-1.5 4-1.5 6.5S4.5 21 3.5 22M12 3.5c4.5 0 7.5 3 7.5 7.5 0 3 1.5 4 1.5 6.5S19.5 21 20.5 22" />
				<path d="M9.5 4 8.5 1.5M14.5 4l1-2.5" />
				<circle cx="10.5" cy="11" r="1" {...DOT} />
				<circle cx="13.75" cy="11" r="1" {...DOT} />
				<path d="M10.25 14.75c1.1.8 2.4.8 3.5 0" />
			</>,
		),
	},
	{
		name: "Beanie",
		circleClassName:
			"border-indigo-600/40 bg-indigo-100 text-indigo-600 dark:border-indigo-400/40 dark:bg-indigo-950 dark:text-indigo-400",
		color: "#818CF8",
		Icon: icon(
			"Beanie",
			<>
				<path d="M5 9a7 6.5 0 0 1 14 0" />
				<path d="M4 9h16v3H4z" />
				<path d="M5.5 12v3a6.5 6.5 0 0 0 13 0v-3" />
				<circle cx="9.25" cy="15" r="1.1" {...DOT} />
				<circle cx="14.75" cy="15" r="1.1" {...DOT} />
				<path d="M10 18h4" />
				<path d="M10.6 18.4h1.2l-.6 1.2zM12.2 18.4h1.2l-.6 1.2z" {...DOT} />
			</>,
		),
	},
	{
		name: "Chomp",
		circleClassName:
			"border-rose-600/40 bg-rose-100 text-rose-600 dark:border-rose-400/40 dark:bg-rose-950 dark:text-rose-400",
		color: "#FB7185",
		Icon: icon(
			"Chomp",
			<>
				<path d="M4.65 11 2 8.5l3.5.25M19.35 11 22 8.5l-3.5.25" />
				<circle cx="12" cy="12.5" r="7.5" />
				<path d="M11 5.5L12 3.5l1 2" />
				<circle cx="10.25" cy="10.25" r="1.25" {...DOT} />
				<circle cx="13.75" cy="10.25" r="1.25" {...DOT} />
				<path d="M8.5 13.5h7a3.5 3.5 0 0 1-7 0z" />
			</>,
		),
	},
	{
		name: "Curly",
		circleClassName:
			"border-cyan-600/40 bg-cyan-100 text-cyan-600 dark:border-cyan-400/40 dark:bg-cyan-950 dark:text-cyan-400",
		color: "#22D3EE",
		Icon: icon(
			"Curly",
			<>
				<path d="M3.95 11.713c0-5.5 3.5-8 8-8s8 2.5 8 8" />
				<path d="M3.95 11.713v2.5a8 8 0 0 0 16 0V11.713" />
				<path
					transform="translate(16.39 33.11) rotate(-105.3)"
					d="M26.014 -5.894C28.514 -6.494 32.418 -7.512 32.7 -3.806C32.523 -1.263 30.343 0.369 30.043 1.169"
				/>
				<path
					transform="translate(21.84 14.93) rotate(-126.8)"
					d="M5.512 1.875C6.467 6.024 16.468 7.262 16.157 -2.338"
				/>
				<circle cx="8.5" cy="13" r="2" />
				<circle cx="15" cy="13" r="2" />
				<path d="M10.5 13h2.5M9.75 17.5c1.3 0.8 2.7 0.8 4 0" />
			</>,
		),
	},
	{
		name: "Captain",
		circleClassName:
			"border-red-600/40 bg-red-100 text-red-600 dark:border-red-400/40 dark:bg-red-950 dark:text-red-400",
		color: "#F87171",
		Icon: icon(
			"Captain",
			<>
				<path d="M2 7c3 2 6 2.5 10 3.5 4-1 7-1.5 10-3.5-2-3.5-7-4-10-2.5C9 3 4 3.5 2 7z" />
				<path d="M6 10v4a6 6 0 0 0 12 0v-4" />
				<circle cx="10" cy="13" r="1.5" {...DOT} />
				<circle cx="14.1" cy="13.1" r="1.1" {...DOT} />
				<path d="M9.5 16.317c1-0.6 1.75-0.25 2.5 0.25 0.75-0.5 1.5-0.85 2.5-0.25M12 18.817v2" />
				<circle cx="12" cy="22.5" r="1" {...DOT} />
			</>,
		),
	},
];

const BY_COLOR = new Map(MONSTERS.map((monster) => [monster.color.toLowerCase(), monster]));

/** The monster that goes with a worker's colour; none for the main agent's. */
export const monsterOf = (color: string): Monster | undefined => BY_COLOR.get(color.toLowerCase());
