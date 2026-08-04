import {
	AssistantRuntimeProvider,
	type ChatModelAdapter,
	useLocalRuntime,
} from "@assistant-ui/react";
import type { FC } from "react";

import { Composer } from "@/components/assistant-ui/composer";
import { ZoneOutlet } from "@/components/zones/ZoneOutlet";
import { WorkspaceSelector } from "@/features/workspaces/WorkspaceSelector";

/**
 * Stub model until home → chat navigation is wired. Keeps the official
 * Composer interactive without mounting a full Thread on the home page.
 */
const homeChatModel: ChatModelAdapter = {
	async run() {
		return {
			content: [],
		};
	},
};

const HomeWelcome: FC = () => {
	return (
		<div className="aui-thread-welcome-root relative z-10 mb-6 flex flex-col items-center px-4 text-center">
			<h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-semibold duration-200">
				What would you like to build?
			</h1>
		</div>
	);
};

export function HomeView() {
	const runtime = useLocalRuntime(homeChatModel);

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<div className="aui-root flex h-full min-h-0 flex-col">
				<div className="mx-auto flex w-full max-w-[44rem] flex-1 flex-col justify-center px-4 pb-6">
					<HomeWelcome />
					<div className="relative">
						<div
							aria-hidden="true"
							className="fade-in zoom-in-40 blur-in-[90px] motion-safe:animate-in fill-mode-both pointer-events-none absolute top-1/2 left-1/2 h-[260px] w-[680px] max-w-[92%] -translate-x-1/2 -translate-y-1/2 rounded-[140px] bg-green-300/40 blur-[90px] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] dark:bg-green-900/25"
						/>
						<div className="relative z-10">
							<Composer leadingAction={<WorkspaceSelector />} />
						</div>
					</div>
					{/* Dashboard widgets registered via sdk.contribute("dashboard", ...) */}
					<ZoneOutlet zone="dashboard" className="mt-6 grid gap-3" />
				</div>
			</div>
		</AssistantRuntimeProvider>
	);
}
