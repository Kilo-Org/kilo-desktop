import type { ObjectRef, PluginSdk } from "@kilo-desktop/kernel";

import { Opener } from "./panes";

/** `*` matches within a path segment, `**` across segments, `?` one character; matched against the id's end. */
export function globToRegExp(glob: string): RegExp {
	let source = "";
	for (let index = 0; index < glob.length; index++) {
		const char = glob[index]!;
		if (char === "*" && glob[index + 1] === "*") {
			source += ".*";
			index++;
		} else if (char === "*") source += "[^/]*";
		else if (char === "?") source += "[^/]";
		else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`(^|/)${source}$`, "i");
}

/**
 * The pane kind that opens `ref`: the first `opener` whose type and glob
 * match it. Contributions are listed highest `priority` first (ties keep
 * plugin order), so a specific opener (`*.ipynb`) outranks a general one that
 * takes a low priority.
 */
export function openerFor(sdk: PluginSdk, ref: ObjectRef): string | undefined {
	return sdk.extensions
		.list(Opener)
		.find(
			({ metadata }) =>
				metadata.match.type === ref.type &&
				(!metadata.match.pattern || globToRegExp(metadata.match.pattern).test(ref.id)),
		)?.metadata.pane;
}
