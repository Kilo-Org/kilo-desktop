// Copies the WebMCP local-relay browser assets (embed.js + widget.html) from the
// installed `@mcp-b/webmcp-local-relay` package into `public/webmcp/` so they are
// served from the app's own origin. Self-hosting keeps everything same-origin under
// the app's hardened CSP instead of loading third-party code from a CDN.
//
// These assets execute at the app origin with renderer privileges, so each is pinned
// to a reviewed sha256. A mismatch (e.g. an unreviewed version bump) fails the build:
// re-review the asset, then update EXPECTED_SHA256 below. Pair this with an exact
// version pin for `@mcp-b/webmcp-local-relay` in package.json.
//
// The same package is _also_ bundled in `plugins/kilo-server` as the stdio MCP relay
// that `kilo serve` spawns for the interim WebMCP↔Kilo bridge (see
// #102 and `docs/webmcp.md` §7). The widget iframe (browser
// half) and the CLI relay (main-process half) MUST speak the same WebMCP wire
// protocol; the version pin is duplicated across the two workspace packages and this
// script asserts they resolve to the same version at build time.
//
// Runs automatically via the `predev` / `prebuild` npm hooks. Assets are generated,
// not committed (see .gitignore), so they always match the installed package version.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(scriptDir, "..", "public", "webmcp");
const workspaceRoot = path.resolve(scriptDir, "..", "..", "..");

// Single source of truth for the WebMCP wire protocol version. Bumping this
// value must be done in ALL of these places at once, or the build fails:
//   - EXPECTED_VERSION (this file)
//   - apps/web/package.json   (browser embed/widget assets consumer)
//   - plugins/kilo-server/package.json  (CLI relay consumer for the Kilo bridge)
//   - EXPECTED_SHA256 (re-hash the new dist/browser assets)
const EXPECTED_VERSION = "4.0.0";
const CONSUMER_PACKAGES = [
	{ label: "apps/web", relativePath: "apps/web/package.json" },
	{ label: "plugins/kilo-server", relativePath: "plugins/kilo-server/package.json" },
];

// The package only exports its main entry, so resolve that and walk up to the root.
const packageEntry = require.resolve("@mcp-b/webmcp-local-relay");
const packageRoot = path.resolve(path.dirname(packageEntry), "..");
const browserDir = path.join(packageRoot, "dist", "browser");
const installedManifest = JSON.parse(
	await readFile(path.join(packageRoot, "package.json"), "utf8"),
);

if (installedManifest.version !== EXPECTED_VERSION) {
	throw new Error(
		`[webmcp] Installed @mcp-b/webmcp-local-relay is ${installedManifest.version}, ` +
			`expected ${EXPECTED_VERSION}. Update EXPECTED_VERSION (and EXPECTED_SHA256) in ` +
			`${path.relative(process.cwd(), fileURLToPath(import.meta.url))} or fix the pin.`,
	);
}

for (const consumer of CONSUMER_PACKAGES) {
	const manifestPath = path.join(workspaceRoot, consumer.relativePath);
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	const pinned =
		manifest.dependencies?.["@mcp-b/webmcp-local-relay"] ??
		manifest.devDependencies?.["@mcp-b/webmcp-local-relay"];
	if (pinned !== EXPECTED_VERSION) {
		throw new Error(
			`[webmcp] ${consumer.label} pins @mcp-b/webmcp-local-relay@${pinned ?? "<missing>"}, ` +
				`expected ${EXPECTED_VERSION}. The widget iframe and the CLI relay MUST speak the ` +
				`same wire protocol.`,
		);
	}
}

// Only the two assets the relay embed flow needs: `embed.js` bootstraps the widget
// iframe, and `widget.html` (with its bundled inline runtime) hosts the relay bridge.
// Values are sha256 (hex) of `@mcp-b/webmcp-local-relay@4.0.0` dist/browser assets.
const EXPECTED_SHA256 = {
	"embed.js": "590cc17c52a01873efb4ba1496e3ca8de61c615c7f94521ad5fc020596c9ae76",
	"widget.html": "ff461e6a45051376504b28b161ebe3994d72004c8dbbe2918f63aa2cae523815",
};

await rm(publicDir, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });

for (const [asset, expected] of Object.entries(EXPECTED_SHA256)) {
	const source = path.join(browserDir, asset);
	const actual = createHash("sha256")
		.update(await readFile(source))
		.digest("hex");
	if (actual !== expected) {
		throw new Error(
			`[webmcp] Checksum mismatch for ${asset}.\n` +
				`  expected ${expected}\n  actual   ${actual}\n` +
				`The installed @mcp-b/webmcp-local-relay asset changed. Review the new asset, ` +
				`then update EXPECTED_SHA256 in ${path.relative(process.cwd(), fileURLToPath(import.meta.url))}.`,
		);
	}
	if (asset === "widget.html") {
		// PATCH: raise the widget's per-endpoint discovery timeout (1200ms in
		// upstream 4.0.0) to 10s. The timeout only bounds a REAL handshake in
		// flight — dead ports fail fast via `error` events regardless — but in
		// dev mode the renderer's main thread can stall for >1.2s (Vite/React
		// long tasks), starving the hidden iframe's message delivery. Measured
		// on a dev machine: node→relay handshake 1-6ms, widget-frame→relay
		// 2308ms — every probe of the LIVE relay was aborted mid-handshake and
		// the widget never connected, on any machine with >1.2s renderer
		// stalls. The CSP hashes the widget's inline script per served
		// document (see ElectronProtocol getInlineScriptHashes), so the patch
		// does not break script-src.
		const original = await readFile(source, "utf8");
		const marker = "l=setTimeout(()=>{a(null)},1200)";
		if (!original.includes(marker)) {
			throw new Error(
				`[webmcp] widget.html discovery-timeout marker not found; upstream changed. ` +
					`Re-verify the patch in ${path.relative(process.cwd(), fileURLToPath(import.meta.url))}.`,
			);
		}
		const patched = original.replace(marker, "l=setTimeout(()=>{a(null)},10000)");
		await writeFile(path.join(publicDir, asset), patched);
		continue;
	}
	await copyFile(source, path.join(publicDir, asset));
}

const count = Object.keys(EXPECTED_SHA256).length;
console.log(
	`[webmcp] Synced ${count} verified relay asset(s) -> ${path.relative(process.cwd(), publicDir)}`,
);
