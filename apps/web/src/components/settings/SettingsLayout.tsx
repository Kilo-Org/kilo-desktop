import type { ReactNode } from "react";
import { Outlet } from "@tanstack/react-router";

/**
 * Settings content pane. Section navigation lives in the app siderail
 * (`SettingsSidebar`) so settings takes over the rail instead of nesting a
 * second nav inside this page.
 */
export function SettingsLayout({ children }: { children?: ReactNode }) {
	return (
		<div className="flex min-h-0 flex-1 flex-col px-4 pt-4 pb-4" data-qa-id="settings-page">
			{children ?? <Outlet />}
		</div>
	);
}
