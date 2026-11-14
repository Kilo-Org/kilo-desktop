// A stand-in for `celld dev <dir> --host <h> --port <p> --no-watch`, run with
// Node by the process tests. FAKE_CELLD_MODE picks how it behaves:
// serve (default), crash (exits before answering), exit-later (answers, then
// exits), stubborn (ignores SIGTERM), slow (answers after a second).
import http from "node:http";

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const mode = process.env.FAKE_CELLD_MODE ?? "serve";

console.log(`celld dev ${args[1]}`);
if (mode === "crash") {
	console.error("error: not a regular file: index.js");
	process.exit(3);
}
if (mode === "stubborn") process.on("SIGTERM", () => console.log("ignoring SIGTERM"));

const serve = () =>
	http
		.createServer((request, response) => {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ args, cwd: process.cwd(), path: request.url }));
		})
		.listen(Number(option("--port")), option("--host"), () => {
			console.log(`listening on ${option("--host")}:${option("--port")}`);
			if (mode === "exit-later") setTimeout(() => process.exit(1), 300);
		});

if (mode === "slow") setTimeout(serve, 1_000);
else serve();
