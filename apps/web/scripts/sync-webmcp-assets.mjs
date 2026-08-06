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
// Runs automatically via the `predev` / `prebuild` npm hooks. Assets are generated,
// not committed (see .gitignore), so they always match the installed package version.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(scriptDir, "..", "public", "webmcp");

// The package only exports its main entry, so resolve that and walk up to the root.
const packageEntry = require.resolve("@mcp-b/webmcp-local-relay");
const packageRoot = path.resolve(path.dirname(packageEntry), "..");
const browserDir = path.join(packageRoot, "dist", "browser");

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
	await copyFile(source, path.join(publicDir, asset));
}

const count = Object.keys(EXPECTED_SHA256).length;
console.log(
	`[webmcp] Synced ${count} verified relay asset(s) -> ${path.relative(process.cwd(), publicDir)}`,
);
