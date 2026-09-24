import type { ReactNode } from "react";
import { Outlet } from "@tanstack/react-router";

/**
 * Settings content pane. Section navigation lives in the app siderail
 * (`SettingsSidebar`) so settings takes over the rail instead of nesting a
 * second nav inside this page.
 */
export function SettingsLayout({ children }: { children?: ReactNode }) {
	return (
		<div className="bg-background flex min-h-0 min-w-0 flex-1 flex-col" data-qa-id="settings-page">
			<div className="flex min-h-0 flex-1 [scrollbar-gutter:stable] flex-col overflow-x-hidden overflow-y-auto p-6">
				{children ?? <Outlet />}
			</div>
		</div>
	);
}
