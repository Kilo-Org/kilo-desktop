import { describe, expect, it } from "vitest";

import {
	FILTERED_VALUE,
	isSensitiveKey,
	MAX_REDACTED_TEXT_LENGTH,
	redactSecretValues,
} from "./sentry-secret-patterns.js";

// Fake credentials are built at runtime, so no key-shaped literal sits in the source.
const fakeTail = "FAKE0".repeat(6);
const join = (...parts: string[]) => parts.join("");
// Builds a URL whose userinfo holds a password, so no such URL sits in the source.
const credentialUrl = (scheme: string, password: string, rest: string, user = "app") =>
	[scheme, "://", user, ":", password, "@", rest].join("");
const openAiKey = join("sk", "-proj-", fakeTail);
const anthropicKey = join("sk", "-ant-api03-", fakeTail);
const openRouterKey = join("sk", "-or-v1-", fakeTail);
const opaqueToken = join("fake", fakeTail);
const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJmYWtlIn0", "ZmFrZS1zaWduYXR1cmU"].join(".");
const githubToken = join("gh", "p_", fakeTail);
const dashes = "-----";
const privateKey = [
	`${dashes}BEGIN PRIVATE KEY${dashes}`,
	"RkFLRS1LRVktTUFURVJJQUwtMDAwMDAwMDAwMDAwMDAwMDAw",
	`${dashes}END PRIVATE KEY${dashes}`,
].join("\n");

describe("redactSecretValues", () => {
	it.each([
		["an OpenAI key", `401 Incorrect API key provided: ${openAiKey}.`],
		["an Anthropic key", `x-api-key header ${anthropicKey} is invalid`],
		["an OpenRouter key", `OPENROUTER key ${openRouterKey} has no credits`],
		["a GitHub token", `git remote token ${githubToken}`],
		["a JWT", `token rejected: ${jwt}`],
		["a Google API key", `quota exceeded for ${join("AI", "za", "F".repeat(35))} today`],
		["a Groq key", `invalid ${join("gsk", "_", fakeTail)} given`],
		["an xAI key", `invalid ${join("xai", "-", fakeTail)} given`],
		["a Hugging Face token", `invalid ${join("hf", "_", fakeTail)} given`],
		["a Stripe live secret key", `invalid ${join("sk", "_live_", fakeTail)} given`],
		["a Stripe test secret key", `invalid ${join("sk", "_test_", fakeTail)} given`],
		["a Stripe restricted key", `invalid ${join("rk", "_live_", fakeTail)} given`],
		["a GitLab token", `invalid ${join("glpat", "-", fakeTail)} given`],
		["an npm token", `invalid ${join("npm", "_", fakeTail)} given`],
		["a Perplexity key", `invalid ${join("pplx", "-", fakeTail)} given`],
		["a Cerebras key", `invalid ${join("csk", "-", fakeTail)} given`],
		["an AWS access key id", `invalid ${join("AK", "IA", "FAKE0FAKE0FAKE00")} given`],
		["an AWS temporary key id", `invalid ${join("AS", "IA", "FAKE0FAKE0FAKE00")} given`],
	])("filters %s in free text", (_name, text) => {
		const redacted = redactSecretValues(text);
		expect(redacted).toContain(FILTERED_VALUE);
		expect(redacted).not.toMatch(/FAKE0|FFFFFFFF/);
		expect(redacted).not.toContain("ZmFrZS1zaWduYXR1cmU");
	});

	it("filters an Anaconda channel token in a URL path", () => {
		expect(
			redactSecretValues(
				`fetch failed: https://conda.anaconda.org/t/${join("fk", "-", "0a1b2c3d-4e5f")}/acme/noarch/repodata.json`,
			),
		).toBe(
			`fetch failed: https://conda.anaconda.org/t/${FILTERED_VALUE}/acme/noarch/repodata.json`,
		);
	});

	it("filters a Bearer token and keeps the scheme readable", () => {
		expect(redactSecretValues(`Authorization: Bearer ${opaqueToken}`)).toBe(
			`Authorization: Bearer ${FILTERED_VALUE}`,
		);
	});

	it("filters authorization and cookie header lines to the end of the line", () => {
		expect(redactSecretValues(`authorization: token short-${opaqueToken} extra\nnext line`)).toBe(
			`authorization: token ${FILTERED_VALUE}\nnext line`,
		);
		expect(redactSecretValues(`Cookie: theme=dark; sid=${opaqueToken}`)).toBe(
			`Cookie: ${FILTERED_VALUE}`,
		);
		expect(redactSecretValues(`set-cookie: sid=${opaqueToken}; Path=/`)).toBe(
			`set-cookie: ${FILTERED_VALUE}`,
		);
	});

	it("filters a header line whose name marks a credential to the end of the line", () => {
		expect(redactSecretValues(`request headers: x-api-key: ${opaqueToken}, accept: */*`)).toBe(
			`request headers: x-api-key: ${FILTERED_VALUE}`,
		);
		expect(redactSecretValues(`Ocp-Apim-Subscription-Key: ${opaqueToken}`)).toBe(
			`Ocp-Apim-Subscription-Key: ${FILTERED_VALUE}`,
		);
		const botToken = `${"1".repeat(6)}:${join("AAH", "x".repeat(30))}`;
		expect(redactSecretValues(`config:\nbot_token: ${botToken}\nchat: 42`)).toBe(
			`config:\nbot_token: ${FILTERED_VALUE}\nchat: 42`,
		);
		expect(redactSecretValues("api_key: user:fake-secret\r\nnext: line")).toBe(
			`api_key: ${FILTERED_VALUE}\r\nnext: line`,
		);
	});

	it.each([
		["SMTP_PASS", "JSON", `{"SMTP_PASS":"fake-pass-value"}`],
		["DB_PASS", "NAME=value", "DB_PASS=fake-pass-value npm start"],
		["REDIS_PASS", "header line", "REDIS_PASS: fake-pass-value"],
		["MYSQL_PWD", "NAME=value", "MYSQL_PWD=fake-pass-value mysql"],
		["PGPWD", "JSON", `{"PGPWD":"fake-pass-value"}`],
	])("filters a %s value in %s form", (_name, _form, text) => {
		const redacted = redactSecretValues(text);
		expect(redacted).toContain(FILTERED_VALUE);
		expect(redacted).not.toContain("fake-pass-value");
	});

	it("filters the password of a Go database DSN without a scheme", () => {
		expect(redactSecretValues("open db: app:fake-password@tcp(db.example.test:3306)/main")).toBe(
			`open db: app:${FILTERED_VALUE}@tcp(db.example.test:3306)/main`,
		);
		expect(redactSecretValues('DSN="app:fake-password@unix(/run/mysqld.sock)/main"')).toBe(
			`DSN="app:${FILTERED_VALUE}@unix(/run/mysqld.sock)/main"`,
		);
	});

	it("filters the credentials of a database URL and keeps its host", () => {
		expect(
			redactSecretValues(
				`connect ECONNREFUSED ${credentialUrl("postgres", "fake-password", "db.example.test:5432/main")}`,
			),
		).toBe(`connect ECONNREFUSED postgres://${FILTERED_VALUE}@db.example.test:5432/main`);
		expect(
			redactSecretValues(credentialUrl("mongodb+srv", "fake-pw", "cluster0.example.test/db", "u")),
		).toBe(`mongodb+srv://${FILTERED_VALUE}@cluster0.example.test/db`);
	});

	it("filters URL credentials up to the last @, even when the password holds @ or /", () => {
		expect(
			redactSecretValues(`${credentialUrl("postgres", "fa@ke/pw", "db.example.test/main")} failed`),
		).toBe(`postgres://${FILTERED_VALUE}@db.example.test/main failed`);
		expect(redactSecretValues(credentialUrl("postgres", "pa@ss/w", "db.example.test/main"))).toBe(
			`postgres://${FILTERED_VALUE}@db.example.test/main`,
		);
	});

	it("keeps URLs with an @ in their path readable", () => {
		const urls = [
			"at app:///node_modules/@vscode/proxy-agent/out/index.js:12:3",
			"GET https://registry.npmjs.org/@kilocode/cli failed",
		];
		for (const text of urls) expect(redactSecretValues(text)).toBe(text);
	});

	it("filters credential parameters in queries, env lines, cookies and brackets", () => {
		expect(
			redactSecretValues(
				`GET https://api.example.test/v1/models?api_key=${opaqueToken}&page=2 failed`,
			),
		).toBe(`GET https://api.example.test/v1/models?api_key=${FILTERED_VALUE}&page=2 failed`);
		expect(redactSecretValues(`OPENAI_API_KEY=${opaqueToken} kilo serve`)).toBe(
			`OPENAI_API_KEY=${FILTERED_VALUE} kilo serve`,
		);
		expect(redactSecretValues(`theme=dark; session=${opaqueToken}`)).toBe(
			`theme=dark; session=${FILTERED_VALUE}`,
		);
		expect(redactSecretValues(`env ("token=${opaqueToken}")`)).toBe(
			`env ("token=${FILTERED_VALUE}")`,
		);
		expect(redactSecretValues(`{password=${opaqueToken}}`)).toBe(`{password=${FILTERED_VALUE}}`);
		expect(redactSecretValues(`/callback#access_token=${opaqueToken}`)).toBe(
			`/callback#access_token=${FILTERED_VALUE}`,
		);
	});

	it.each([
		["AccountKey", `DefaultEndpointsProtocol=https;AccountName=acme;AccountKey=${opaqueToken};`],
		["PGPASSWORD", `PGPASSWORD=${opaqueToken} psql`],
		["NGROK_AUTHTOKEN", `NGROK_AUTHTOKEN=${opaqueToken} ngrok http 80`],
		["JSESSIONID", `JSESSIONID=${opaqueToken}; Path=/`],
	])("filters a %s value", (_name, text) => {
		const redacted = redactSecretValues(text);
		expect(redacted).toContain(FILTERED_VALUE);
		expect(redacted).not.toContain("FAKE0");
	});

	it("filters command-line flags that carry a credential", () => {
		expect(redactSecretValues(`kilo serve --api-key ${opaqueToken} --port 4096`)).toBe(
			`kilo serve --api-key ${FILTERED_VALUE} --port 4096`,
		);
		expect(redactSecretValues(`run --token="${opaqueToken}" -v`)).toBe(
			`run --token="${FILTERED_VALUE}" -v`,
		);
	});

	it("filters quoted credential values in JSON and inspected objects", () => {
		expect(
			redactSecretValues(
				`Configuration is invalid: {"provider":{"acme":{"options":{"apiKey":"${opaqueToken}","baseURL":"https://acme.test"}}}}`,
			),
		).toBe(
			`Configuration is invalid: {"provider":{"acme":{"options":{"apiKey":"${FILTERED_VALUE}","baseURL":"https://acme.test"}}}}`,
		);
		expect(redactSecretValues(`{ apiKey: '${opaqueToken}', model: 'acme-1' }`)).toBe(
			`{ apiKey: '${FILTERED_VALUE}', model: 'acme-1' }`,
		);
		expect(redactSecretValues(`password = "${opaqueToken}"`)).toBe(
			`password = "${FILTERED_VALUE}"`,
		);
	});

	it("filters quoted credential values inside an escaped JSON string", () => {
		expect(
			redactSecretValues(`body: "{\\"apiKey\\":\\"${opaqueToken}\\",\\"model\\":\\"acme-1\\"}"`),
		).toBe(`body: "{\\"apiKey\\":\\"${FILTERED_VALUE}\\",\\"model\\":\\"acme-1\\"}"`);
	});

	it("filters a private key block", () => {
		expect(redactSecretValues(`key file:\n${privateKey}\nend`)).toBe(
			`key file:\n${FILTERED_VALUE}\nend`,
		);
	});

	it("keeps ordinary diagnostics readable", () => {
		const text =
			"Kilo server exited before becoming ready (code 1). Unrecognized key: reasoning_display at line 4; inputTokens=1200 sessionId=ses_123 url: https://registry.example.test/pkg";
		expect(redactSecretValues(text)).toBe(text);
	});

	it("cuts long text and drops a secret cut at the limit", () => {
		const text = `${"a ".repeat(MAX_REDACTED_TEXT_LENGTH / 2 - 4)}Bearer ${opaqueToken}`;
		const redacted = redactSecretValues(text);
		expect(redacted.endsWith("[Truncated]")).toBe(true);
		expect(redacted).not.toContain("FAKE0");
		expect(redacted.length).toBeLessThanOrEqual(MAX_REDACTED_TEXT_LENGTH + "[Truncated]".length);
	});

	it("filters a quoted credential value left open by the cut", () => {
		const head = "a ".repeat(MAX_REDACTED_TEXT_LENGTH / 2 - 20);
		const text = `${head}{"password":"fake pass phrase with spaces ${"x ".repeat(40)}"}`;
		const redacted = redactSecretValues(text);
		expect(redacted.endsWith(`{"password":"${FILTERED_VALUE}[Truncated]`)).toBe(true);
		expect(redacted).not.toContain("fake pass phrase");
	});

	// Each input goes through the production path: cut to MAX_REDACTED_TEXT_LENGTH,
	// then every pattern. A pattern that backtracks quadratically would still take
	// seconds on the 32 KB that remain.
	const nearMatches = (fragment: string) => fragment.repeat(Math.ceil(200_000 / fragment.length));
	it.each([
		["a long word", "a".repeat(200_000)],
		["repeated whitespace", " ".repeat(200_000)],
		["a bearer prefix with long whitespace", `Bearer${" ".repeat(200_000)}`],
		["repeated bearer prefixes", nearMatches("Bearer ")],
		["a JWT start with one long segment", `eyJa.${"a".repeat(200_000)}`],
		["repeated JWT starts", nearMatches("eyJ-")],
		["repeated sk- prefixes", nearMatches("sk-")],
		["repeated AIza prefixes", nearMatches("AIza")],
		["a URL scheme run with no userinfo", nearMatches("ab://")],
		["URL userinfo with no host end", `postgres://${"a".repeat(200_000)}`],
		["repeated URL userinfo", nearMatches("ab://c@")],
		["repeated channel token prefixes", nearMatches("/t/")],
		["private key headers with no end line", nearMatches(`${dashes}BEGIN PRIVATE KEY${dashes}`)],
		["a parameter with a long name", `&${"a".repeat(200_000)}`],
		["repeated parameter starts", nearMatches("a=&")],
		["nested parameter prefixes", nearMatches("(a=(")],
		["percent-encoded separators", nearMatches("%3D%26")],
		["nested header prefixes before an equals sign", `${nearMatches("{a:")}=`],
		["repeated header names", nearMatches("a: ")],
		["header names inside brackets", nearMatches("[a:{a:(a:")],
		["repeated authorization lines", nearMatches("authorization: ")],
		["a quoted value with no end quote", `"apiKey":"${"a".repeat(200_000)}`],
		["repeated quoted keys", nearMatches('"a":"')],
		["alternating quote kinds", nearMatches(`a="b='`)],
		["escaped quotes", nearMatches('a="\\"')],
		["repeated escaped keys", nearMatches('\\"a\\":\\"')],
		["repeated flags", nearMatches("--a ")],
		["repeated open quoted tails", nearMatches('token:"')],
		["repeated sensitive header lines", nearMatches("token: a\n")],
		["sensitive header names with no value", nearMatches("token:\n")],
		["repeated Go DSN prefixes", nearMatches("=a:")],
		["a Go DSN password with no host", `=a:${"b".repeat(200_000)}`],
		["Go DSN near matches", nearMatches("=a:b@tcp")],
		["a slack webhook path", `https://hooks.slack.com/${"a".repeat(200_000)}`],
	])("redacts 200 KB of %s in linear time", (_name, input) => {
		const started = performance.now();
		redactSecretValues(input);
		expect(performance.now() - started).toBeLessThan(100);
	});
});

describe("isSensitiveKey", () => {
	it.each([
		"apiKey",
		"api_key",
		"x-api-key",
		"x-goog-api-key",
		"OPENAI_API_KEY",
		"authorization",
		"accessToken",
		"password",
		"Cookie",
		"privateKey",
		"AccountKey",
		"Ocp-Apim-Subscription-Key",
		"PGPASSWORD",
		"NGROK_AUTHTOKEN",
		"JSESSIONID",
		"PHPSESSID",
		"clientsecret",
		"secrets",
		"encryptionKeys",
		"SMTP_PASS",
		"DB_PASS",
		"MYSQL_PWD",
		"PGPWD",
		"accessTokens",
		"refreshTokens",
		"passwords",
		"apiKeyValue",
		"secretValue",
	])("treats %s as a credential key", (key) => {
		expect(isSensitiveKey(key)).toBe(true);
	});

	it.each([
		"sessionId",
		"keyboard",
		"key",
		"url",
		"message",
		"monkey",
		"publicKey",
		"primary_key",
		"cacheKey",
		"keyId",
		"idempotencyKey",
		"sortKey",
		"bypass",
		"compass",
		"cwd",
		// A hash of a password is not the credential itself; only the last word decides.
		"pwdHash",
	])("keeps %s readable", (key) => {
		expect(isSensitiveKey(key)).toBe(false);
	});

	it("keeps a token count readable and filters token values", () => {
		expect(isSensitiveKey("inputTokens", 1200)).toBe(false);
		expect(isSensitiveKey("tokens", "3")).toBe(false);
		expect(isSensitiveKey("tokens", "fake-token-value")).toBe(true);
		expect(isSensitiveKey("accessTokens", ["fake-token-value"])).toBe(true);
	});
});
