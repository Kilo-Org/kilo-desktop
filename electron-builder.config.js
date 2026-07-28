const channel = process.env.RELEASE_CHANNEL ?? "canary";
const publishUrl =
	process.env.UPDATE_PUBLISH_URL ?? "https://updates.example.invalid/anaconda-agentic-desktop";

/** @type {import("electron-builder").Configuration} */
export default {
	appId: "com.anaconda.agentic-desktop",
	productName: "Anaconda Agentic Desktop",
	directories: {
		output: "../release",
		buildResources: "build",
	},
	files: [
		"package.json",
		".vite/build/**/*",
		".vite/renderer/**/*",
		"drizzle/**/*",
		"!**/node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}",
		"!**/node_modules/*/{test,tests,__tests__,example,examples}",
	],
	asar: true,
	asarUnpack: ["**/node_modules/better-sqlite3/**/*"],
	electronFuses: {
		runAsNode: false,
		enableCookieEncryption: true,
		enableNodeOptionsEnvironmentVariable: false,
		enableNodeCliInspectArguments: false,
		enableEmbeddedAsarIntegrityValidation: true,
		onlyLoadAppFromAsar: true,
	},
	mac: {
		target: ["dmg", "zip"],
		category: "public.app-category.developer-tools",
	},
	win: {
		target: ["nsis"],
	},
	linux: {
		target: ["AppImage", "pacman"],
		category: "Development",
	},
	publish: {
		provider: "generic",
		url: publishUrl,
		channel,
	},
};
