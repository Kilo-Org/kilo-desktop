import { access, cp } from "node:fs/promises";
import path from "node:path";

export async function assertWebBuildPresent(distDirectory: string): Promise<void> {
	try {
		await access(path.join(distDirectory, "index.html"));
	} catch {
		throw new Error(
			`Web build is missing at ${path.join(distDirectory, "index.html")}. Run pnpm --filter @kilo-desktop/web build first.`,
		);
	}
}

export async function stageWebRenderer(buildPath: string, distDirectory: string): Promise<void> {
	await assertWebBuildPresent(distDirectory);
	const rendererDestination = path.join(buildPath, ".vite/renderer/main_window");
	await cp(distDirectory, rendererDestination, { recursive: true });
}
