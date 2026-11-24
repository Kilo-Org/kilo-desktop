import { KernelError, type PluginSdk } from "@kilo-desktop/kernel";
import { Workspaces } from "@kilo-desktop/plugin-work-sessions/contracts";

import { HtmlPages, htmlPageFileStem } from "../../contracts";

/** Creates a file only if none exists at the path; resolves false when one does. */
export type WriteNewFile = (path: string, content: string) => Promise<boolean>;

/** Name attempts before giving up: `Chart.html`, `Chart 2.html`, … */
const MAX_NAME_ATTEMPTS = 100;

const joinPath = (directory: string, name: string) =>
	`${directory.replace(/[\\/]+$/, "")}${directory.includes("\\") ? "\\" : "/"}${name}`;

/**
 * The `html-pages` domain object. The window names the folder, so it is
 * accepted only when kilo.work-sessions authorizes it as a workspace folder
 * (or a managed copy of one), and the file is created exclusively: an
 * existing file — or a symlink planted in its place — is never written
 * through; the name moves on instead.
 */
export function provideHtmlPages(sdk: PluginSdk, writeNewFile: WriteNewFile | undefined): void {
	sdk.domainObjects.provide(HtmlPages, {
		initialState: {},
		methods: {
			save: async ({ workspaceDirectory, title, html }) => {
				if (!writeNewFile) throw new KernelError("UNAVAILABLE", "Pages can't be saved here.");
				const authorization = await sdk.domainObjects
					.get(Workspaces)
					?.methods.authorize({ path: workspaceDirectory, rule: "folder" });
				if (!authorization?.allowed) {
					throw new KernelError("PERMISSION_DENIED", "That folder isn't a workspace folder.");
				}
				const root = authorization.path ?? workspaceDirectory;
				const stem = htmlPageFileStem(title);
				for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
					const name = attempt === 1 ? `${stem}.html` : `${stem} ${attempt}.html`;
					if (await writeNewFile(joinPath(root, name), html)) return { relativePath: name };
				}
				throw new KernelError("BUSINESS", `Too many files named "${stem}" already exist.`);
			},
		},
	});
}
