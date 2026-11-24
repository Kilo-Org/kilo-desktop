// A long, realistic session for performance benchmarks: every turn is a
// prompt and a reply that reads, edits and runs things before answering in
// markdown, the shape that makes long agent sessions heavy.
import { assistantMessage, userMessage, type FakeMessage } from "./fake-kilo-server";
import { toolPart } from "./transcript";

const PARAGRAPH =
	"The `login` handler in src/auth/login.ts posts the credentials to the session endpoint, " +
	"then stores the returned token. See **src/auth/session.ts** for the refresh path and " +
	"[the docs](https://example.com/docs/auth) for the protocol.";

const answer = (turn: number) =>
	[
		`## Turn ${turn}: what changed`,
		PARAGRAPH,
		"- Validates the form before posting\n- Retries once on a 503\n- Clears the token on logout",
		"```ts\nexport async function login(user: string, password: string) {\n\tconst res = await post('/session', { user, password });\n\treturn res.token;\n}\n```",
		PARAGRAPH,
		`Final answer for turn ${turn}.`,
	].join("\n\n");

const sourceFile = (turn: number, lines = 60) =>
	Array.from(
		{ length: lines },
		(_, line) => `export const value${turn}_${line} = compute(${line}, "${"x".repeat(24)}");`,
	).join("\n");

/** The `turn`th prompt and its finished reply. */
export function longSessionTurn(chatId: string, turn: number): FakeMessage[] {
	const user = userMessage(chatId, `msg_${turn}_u`, `Question ${turn}: what does login do?`);
	const before = sourceFile(turn);
	const after = before.replace(/compute\(1/g, "computeFast(1");
	const reply = assistantMessage(chatId, `msg_${turn}_a`, user.info.id, [
		{ type: "step-start" },
		{
			type: "reasoning",
			text: `Looking at the login flow for turn ${turn}.`,
			time: { start: 1, end: 2 },
		},
		toolPart(
			"read",
			{
				input: { filePath: `/projects/app/src/file${turn}.ts` },
				output: before,
				title: `file${turn}.ts`,
			},
			`call_${turn}_read`,
		),
		toolPart(
			"edit",
			{
				input: {
					filePath: `/projects/app/src/file${turn}.ts`,
					oldString: before,
					newString: after,
				},
				output: "Edit applied",
				title: `file${turn}.ts`,
			},
			`call_${turn}_edit`,
		),
		toolPart(
			"bash",
			{
				input: { command: "pnpm test", description: "Run tests" },
				output: "ok\n".repeat(40),
				title: "pnpm test",
			},
			`call_${turn}_bash`,
		),
		{ type: "text", text: answer(turn), time: { start: 3, end: 4 } },
		{
			type: "step-finish",
			reason: "stop",
			cost: 0,
			tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
		},
	]);
	return [user, reply];
}

/** A session of `turns` finished turns. */
export function longSession(chatId: string, turns: number): FakeMessage[] {
	return Array.from({ length: turns }, (_, index) => longSessionTurn(chatId, index + 1)).flat();
}
