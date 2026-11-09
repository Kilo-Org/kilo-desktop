import { definePlugin, type PluginEntry, type PluginSdk } from "@kilo-desktop/kernel";

import { Legal, type LegalDocument } from "../contracts/index.js";

/** File names packaging gives the documents beside app.asar (apps/desktop/config/third-party-notices.ts). */
export const LEGAL_DOCUMENT_FILES: Readonly<Record<LegalDocument, string>> = {
	license: "LICENSE.md",
	"third-party-notices": "THIRD_PARTY_NOTICES.txt",
	"chromium-notices": "LICENSES.chromium.html",
};

/** Files beside app.asar; `null` for a file that is not shipped. */
export interface LegalResources {
	locate(file: string): string | null;
	read(file: string): Promise<string | null>;
}

export interface UpdatesMainOptions {
	readonly resources: (sdk: PluginSdk) => LegalResources;
}

/** kilo.updates in main: the `kilo.updates/legal` domain object over the app's resources. */
export function createUpdatesMainEntry(options: UpdatesMainOptions): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const resources = options.resources(sdk);
			sdk.domains.provide(Legal, {
				initialState: {},
				methods: {
					locate: ({ document }) => resources.locate(LEGAL_DOCUMENT_FILES[document]),
					read: ({ document }) => resources.read(LEGAL_DOCUMENT_FILES[document]),
				},
			});
		},
	});
}
