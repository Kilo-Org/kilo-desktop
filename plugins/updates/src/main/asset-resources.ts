import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { PluginAssets } from "@kilo-desktop/kernel";

import type { LegalResources } from "./entry.js";

/**
 * The legal documents through the host's asset resolver: `resources/<file>`
 * is the packaged app's resources folder. In development kilo.updates has no
 * asset folder (the resolver throws) and packaging never ran, so every
 * document is absent.
 */
export function assetResources(assets: PluginAssets | undefined): LegalResources {
	const locate = (file: string): string | null => {
		let resolved: string;
		try {
			resolved = assets?.resolve(`resources/${file}`) ?? "";
		} catch {
			return null;
		}
		return resolved && existsSync(resolved) ? resolved : null;
	};
	return {
		locate,
		read: async (file) => {
			const resolved = locate(file);
			return resolved === null ? null : readFile(resolved, "utf8");
		},
	};
}
