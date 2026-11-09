import { LocalModelServerSettings } from "../web/settings/LocalModelServerSettings.js";
import {
	bootLocalInferenceHost,
	SIGNED_IN,
	type LocalInferenceHostOptions,
} from "./local-inference-host.js";

export { connection, expandModel, usageSnapshot } from "./local-inference-host.js";

type Handlers = NonNullable<LocalInferenceHostOptions["handlers"]>;

/** What origin's tests passed as `sdk.shell`: only the dropped-file path is still a seam. */
export interface ShellOptions {
	readonly getPathForFile?: (file: File) => string | null;
}

/** The route the page opens on (origin's static navigation). */
export function staticNavigation(location: { path: string; search: Record<string, string> }) {
	return location;
}

/** Signed in to Kilo (origin's authenticated auth session). */
export const authenticatedAuth = SIGNED_IN;

/** Renders the Local Model Server settings in a kernel host (origin's `renderSettings`). */
export async function renderSettings(
	handlers: Handlers,
	shell: ShellOptions = {},
	identity: LocalInferenceHostOptions["identity"] = SIGNED_IN,
	navigation?: { search: Record<string, string> },
	flags?: Record<string, unknown>,
) {
	const host = await bootLocalInferenceHost({
		handlers,
		identity,
		...(shell.getPathForFile ? { pathForFile: shell.getPathForFile } : {}),
		...(navigation ? { search: navigation.search } : {}),
		...(flags ? { flags } : {}),
	});
	const view = host.render(<LocalModelServerSettings />);
	return { ...view, host, tracked: host.tracked };
}
