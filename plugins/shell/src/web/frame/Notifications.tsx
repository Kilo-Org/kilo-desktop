import { useEffect } from "react";
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon, XIcon } from "lucide-react";

import { useDomainObject, useDomainObjectState, useKernel } from "@kilo-desktop/kernel/web";
import { Button } from "@kilo-desktop/ui/components/button";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { Notifications, type Notice, type NotificationContent } from "../../contracts";

type Action = NonNullable<NotificationContent["action"]>;

function useRunAction(): (action: Action) => void {
	const kernel = useKernel();
	return (action) => {
		void kernel.commands.execute(action.command, action.input).catch((error: unknown) => {
			kernel.kernelSdk.logger.error(`Command "${action.command}" failed`, error);
		});
	};
}

/** Shows the toasts main addresses to this window (`kilo.shell/notifications`' `toast` event). */
export function NotificationToasts() {
	const notifications = useDomainObject(Notifications);
	const windowId = useKernel().window.id;
	const run = useRunAction();
	// The domain object's `on` returns its unsubscribe, which the effect returns.
	// react-doctor-disable-next-line react-doctor/effect-needs-cleanup
	useEffect(() => {
		if (!notifications) return;
		return notifications.on("toast", ({ windowId: target, level, title, description, action }) => {
			if (target !== windowId) return;
			toast[level](title, {
				...(description ? { description } : {}),
				...(action ? { action: { label: action.label, onClick: () => run(action) } } : {}),
			});
		});
	}, [notifications, windowId, run]);
	return null;
}

const NOTICE_ICONS = {
	info: InfoIcon,
	success: CircleCheckIcon,
	warning: TriangleAlertIcon,
	error: CircleAlertIcon,
} as const;

const NOTICE_TONES = {
	info: "text-muted-foreground",
	success: "text-success",
	warning: "text-warning",
	error: "text-destructive",
} as const;

const EMPTY_NOTICES: Readonly<Record<string, Notice>> = {};
const selectNotices = (state: { notices: Readonly<Record<string, Notice>> }) => state.notices;

/**
 * Notices (`kilo.shell/notifications`' collection) at the foot of the left
 * sidebar, oldest first, above the sidebar notices plugins contribute: each
 * one stays in every window until someone dismisses it or acts on it.
 */
export function SidebarNotices() {
	const notifications = useDomainObject(Notifications);
	const notices = useDomainObjectState(Notifications, selectNotices) ?? EMPTY_NOTICES;
	const run = useRunAction();
	const list = Object.values(notices).toSorted((left, right) => left.createdAt - right.createdAt);
	if (!notifications || list.length === 0) return null;
	const dismiss = (id: string) => void notifications.methods.dismiss({ id }).catch(() => undefined);

	return list.map((notice) => {
		const Icon = NOTICE_ICONS[notice.level];
		return (
			<div
				key={notice.id}
				role="status"
				data-qa-id={`shell-notice-${notice.id}`}
				className="bg-sidebar-accent/60 flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs"
			>
				<Icon aria-hidden className={cn("mt-0.5 size-3.5 shrink-0", NOTICE_TONES[notice.level])} />
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<span className="font-medium">{notice.title}</span>
					{notice.description ? (
						<span className="text-muted-foreground">{notice.description}</span>
					) : null}
					{notice.action ? (
						<Button
							type="button"
							size="xs"
							variant="outline"
							className="self-start"
							data-qa-id={`shell-notice-action-${notice.id}`}
							onClick={() => {
								run(notice.action!);
								dismiss(notice.id);
							}}
						>
							{notice.action.label}
						</Button>
					) : null}
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label={`Dismiss ${notice.title}`}
					data-qa-id={`shell-notice-dismiss-${notice.id}`}
					onClick={() => dismiss(notice.id)}
				>
					<XIcon />
				</Button>
			</div>
		);
	});
}
