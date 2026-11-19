import {
	customTerminalProfileSchema,
	type CustomTerminalProfile,
	type TerminalProfileEnv,
	type TerminalProfileSource,
} from "../contracts/profiles";

/** A custom profile as its form edits it: args one per line, env one `NAME=value` per line. */
export interface ProfileDraft {
	readonly id: string;
	readonly label: string;
	readonly kind: "executable" | "source";
	readonly path: string;
	readonly source: TerminalProfileSource;
	readonly args: string;
	readonly env: string;
}

export type ProfileDraftField = "label" | "path" | "source" | "args" | "env";
type DraftErrors = Partial<Record<ProfileDraftField, string>>;

export type ParsedProfileDraft =
	| { readonly ok: true; readonly profile: CustomTerminalProfile }
	| { readonly ok: false; readonly errors: DraftErrors };

const DRAFT_FIELDS: readonly string[] = ["label", "path", "source", "args", "env"];

export function emptyProfileDraft(id: string): ProfileDraft {
	return { id, label: "", kind: "executable", path: "", source: "pwsh", args: "", env: "" };
}

export function draftFromProfile(profile: CustomTerminalProfile): ProfileDraft {
	return {
		id: profile.id,
		label: profile.label,
		kind: profile.source ? "source" : "executable",
		path: profile.path ?? "",
		source: profile.source ?? "pwsh",
		args: (profile.args ?? []).join("\n"),
		env: Object.entries(profile.env ?? {})
			.map(([name, value]) => `${name}=${value ?? ""}`)
			.join("\n"),
	};
}

function lines(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function parseEnv(text: string): { env: TerminalProfileEnv } | { error: string } {
	const env: TerminalProfileEnv = {};
	const all = text.split(/\r?\n/);
	for (const [index, raw] of all.entries()) {
		const line = raw.trim();
		if (!line) continue;
		const separator = line.indexOf("=");
		if (separator <= 0) return { error: `Line ${index + 1} needs the form NAME=value: "${line}"` };
		const value = line.slice(separator + 1);
		env[line.slice(0, separator).trim()] = value === "" ? null : value;
	}
	return { env };
}

/** The custom profile a draft describes, or why it can't be saved, by field. */
export function parseProfileDraft(draft: ProfileDraft): ParsedProfileDraft {
	if (draft.kind === "executable" && !draft.path.trim()) {
		return { ok: false, errors: { path: "Enter the shell's path or name." } };
	}
	const env = parseEnv(draft.env);
	if ("error" in env) return { ok: false, errors: { env: env.error } };
	const args = lines(draft.args);
	const parsed = customTerminalProfileSchema.safeParse({
		id: draft.id,
		label: draft.label,
		...(draft.kind === "executable" ? { path: draft.path } : { source: draft.source }),
		...(args.length > 0 ? { args } : {}),
		...(Object.keys(env.env).length > 0 ? { env: env.env } : {}),
	});
	if (parsed.success) return { ok: true, profile: parsed.data };
	const errors: DraftErrors = {};
	for (const issue of parsed.error.issues) {
		const field = String(issue.path[0] ?? "label");
		const key = (DRAFT_FIELDS.includes(field) ? field : "label") as ProfileDraftField;
		errors[key] ??= issue.message;
	}
	return { ok: false, errors };
}
