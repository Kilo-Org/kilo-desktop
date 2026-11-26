/**
 * Credential redaction for free text that can reach Sentry: exception values,
 * messages, breadcrumbs, span names and attributes. Output of local processes
 * and provider errors can quote API keys, tokens or database URLs, and no key
 * name marks them, so they are matched by shape and by the name before them.
 *
 * Every pattern runs on text cut to a fixed length first, and reads each
 * character a bounded number of times:
 * - no nested or overlapping quantifiers;
 * - a value class excludes every character that can start another match of the
 *   same pattern, or the value cannot fail once it starts (`*` up to a stop
 *   character), so a failed match never rescans a long run;
 * - a run that can fail late (a quoted value with no end quote) is bounded.
 */

export const FILTERED_VALUE = "[Filtered]";
export const MAX_REDACTED_TEXT_LENGTH = 32 * 1024;
const TRUNCATED_MARKER = "[Truncated]";

const BEARER_PATTERN = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi;
const BASIC_PATTERN = /\b(Basic)\s+[A-Za-z0-9+/]{16,}={0,2}/gi;

// The body class has no `-`, so a match ends at the next dash and a run of
// headers with no end line is scanned once. The end line is optional, so a body
// cut at the length limit is still removed.
const PRIVATE_KEY_PATTERN =
	/-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[A-Za-z0-9+/=\s\\]*(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----)?/g;

// The path of these webhook URLs is the credential.
const WEBHOOK_URL_PATTERNS = [
	/\b(https?:\/\/hooks\.slack\.com\/)[A-Za-z0-9/_-]+/gi,
	/\b(https?:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/)[A-Za-z0-9/_-]+/gi,
];

// A whole URL. The run never fails once `://` matched, so a URL is read once;
// redactUrlUserinfo filters everything up to its last `@`, which covers a
// userinfo password that itself holds `@` or `/`.
const URL_PATTERN = /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s"'<>]*/gi;

// An Anaconda channel token sits in the path: `https://conda.anaconda.org/t/<token>/channel`.
const CHANNEL_TOKEN_PATTERN = /(\/t\/)[A-Za-z0-9_.-]{8,}/g;

const SECRET_VALUE_PATTERNS = [
	// A JWS has three segments and a JWE has five; a JWE can have an empty key segment.
	// The first segment stops before another `-eyJ`, so a run such as `eyJ-eyJ-...`
	// is scanned once and not once for every start.
	/\beyJ(?:[A-Za-z0-9_]|-(?!eyJ))+(?:\.[A-Za-z0-9_-]*){2,4}/g,
	// OpenAI, Anthropic (`sk-ant-`), OpenRouter (`sk-or-`) and other `sk-` keys.
	/\bsk-[A-Za-z0-9_-]{20,}/g,
	// Stripe secret and restricted keys.
	/\b[rs]k_(?:live|test)_[A-Za-z0-9]{10,}/g,
	// Google and Gemini API keys.
	/\bAIza[0-9A-Za-z_-]{35}/g,
	// Groq, xAI, Hugging Face, Perplexity and Cerebras keys.
	/\bgsk_[A-Za-z0-9]{20,}/g,
	/\bxai-[A-Za-z0-9]{20,}/g,
	/\bhf_[A-Za-z0-9]{20,}/g,
	/\bpplx-[A-Za-z0-9]{20,}/g,
	/\bcsk-[A-Za-z0-9]{20,}/g,
	// AWS access key ids, long-lived (`AKIA`) and temporary (`ASIA`).
	/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
	// GitHub, GitLab, npm and Slack tokens.
	/\bgh[pousr]_[A-Za-z0-9]{20,}/g,
	/\bgithub_pat_[A-Za-z0-9_]{20,}/g,
	/\bglpat-[A-Za-z0-9_-]{20,}/g,
	/\bnpm_[A-Za-z0-9]{20,}/g,
	/\bxox[a-z]-[A-Za-z0-9-]{10,}/g,
];

// `Authorization: …`, `Cookie: …` and `Set-Cookie: …` lines: the value runs to
// the end of the line, and a scheme word before it stays readable. The value
// cannot fail, so the line is read once.
const AUTH_HEADER_LINE_PATTERN =
	/(^|[\s"'{,;([])((?:proxy-)?authorization|(?:set-)?cookie)(:[ \t]{0,8})((?:(?:bearer|basic|token|digest|negotiate)[ \t]+)?)([^\r\n]*)/gi;
const AUTH_HEADER_NAME = /^(?:(?:proxy-)?authorization|(?:set-)?cookie)$/i;

// Any other `name: value` line whose name marks a credential. The value runs to
// the end of the line (`bot_token: 123456:AAH…`, `api_key: user:secret`). The
// pattern ends at the colon, so a name that is not sensitive leaves the rest of
// the line to the next match (`headers: x-api-key: …`); after a sensitive name
// the scan resumes at the end of the line, so a character is read a bounded
// number of times.
const HEADER_NAME_PATTERN =
	/(^|[\s"'{,;([])([A-Za-z][\w-]{0,63}):(?=[ \t]{0,8}[^\s"'`<>{}()[\],;])/g;

// A Go database DSN without a scheme: `user:password@tcp(host:3306)/db`. The
// user and password classes exclude every prefix character, so a password run
// that fails ends where the next match can start.
const GO_DSN_PATTERN =
	/(^|[\s"'=(,;])([^\s"'@:/()=,;]{1,64}):([^\s"'@=(,;]{1,512})@(tcp|udp|unix)\(/g;

// A quoted value after a key, as in JSON (`"apiKey": "…"`), `util.inspect`
// output (`apiKey: '…'`) or a config line (`api_key = "…"`). A match starts only
// at the start of a name, and each quote opens at most one value, which ends at
// the next quote of its kind, so a value is scanned once.
const QUOTED_PAIR_PATTERN =
	/(?<![\w.-])(["']?)([A-Za-z_][\w.-]{0,63})\1(\s{0,8}[:=]\s{0,8})(?:"((?:[^"\\\n]|\\.){1,8192})"|'((?:[^'\\\n]|\\.){1,8192})')/g;

// The same pair inside an escaped JSON string: `{\"apiKey\":\"…\"}`. A value
// stops at the next `\"`, which is where the next match would start.
const ESCAPED_QUOTED_PAIR_PATTERN =
	/\\"([A-Za-z_][\w.-]{0,63})\\"(\s{0,8}:\s{0,8})\\"((?:[^"\\\n]|\\(?!"))*)\\"/g;

// A command-line flag and its value: `--api-key abc`, `--token=abc`. The value
// class excludes whitespace, the prefix character.
const FLAG_PATTERN = /(^|\s)(--?[A-Za-z][\w-]{0,63})([ \t]+|=)(["']?)([^\s"']+)/g;

// A `name=value` pair in a query, a form body, a cookie or a log line, also in
// its percent-encoded form inside another URL. The value stops at `?` and `%3F`,
// so a nested URL in an allowed value is read as its own query. The value cannot
// fail once `=` matched, and its two alternatives never match the same character.
const PARAMETER_PATTERN =
	/(^|[?&;,\s"'([{#/:]|%3[Ff]|%26)([A-Za-z0-9_.[\]-]{1,64})(=|%3[Dd])((?:[^&#\s"'<>%?;,()[\]{}]|%(?!26|3[Ff]))*)/g;

// A quoted value still open at the end of text that was cut at the length limit.
const OPEN_QUOTED_TAIL_PATTERN =
	/(?<![\w.-])(["']?)([A-Za-z_][\w.-]{0,63})\1(\s{0,8}[:=]\s{0,8})(["'])[^"'\n]*$/;

// Names that carry a credential only as a parameter, matched whole: `key` is a
// Google API key, `code` an OAuth or one-time code, `sig` a signed-URL signature.
const SENSITIVE_PARAMETER_NAMES = new Set([
	"code",
	"hmac",
	"key",
	"otp",
	"sig",
	"signature",
	"ticket",
	"x-amz-signature",
]);

// Every sensitive name contains one of these, so a name without one skips the
// word split.
const SENSITIVE_NAME_HINT = /auth|bearer|cookie|credential|jwt|key|pass|pwd|secret|sess|token/i;

// Whole last words that name a credential. `pass` matches only whole
// (`SMTP_PASS`), so `bypass` and `compass` stay readable.
const SENSITIVE_KEY_WORDS = new Set([
	"auth",
	"authorization",
	"bearer",
	"cookie",
	"credential",
	"jwt",
	"pass",
	"passphrase",
	"session",
]);

// A last word ending in one of these is a credential name: `PGPASSWORD`,
// `MYSQL_PWD`, `PGPWD`, `NGROK_AUTHTOKEN`, `clientsecret`, `JSESSIONID`.
const SENSITIVE_WORD_SUFFIXES = [
	"apikey",
	"authtoken",
	"passwd",
	"password",
	"privatekey",
	"pwd",
	"secret",
	"sessid",
	"sessionid",
	"token",
];

const SENSITIVE_KEY_PAIRS = new Set(["auth header", "authorization header", "cookie header"]);

// A name of two or more words ending in `key` names a credential (`AccountKey`,
// `Ocp-Apim-Subscription-Key`) unless it is one of these.
const NON_SECRET_KEY_PAIRS = new Set([
	"cache key",
	"foreign key",
	"idempotency key",
	"primary key",
	"public key",
	"sort key",
]);

const NUMERIC_TEXT = /^\d{1,32}(?:\.\d{1,32})?$/;

// Every character that a secret pattern can match after its prefix.
const SECRET_CHARACTER = /[A-Za-z0-9._~+/=%:@-]/;

function withoutTrailingSecretCharacters(text: string): string {
	let end = text.length;
	while (end > 0 && SECRET_CHARACTER.test(text[end - 1] ?? "")) {
		end--;
	}
	return text.slice(0, end);
}

function keyWords(key: string): string[] {
	return key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length > 0);
}

function namesCredential(word: string, previous: string | undefined): boolean {
	return (
		SENSITIVE_KEY_WORDS.has(word) ||
		SENSITIVE_WORD_SUFFIXES.some((suffix) => word.endsWith(suffix)) ||
		SENSITIVE_KEY_PAIRS.has(`${previous} ${word}`) ||
		(word === "key" && previous !== undefined && !NON_SECRET_KEY_PAIRS.has(`${previous} key`))
	);
}

/**
 * Whether a key names a credential. Only the last word (two for a `… key`
 * name) decides, so `sessionId` stays readable while `accessToken`,
 * `x-api-key` and `PGPASSWORD` do not. A plural counts as its singular
 * (`accessTokens`, `passwords`), and a trailing `value` is skipped
 * (`apiKeyValue`). A `…tokens` name whose value is a number is a count, such as
 * `inputTokens: 1200`, and stays readable.
 */
export function isSensitiveKey(key: string, value?: unknown): boolean {
	if (!SENSITIVE_NAME_HINT.test(key)) return false;
	const words = keyWords(key);
	if (words.length > 1 && (words.at(-1) === "value" || words.at(-1) === "values")) words.pop();
	const last = words.at(-1);
	if (last === undefined) return false;
	const numeric =
		typeof value === "number" || (typeof value === "string" && NUMERIC_TEXT.test(value.trim()));
	if (last.endsWith("tokens") && numeric) return false;
	const previous = words.at(-2);
	return (
		namesCredential(last, previous) ||
		(last.endsWith("s") && namesCredential(last.slice(0, -1), previous))
	);
}

function redactHeaderLines(text: string): string {
	let redacted = "";
	let copied = 0;
	HEADER_NAME_PATTERN.lastIndex = 0;
	for (let match = HEADER_NAME_PATTERN.exec(text); match; match = HEADER_NAME_PATTERN.exec(text)) {
		const name = match[2] ?? "";
		if (AUTH_HEADER_NAME.test(name) || !isSensitiveKey(name)) continue;
		const valueStart = HEADER_NAME_PATTERN.lastIndex;
		let lineEnd = text.indexOf("\n", valueStart);
		if (lineEnd === -1) lineEnd = text.length;
		if (text[lineEnd - 1] === "\r") lineEnd -= 1;
		HEADER_NAME_PATTERN.lastIndex = lineEnd;
		const value = text.slice(valueStart, lineEnd);
		if (!isSensitiveKey(name, value)) continue;
		const indent = value.length - value.trimStart().length;
		redacted += `${text.slice(copied, valueStart)}${value.slice(0, indent)}${FILTERED_VALUE}`;
		copied = lineEnd;
	}
	return copied === 0 ? text : `${redacted}${text.slice(copied)}`;
}

// Filters everything up to the last `@` of the URL, which covers a password
// holding `@` or `/`, but only when that span reads as userinfo: an empty
// authority (`app:///node_modules/@scope/pkg`) and a host path before an `@`
// (`https://registry.npmjs.org/@scope/pkg`) stay readable.
function redactUrlUserinfo(url: string): string {
	const authority = url.indexOf("://") + 3;
	if (url[authority] === "/") return url;
	const at = url.lastIndexOf("@");
	if (at <= authority) return url;
	const userinfo = url.slice(authority, at);
	const slash = userinfo.indexOf("/");
	const colon = userinfo.indexOf(":");
	if (slash !== -1 && (colon === -1 || colon > slash)) return url;
	return `${url.slice(0, authority)}${FILTERED_VALUE}${url.slice(at)}`;
}

function redactAuthHeaderLine(
	match: string,
	prefix: string,
	name: string,
	separator: string,
	scheme: string,
	value: string,
): string {
	return value.length > 0 ? `${prefix}${name}${separator}${scheme}${FILTERED_VALUE}` : match;
}

function redactQuotedPair(
	match: string,
	keyQuote: string,
	name: string,
	separator: string,
	doubleQuoted: string | undefined,
	singleQuoted: string | undefined,
): string {
	if (!isSensitiveKey(name, doubleQuoted ?? singleQuoted)) return match;
	const valueQuote = doubleQuoted === undefined ? "'" : '"';
	return `${keyQuote}${name}${keyQuote}${separator}${valueQuote}${FILTERED_VALUE}${valueQuote}`;
}

function redactEscapedQuotedPair(
	match: string,
	name: string,
	separator: string,
	value: string,
): string {
	return isSensitiveKey(name, value) ? `\\"${name}\\"${separator}\\"${FILTERED_VALUE}\\"` : match;
}

function redactFlag(
	match: string,
	prefix: string,
	name: string,
	separator: string,
	quote: string,
	value: string,
): string {
	return isSensitiveKey(name, value)
		? `${prefix}${name}${separator}${quote}${FILTERED_VALUE}`
		: match;
}

function redactSensitiveParameter(
	match: string,
	prefix: string,
	name: string,
	separator: string,
	value: string,
): string {
	const sensitive =
		value.length > 0 &&
		(SENSITIVE_PARAMETER_NAMES.has(name.toLowerCase()) || isSensitiveKey(name, value));
	return sensitive ? `${prefix}${name}${separator}${FILTERED_VALUE}` : match;
}

function redactOpenQuotedTail(
	match: string,
	keyQuote: string,
	name: string,
	separator: string,
	valueQuote: string,
): string {
	return isSensitiveKey(name)
		? `${keyQuote}${name}${keyQuote}${separator}${valueQuote}${FILTERED_VALUE}`
		: match;
}

/**
 * Replace credentials in free text with `[Filtered]`. Text over `maxLength` is
 * cut first, so the patterns never run on unbounded input; the characters before
 * the cut that could start a secret are dropped too, because a cut secret is too
 * short for its pattern to match, and a quoted credential value left open by the
 * cut is filtered.
 */
export function redactSecretValues(text: string, maxLength = MAX_REDACTED_TEXT_LENGTH): string {
	const truncated = text.length > maxLength;
	const kept = truncated ? withoutTrailingSecretCharacters(text.slice(0, maxLength)) : text;
	let redacted = kept.replace(PRIVATE_KEY_PATTERN, FILTERED_VALUE);
	for (const pattern of WEBHOOK_URL_PATTERNS) {
		redacted = redacted.replace(pattern, `$1${FILTERED_VALUE}`);
	}
	redacted = redacted
		.replace(URL_PATTERN, redactUrlUserinfo)
		.replace(GO_DSN_PATTERN, `$1$2:${FILTERED_VALUE}@$4(`)
		.replace(CHANNEL_TOKEN_PATTERN, `$1${FILTERED_VALUE}`)
		.replace(BEARER_PATTERN, `$1 ${FILTERED_VALUE}`)
		.replace(BASIC_PATTERN, `$1 ${FILTERED_VALUE}`);
	for (const pattern of SECRET_VALUE_PATTERNS) {
		redacted = redacted.replace(pattern, FILTERED_VALUE);
	}
	redacted = redactHeaderLines(redacted.replace(AUTH_HEADER_LINE_PATTERN, redactAuthHeaderLine))
		.replace(QUOTED_PAIR_PATTERN, redactQuotedPair)
		.replace(ESCAPED_QUOTED_PAIR_PATTERN, redactEscapedQuotedPair)
		.replace(FLAG_PATTERN, redactFlag)
		.replace(PARAMETER_PATTERN, redactSensitiveParameter);
	if (!truncated) return redacted;
	return `${redacted.replace(OPEN_QUOTED_TAIL_PATTERN, redactOpenQuotedTail)}${TRUNCATED_MARKER}`;
}
