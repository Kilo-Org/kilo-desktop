import {
	buildPackagedApp,
	KILO_GATEWAY_STUB_URL_ENV,
	killStrayProcesses,
} from "./utils/app-launcher.js";
import {
	CHAT_COMPLETIONS_STUB_URL_ENV,
	startChatCompletionsStub,
} from "./utils/chat-completions-stub.js";
import { assertSharedHarnessDependencies } from "./utils/harness-dependencies.js";
import { prewarmKiloCli } from "./utils/kilo-cli-prewarm.js";
import { startKiloGatewayStub } from "./utils/kilo-gateway-stub.js";
import { chatAttachmentStubReplies } from "./testdata/chat/attachments.js";
import {
	desktopToolsStubReplies,
	desktopToolsStubToolCalls,
} from "./testdata/chat/desktop-tools.js";
import { chatFileMentionStubReplies } from "./testdata/chat/file-mentions.js";
import { chatSendKeysStubReplies } from "./testdata/chat/send-keys.js";
import { chatSmokeStubReplies, chatSmokeStubTitles } from "./testdata/chat/smoke.js";

/**
 * Runs once per Playwright invocation, before any worker launches the app.
 *
 * - Harness dependency check first: it is instant and turns a broken plugin
 *   setup into one clear error instead of every attempt failing.
 * - Package outside the first test's timeout. `package:e2e` regularly exceeds
 *   the 6-minute test budget locally (native build + pnpm deploy), which
 *   killed the worker mid-build (`write EPIPE`) and left leftover build dirs.
 * - Sweep orphaned app instances from a crashed earlier run. This kills by
 *   executable name, so it runs only here and in teardown, never while
 *   concurrent workers own live apps.
 * - Start the Kilo Gateway stub and publish its URL through `process.env`,
 *   which Playwright forwards to workers (`packagedAppLaunchEnv` reads it).
 * - Start the chat completions stub the same way, so kilo.chat's specs get a
 *   deterministic assistant reply (and chat title) instead of a real model call.
 * - Pre-warm kilo.core's packaged Kilo CLI so first-execution costs stay out
 *   of the server's startup window.
 *
 * Returns the teardown Playwright runs after the last worker exits.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
	assertSharedHarnessDependencies();
	if (process.env.SKIP_BUILD !== "true") await buildPackagedApp();
	killStrayProcesses();
	const gateway = await startKiloGatewayStub();
	process.env[KILO_GATEWAY_STUB_URL_ENV] = gateway.url;
	const chatCompletions = await startChatCompletionsStub(
		{
			...chatAttachmentStubReplies,
			...chatSendKeysStubReplies,
			...chatSmokeStubReplies,
			...chatFileMentionStubReplies,
			...desktopToolsStubReplies,
		},
		chatSmokeStubTitles,
		desktopToolsStubToolCalls,
	);
	process.env[CHAT_COMPLETIONS_STUB_URL_ENV] = chatCompletions.url;
	const teardown = async () => {
		try {
			await Promise.all([gateway.close(), chatCompletions.close()]);
		} finally {
			delete process.env[KILO_GATEWAY_STUB_URL_ENV];
			delete process.env[CHAT_COMPLETIONS_STUB_URL_ENV];
			killStrayProcesses();
		}
	};
	try {
		await prewarmKiloCli();
	} catch (error) {
		await teardown();
		throw error;
	}
	return teardown;
}
