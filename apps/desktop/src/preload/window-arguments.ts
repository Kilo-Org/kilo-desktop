import type { RendererWindow } from "@kilo-desktop/kernel";

/** Command-line switches main passes to each window's preload (`additionalArguments`). */
export const WINDOW_ARGUMENTS = {
	id: "--kilo-window-id",
	role: "--kilo-window-role",
	view: "--kilo-window-view",
	params: "--kilo-window-params",
} as const;

export function windowArguments(window: RendererWindow): string[] {
	return [
		`${WINDOW_ARGUMENTS.id}=${window.id}`,
		`${WINDOW_ARGUMENTS.role}=${window.role}`,
		...(window.view ? [`${WINDOW_ARGUMENTS.view}=${window.view}`] : []),
		`${WINDOW_ARGUMENTS.params}=${encodeURIComponent(JSON.stringify(window.params))}`,
	];
}

export function readWindowArguments(argv: readonly string[]): RendererWindow {
	const read = (name: string) =>
		argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
	const view = read(WINDOW_ARGUMENTS.view);
	return {
		id: read(WINDOW_ARGUMENTS.id) ?? "main",
		role: read(WINDOW_ARGUMENTS.role) === "secondary" ? "secondary" : "main",
		...(view ? { view } : {}),
		params: parseParams(read(WINDOW_ARGUMENTS.params)),
	};
}

function parseParams(raw: string | undefined): Record<string, string> {
	if (!raw) return {};
	try {
		const parsed: unknown = JSON.parse(decodeURIComponent(raw));
		if (typeof parsed !== "object" || parsed === null) return {};
		return Object.fromEntries(
			Object.entries(parsed).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		);
	} catch {
		return {};
	}
}
