/**
 * Bootstrap injected into every agent-authored `html_render` page before the
 * chat hands it to the isolated frame. It makes the page read as part of the
 * reply rather than an embedded document:
 *
 * - The app theme arrives as CSS custom properties on `:root` (plus a matching
 *   `color-scheme`, which keeps the frame transparent over the chat), and is
 *   re-applied live from `host-context-changed` messages.
 * - The page reports its content height so the frame fits it exactly.
 * - Link clicks never navigate the frame: http(s) links are handed to the
 *   chat, which offers to open them in the default browser; anything else is
 *   dropped.
 *
 * The theme `<style>` precedes the page's own styles, so a page's `:root` or
 * `html` rules still win.
 */

/**
 * Public CDNs agent-authored pages may load libraries, styles and fonts from:
 * the only origins such a page can reach.
 */
const HTML_RENDER_CDN_SOURCES = [
	"https://cdn.jsdelivr.net",
	"https://unpkg.com",
	"https://cdnjs.cloudflare.com",
	"https://cdn.plot.ly",
	"https://cdn.bokeh.org",
	"https://cdn.holoviz.org",
].join(" ");

/**
 * The CSP a saved page carries as a `<meta>`, so it is held to the rules the
 * in-chat frame gets from the host's html-render profile (no network or
 * loopback, inline-only images) wherever it is opened. Only directives a
 * `<meta>` policy honours.
 */
export function htmlRenderContentSecurityPolicy(): string {
	return [
		"default-src 'none'",
		`script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: ${HTML_RENDER_CDN_SOURCES}`,
		`style-src 'unsafe-inline' ${HTML_RENDER_CDN_SOURCES}`,
		"img-src data: blob:",
		`font-src data: ${HTML_RENDER_CDN_SOURCES}`,
		"media-src data: blob:",
		"connect-src 'none'",
		"worker-src blob:",
		"frame-src 'none'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
	].join("; ");
}

export const HTML_RENDER_HOST_CONTEXT_CHANGED = "ui/notifications/host-context-changed";
export const HTML_RENDER_OPEN_LINK = "ui/open-link";
export const HTML_RENDER_SIZE_CHANGED = "ui/notifications/size-changed";

const THEME_STYLE_ID = "kilo-html-render-theme";

export interface HtmlRenderTheme {
	readonly appearance: "light" | "dark";
	readonly variables: Readonly<Record<string, string>>;
}

const COMMON_CSS =
	"html{color:var(--foreground);font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}" +
	"body{margin:0}code,kbd,pre,samp{font-family:var(--font-mono)}" +
	// Focus outlines paint inside the element, so the frame edge never clips them.
	":where(:focus-visible){outline:2px solid var(--ring);outline-offset:-2px}";
// In chat the page is transparent over the reply and the frame fits it.
const BASE_CSS = `${COMMON_CSS}html{background:transparent;scrollbar-width:none}html::-webkit-scrollbar{display:none}`;
// A saved file opens on its own in a browser, so it brings the background and
// a margin the chat used to provide.
const STANDALONE_CSS = `${COMMON_CSS}html{background:var(--background)}body{padding:24px}`;

const VARIABLE_NAME = /^--[a-z0-9-]+$/;
const UNSAFE_VALUE_CHARACTERS = /[;{}<>]/g;

function themeRule(theme: HtmlRenderTheme): string {
	const declarations = Object.entries(theme.variables)
		.filter(([name]) => VARIABLE_NAME.test(name))
		.map(([name, value]) => `${name}:${value.replace(UNSAFE_VALUE_CHARACTERS, "")};`)
		.join("");
	return `:root{color-scheme:${theme.appearance === "light" ? "light" : "dark"};${declarations}}`;
}

// Kept in ES5 because it runs inside arbitrary agent pages. The size rule
// mirrors how the frame is laid out: overflowing content reports its scroll
// height, otherwise the root box's own height, so the frame can also shrink.
const BOOTSTRAP_SCRIPT = `(function(){
var style=document.getElementById(${JSON.stringify(THEME_STYLE_ID)});
var base=${JSON.stringify(BASE_CSS)};
var parentWindow=window.parent;
if(parentWindow===window)return;
function applyTheme(appearance,variables){
if(!style||!variables||typeof variables!=="object")return;
var css=":root{color-scheme:"+(appearance==="light"?"light":"dark")+";";
for(var name in variables){if(${VARIABLE_NAME}.test(name))css+=name+":"+String(variables[name]).replace(${UNSAFE_VALUE_CHARACTERS},"")+";";}
style.textContent=css+"}"+base;
}
window.addEventListener("message",function(event){
if(event.source!==parentWindow)return;
var data=event.data,params=data&&data.params;
if(!data||data.jsonrpc!=="2.0"||data.method!==${JSON.stringify(HTML_RENDER_HOST_CONTEXT_CHANGED)}||!params||!params.styles)return;
applyTheme(params.theme,params.styles.variables);
});
var linkId=0;
document.addEventListener("click",function(event){
var path=event.composedPath?event.composedPath():[];
var link=null;
for(var i=0;i<path.length;i++){var node=path[i];if(node&&node.matches&&node.matches("a[href]")){link=node;break;}}
if(!link)return;
var url;
try{url=new URL(link.getAttribute("href"),document.baseURI);}catch(error){event.preventDefault();return;}
if(url.href.split("#")[0]===location.href.split("#")[0])return;
event.preventDefault();
if(!event.isTrusted||!/^https?:$/.test(url.protocol))return;
parentWindow.postMessage({jsonrpc:"2.0",id:"kilo-link-"+(++linkId),method:${JSON.stringify(HTML_RENDER_OPEN_LINK)},params:{url:url.href}},"*");
},true);
var lastHeight;
function reportSize(){
var root=document.documentElement;
var height=Math.ceil(root.scrollHeight>root.clientHeight?root.scrollHeight:root.getBoundingClientRect().height);
if(height===lastHeight)return;
lastHeight=height;
parentWindow.postMessage({jsonrpc:"2.0",method:${JSON.stringify(HTML_RENDER_SIZE_CHANGED)},params:{height:height}},"*");
}
var observer=window.ResizeObserver?new ResizeObserver(reportSize):null;
if(observer)observer.observe(document.documentElement);
document.addEventListener("DOMContentLoaded",function(){if(observer&&document.body)observer.observe(document.body);reportSize();});
window.addEventListener("load",reportSize);
})();`;

function bootstrapMarkup(scan: string, theme: HtmlRenderTheme, standalone: boolean): string {
	return [
		standalone || /<meta\s[^>]*charset/i.test(scan.slice(0, 4096)) ? "" : '<meta charset="utf-8">',
		/<meta\s[^>]*name\s*=\s*["']?viewport/i.test(scan)
			? ""
			: '<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<style id="${THEME_STYLE_ID}">${themeRule(theme)}${standalone ? STANDALONE_CSS : BASE_CSS}</style>`,
		standalone ? "" : `<script>${BOOTSTRAP_SCRIPT}</script>`,
	].join("");
}

// Comments, raw-text elements, and template contents are blanked to the same
// length, so offsets still line up and a `<head>` inside them never receives
// the bootstrap.
function blankNonMarkup(html: string): string {
	const scan = html.replace(
		/<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)|<plaintext\b[\s\S]*$/gi,
		(match) => " ".repeat(match.length),
	);
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	let at = 0;
	for (const match of scan.matchAll(/<(\/?)template(?:\s[^>]*)?\/?>/gi)) {
		if (!match[1]) {
			if (depth++ === 0) start = match.index;
		} else if (depth > 0 && --depth === 0) {
			const end = match.index + match[0].length;
			parts.push(scan.slice(at, start), " ".repeat(end - start));
			at = end;
		}
	}
	if (depth > 0) {
		parts.push(scan.slice(at, start), " ".repeat(scan.length - start));
		at = scan.length;
	}
	parts.push(scan.slice(at));
	return parts.join("");
}

/**
 * Leads a saved copy with the html-render CSP, so opened from disk it is held
 * to the same rules as in chat (no network, no loopback). It goes before any
 * of the page's own markup — right after a doctype — because a `<meta>` policy
 * only governs what follows it; the parser files it into the head either way.
 * The UTF-8 declaration comes first, as the file is written in UTF-8 and
 * browsers only look for it near the top.
 */
function withStandaloneHeader(page: string): string {
	const header = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${htmlRenderContentSecurityPolicy()}">`;
	const doctype = /^\s*<!doctype[^>]*>/i.exec(page);
	const at = doctype ? doctype[0].length : 0;
	return page.slice(0, at) + header + page.slice(at);
}

/**
 * Returns `html` with the theme and bootstrap as the first children of its
 * `<head>`. `standalone` is for a saved copy: it keeps the theme (as a static
 * snapshot), drops the chat-frame script, and carries the html-render CSP.
 */
export function injectHtmlRenderBootstrap(
	html: string,
	theme: HtmlRenderTheme,
	{ standalone = false }: { readonly standalone?: boolean } = {},
): string {
	const page = injectIntoHead(html, theme, standalone);
	return standalone ? withStandaloneHeader(page) : page;
}

function injectIntoHead(html: string, theme: HtmlRenderTheme, standalone: boolean): string {
	const scan = blankNonMarkup(html);
	const markup = bootstrapMarkup(scan, theme, standalone);
	const headOpen = /<head(?:\s[^>]*)?>/i.exec(scan);
	if (headOpen) {
		const at = headOpen.index + headOpen[0].length;
		return html.slice(0, at) + markup + html.slice(at);
	}
	const htmlOpen = /<html(?:\s[^>]*)?>/i.exec(scan);
	if (htmlOpen) {
		const at = htmlOpen.index + htmlOpen[0].length;
		return `${html.slice(0, at)}<head>${markup}</head>${html.slice(at)}`;
	}
	const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
	if (doctype) {
		const at = doctype[0].length;
		return `${html.slice(0, at)}<head>${markup}</head>${html.slice(at)}`;
	}
	return `<!doctype html><head>${markup}</head>${html}`;
}

export function htmlRenderThemeMessage(theme: HtmlRenderTheme) {
	return {
		jsonrpc: "2.0",
		method: HTML_RENDER_HOST_CONTEXT_CHANGED,
		params: { theme: theme.appearance, styles: { variables: theme.variables } },
	} as const;
}

function readJsonRpc(data: unknown, method: string): Record<string, unknown> | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const message = data as Record<string, unknown>;
	if (message.jsonrpc !== "2.0" || message.method !== method) return undefined;
	return typeof message.params === "object" && message.params !== null
		? (message.params as Record<string, unknown>)
		: undefined;
}

export function readHtmlRenderContentHeight(data: unknown): number | undefined {
	const height = readJsonRpc(data, HTML_RENDER_SIZE_CHANGED)?.height;
	return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : undefined;
}

/** The http(s) URL a reader clicked in the page, if `data` is an open-link request. */
export function readHtmlRenderLinkUrl(data: unknown): string | undefined {
	const url = readJsonRpc(data, HTML_RENDER_OPEN_LINK)?.url;
	if (typeof url !== "string") return undefined;
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
	} catch {
		return undefined;
	}
}
