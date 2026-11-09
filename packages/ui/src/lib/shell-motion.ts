/**
 * Shared layout spring for shell chrome that opens and closes by changing width
 * (left nav, chat right panel). Same physics = same perceived speed.
 */
export const SHELL_LAYOUT_SPRING = {
	type: "spring" as const,
	stiffness: 900,
	damping: 44,
	mass: 0.55,
};

export const SHELL_LAYOUT_SNAP = { duration: 0 } as const;
