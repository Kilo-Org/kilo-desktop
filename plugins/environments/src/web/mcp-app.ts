// Built by `build-mcp-app` (prepare-assets); a glob, so a checkout without the build still compiles.
const builtApp = import.meta.glob<string>("../mcp-app/dist/index.html", {
	query: "?raw",
	import: "default",
});

/** The conda environments widget's single-file HTML. */
export async function loadEnvsListApp(): Promise<string> {
	const load = Object.values(builtApp)[0];
	if (!load) throw new Error("The conda environments widget has not been built.");
	return load();
}
