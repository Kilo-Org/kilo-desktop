import type { PluginSdk } from "@kilo-desktop/kernel";

import { Legal, type LegalDocument } from "../contracts";

/** File names packaging gives the documents beside app.asar (apps/desktop/config/third-party-notices.ts). */
export const LEGAL_DOCUMENT_FILES: Readonly<Record<LegalDocument, string>> = {
	"third-party-notices": "THIRD_PARTY_NOTICES.txt",
	"chromium-notices": "LICENSES.chromium.html",
};

/** Files beside app.asar; `null` for a file that is not shipped. */
export interface LegalResources {
	locate(file: string): string | null;
	read(file: string): Promise<string | null>;
}

/** `kilo.shell/legal` over the app's resources. */
export function provideLegal(sdk: PluginSdk, resources: LegalResources): void {
	sdk.domainObjects.provide(Legal, {
		initialState: {},
		methods: {
			locate: ({ document }) => resources.locate(LEGAL_DOCUMENT_FILES[document]),
			read: ({ document }) => resources.read(LEGAL_DOCUMENT_FILES[document]),
		},
	});
}
