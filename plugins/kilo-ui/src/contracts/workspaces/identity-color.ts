import { z } from "zod";

/** Identity color presets offered when creating a workspace. Any `#RRGGBB` may also be stored. */
export const WORKSPACE_IDENTITY_COLORS = [
	"#5EA0F7",
	"#34D399",
	"#F87171",
	"#A78BFA",
	"#22D3EE",
	"#FBBF24",
] as const;

export type WorkspaceIdentityColor = (typeof WORKSPACE_IDENTITY_COLORS)[number];

export const DEFAULT_WORKSPACE_IDENTITY_COLOR: WorkspaceIdentityColor =
	WORKSPACE_IDENTITY_COLORS[0];

/** Normalize to `#RRGGBB` when possible; otherwise null. */
export function normalizeWorkspaceIdentityColor(value: string | null | undefined): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	const short = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
	if (short) {
		const digits = short[1]!;
		return `#${digits
			.split("")
			.map((digit) => `${digit}${digit}`)
			.join("")}`.toUpperCase();
	}
	const long = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
	if (long) return `#${long[1]!}`.toUpperCase();
	return null;
}

export const workspaceIdentityColorSchema = z.string().transform((value, ctx) => {
	const hex = normalizeWorkspaceIdentityColor(value);
	if (!hex) {
		ctx.addIssue({ code: "custom", message: "Invalid identity color." });
		return z.NEVER;
	}
	return hex;
});
