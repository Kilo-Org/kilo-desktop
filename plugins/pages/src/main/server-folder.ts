import { constants } from "node:fs";
import { chmod, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** What the Pages worker is told at start (its `.dev.vars`). */
export interface PagesServerVars {
	readonly port: number;
	/** The identity bridge (`PAGES_KILO_APP_URL`). */
	readonly kiloAppUrl: string;
	readonly audience: string;
	readonly exchangeSecret: string;
	/** Signs Pages' session cookies; kept across runs so sign-ins survive a restart. */
	readonly sessionSecret: string;
}

export interface PrepareServerFolderOptions {
	/** Pages' build (`apps/pages/dist`): the worker, its wasm, `public/`, wrangler.json, the receipt. */
	readonly buildDir: string;
	/** celld's project folder; its `.celld/` holds the server's data and is never touched. */
	readonly serverDir: string;
	readonly vars: PagesServerVars;
}

const RECEIPT = "build-receipt.json";
const WRANGLER = "wrangler.json";
const DEV_VARS = ".dev.vars";
const DATA_DIR = ".celld";

/** The browser reaches Pages at `localhost`, the origin its sign-in cookies are set for. */
export const pagesPublicOrigin = (port: number) => `http://localhost:${port}`;

export function devVarsText(vars: PagesServerVars): string {
	const origin = pagesPublicOrigin(vars.port);
	const entries: Record<string, string> = {
		NOTEBOOK_CLOUD_APP_SESSION_SECRET: vars.sessionSecret,
		// Also what lets Pages accept a loopback http `PAGES_KILO_APP_URL`.
		NOTEBOOK_CLOUD_LOCAL_OIDC: "true",
		PAGES_CATALOG_INDEX: "1",
		NOTEBOOK_CLOUD_OIDC_FLOW: "server",
		NOTEBOOK_CLOUD_PUBLIC_ORIGIN: origin,
		NOTEBOOK_CLOUD_OIDC_ISSUER: `${origin}/dev/oidc`,
		NOTEBOOK_CLOUD_OIDC_CLIENT_ID: "pages-next-local",
		NOTEBOOK_CLOUD_OIDC_AUDIENCE: "pages-next-local",
		NOTEBOOK_CLOUD_OIDC_PRINCIPAL_NAMESPACE: "pages-next-local",
		PAGES_KILO_APP_URL: vars.kiloAppUrl,
		PAGES_KILO_AUDIENCE: vars.audience,
		PAGES_KILO_EXCHANGE_SECRET: vars.exchangeSecret,
	};
	return `${Object.entries(entries)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n")}\n`;
}

async function readReceipt(dir: string): Promise<string | undefined> {
	try {
		return await readFile(path.join(dir, RECEIPT), "utf8");
	} catch {
		return undefined;
	}
}

/**
 * Replaces everything but the data folder with the build. The receipt is
 * written last, so an interrupted copy is redone next time. Files are cloned
 * where the filesystem can (APFS) and symlinks are followed: celld refuses
 * anything that isn't a regular file inside its project.
 */
async function copyBuild(buildDir: string, serverDir: string, receipt: string): Promise<void> {
	await mkdir(serverDir, { recursive: true });
	const stale = (await readdir(serverDir)).filter((name) => name !== DATA_DIR);
	await Promise.all(
		stale.map((name) => rm(path.join(serverDir, name), { recursive: true, force: true })),
	);
	const copied = (await readdir(buildDir)).filter((name) => name !== RECEIPT && name !== WRANGLER);
	await Promise.all(
		copied.map((name) =>
			cp(path.join(buildDir, name), path.join(serverDir, name), {
				recursive: true,
				dereference: true,
				mode: constants.COPYFILE_FICLONE,
			}),
		),
	);
	await writeFile(path.join(serverDir, RECEIPT), receipt);
}

/**
 * Readies celld's project folder for a run: the build, copied in again only
 * when its `build-receipt.json` changed; `wrangler.json` without cron
 * triggers (nothing runs them locally); and this run's `.dev.vars`.
 */
export async function prepareServerFolder(
	options: PrepareServerFolderOptions,
): Promise<{ copied: boolean }> {
	const { buildDir, serverDir, vars } = options;
	const receipt = await readReceipt(buildDir);
	if (receipt === undefined) {
		throw new Error(`The Pages build at ${buildDir} has no ${RECEIPT}.`);
	}
	const copied = receipt !== (await readReceipt(serverDir));
	if (copied) await copyBuild(buildDir, serverDir, receipt);

	const wrangler = JSON.parse(await readFile(path.join(buildDir, WRANGLER), "utf8")) as Record<
		string,
		unknown
	>;
	delete wrangler["triggers"];
	await writeFile(path.join(serverDir, WRANGLER), `${JSON.stringify(wrangler, null, "\t")}\n`);

	const devVars = path.join(serverDir, DEV_VARS);
	await writeFile(devVars, devVarsText(vars), { mode: 0o600 });
	await chmod(devVars, 0o600);
	return { copied };
}
