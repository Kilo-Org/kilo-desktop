import type { IpcHandlers } from "@anaconda-agentic-desktop/contracts";

import type { AuthSessionService } from "./auth-service.js";

export function createAuthHandlers(
	service: AuthSessionService,
): Pick<IpcHandlers, "auth:get-session" | "auth:refresh" | "auth:login" | "auth:logout"> {
	return {
		"auth:get-session": () => service.getSession(),
		"auth:refresh": () => service.refresh(),
		"auth:login": () => service.login(),
		"auth:logout": () => service.logout(),
	};
}
