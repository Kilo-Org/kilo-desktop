import {
	LocalApiError,
	type DesktopApi,
	type InvokeArguments,
	type IpcMethodChannel,
	type IpcMethodOutput,
	type LocalApi,
} from "@anaconda-agentic-desktop/contracts";

export function createElectronLocalApi(bridge: DesktopApi): LocalApi {
	const invoke = async <C extends IpcMethodChannel>(
		channel: C,
		...args: InvokeArguments<C>
	): Promise<IpcMethodOutput<C>> => {
		const result = await bridge.invoke(channel, ...args);
		if (!result.ok) {
			throw new LocalApiError(result.error.code, result.error.message);
		}
		return result.value;
	};

	return {
		theme: {
			sync: (input) => invoke("theme:sync", input),
		},
		shell: {
			openExternal: (input) => invoke("shell:open-external", input),
			copyText: (input) => invoke("shell:copy-text", input),
			showOpenDialog: (input) => invoke("shell:show-open-dialog", input),
			getPathForFile: (file) => bridge.getPathForFile(file),
		},
		auth: {
			getSession: () => invoke("auth:get-session"),
			refresh: () => invoke("auth:refresh"),
			login: () => invoke("auth:login"),
			logout: () => invoke("auth:logout"),
			onChanged: (listener) => bridge.on("auth:changed", listener),
		},
	};
}
