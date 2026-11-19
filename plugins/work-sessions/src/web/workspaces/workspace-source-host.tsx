import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { MotionConfig, motion } from "motion/react";

import { KernelDialogs, type Contribution } from "@kilo-desktop/kernel";
import {
	RenderContribution,
	useContextKey,
	useDomainObject,
	useExtensions,
} from "@kilo-desktop/kernel/web";

import {
	Workspaces,
	WorkspaceSource,
	type Workspace,
	type WorkspaceSourceImplementation,
	type WorkspaceSourceProps,
	type WorkspaceSourceView,
} from "../../contracts";
import {
	NewFolderContext,
	type NewFolderServices,
	type WorkspaceDraft,
} from "./new-folder-context";
import { NewFolderForm } from "./NewFolderForm";
import { ChoicesLine, type Choice } from "./ChoicesLine";

export type SourceContribution = Contribution<typeof WorkspaceSource>;

export const LOCAL_FOLDER_SOURCE = "kilo.work-sessions/local-folder";

const selectIcon = (implementation: WorkspaceSourceImplementation) => implementation.icon;
const selectComponent = (implementation: WorkspaceSourceImplementation) => implementation.Component;

/**
 * The implemented workspace sources, highest priority first, each prepared
 * once while the host is mounted (a source contributed meanwhile is prepared
 * when it appears).
 */
export function useWorkspaceSources(): SourceContribution[] {
	const sources = useExtensions(WorkspaceSource).filter((source) => source.implementation);
	const prepared = useRef(new Set<string>());
	useEffect(() => {
		for (const source of sources) {
			if (prepared.current.has(source.key)) continue;
			prepared.current.add(source.key);
			try {
				source.implementation?.prepare?.();
			} catch {
				// Warming is best effort; the source's own screens report failures.
			}
		}
	}, [sources]);
	return sources;
}

/** The default location for a new folder, asked of main once per host. */
function useDefaultLocation(): string | null {
	const workspaces = useDomainObject(Workspaces);
	const [location, setLocation] = useState<string | null>(null);
	useEffect(() => {
		let current = true;
		workspaces?.methods
			.newFolderLocation(undefined)
			.then(({ path }) => current && setLocation(path))
			.catch(() => undefined);
		return () => {
			current = false;
		};
	}, [workspaces]);
	return location;
}

/** The folder picking a host lends its forms, resolved under kilo.work-sessions. */
export function useFolderLocationServices(): Pick<
	NewFolderServices,
	"defaultLocation" | "canPickDirectories" | "pickLocation"
> {
	const dialogs = useDomainObject(KernelDialogs);
	const desktop = useContextKey("kernel/desktop");
	return {
		defaultLocation: useDefaultLocation(),
		canPickDirectories: desktop && dialogs !== null,
		pickLocation: async (current) => {
			if (!dialogs) return null;
			const { paths } = await dialogs.methods.open({
				directory: true,
				multiple: false,
				...(current ? { defaultPath: current } : {}),
			});
			return paths[0] ?? null;
		},
	};
}

/** Makes a created workspace active, then moves the host on. */
export function useActivateCreated(then: (workspace: Workspace) => void) {
	const workspaces = useDomainObject(Workspaces);
	return (workspace: Workspace) => {
		void workspaces?.methods
			.setActive({ id: workspace.id })
			.catch(() => undefined)
			.finally(() => then(workspace));
	};
}

/** A screen's body inside a form, so Enter in a field runs the screen's action. */
export function SourceForm({
	view,
	className,
	children,
}: {
	view: WorkspaceSourceView;
	className?: string;
	children: ReactNode;
}) {
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (view.primary && !view.primary.disabled && !view.busy) view.primary.onClick();
	};
	return (
		<form onSubmit={submit} className={className} noValidate>
			{children}
		</form>
	);
}

/** What a host's frame shows around the current screen: the parts outside its body. */
export interface ScreenState {
	readonly description: string | null;
	readonly primary: { readonly label: string; readonly disabled: boolean } | null;
	readonly busy: boolean;
}

/**
 * The host's side of a source's screens: the frame parts outside the body
 * (reported by the screen after it renders) and the primary action, which
 * runs the current screen's latest `onClick`.
 */
export function useScreenState() {
	const [screen, setScreen] = useState<ScreenState | null>(null);
	const action = useRef<(() => void) | null>(null);
	return {
		screen,
		reset: () => setScreen(null),
		primary: screen?.primary ? { ...screen.primary, onClick: () => action.current?.() } : null,
		report: {
			onScreen: setScreen,
			onAction: (run: (() => void) | null) => {
				action.current = run;
			},
		},
	};
}

type ScreenReport = ReturnType<typeof useScreenState>["report"];

/** Hands the host a screen's frame parts once it has rendered, and only when they change. */
function ReportScreen({ view, report }: { view: WorkspaceSourceView; report: ScreenReport }) {
	const description = view.description ?? null;
	const label = view.primary?.label ?? null;
	const disabled = view.primary?.disabled === true;
	const busy = view.busy === true;
	const { onScreen, onAction } = report;
	useEffect(() => {
		onScreen({
			description,
			primary: label === null ? null : { label, disabled },
			busy,
		});
	}, [onScreen, description, label, disabled, busy]);
	const run = view.primary?.onClick ?? null;
	useEffect(() => {
		onAction(run);
	});
	return null;
}

const EASE = [0.16, 1, 0.3, 1] as const;

/** A screen arriving: it fades and lifts in as it mounts. */
export function ScreenEntrance({ children }: { children: ReactNode }) {
	return (
		<motion.div
			initial={{ opacity: 0, y: 6 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.22, ease: EASE }}
		>
			{children}
		</motion.div>
	);
}

/** The rendered height of `element`, following it as it resizes. */
function useMeasuredHeight(element: HTMLElement | null): number | null {
	const [height, setHeight] = useState<number | null>(null);
	useEffect(() => {
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => {
			if (entry) setHeight(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [element]);
	return height;
}

/**
 * Where a host shows its screens. It stays mounted as screens change and
 * eases its height to each one's, so a frame that centres its content (the
 * onboarding card) or grows with it (a dialog) glides instead of jumping.
 */
export function ScreensViewport({ children }: { children: ReactNode }) {
	const [inner, setInner] = useState<HTMLDivElement | null>(null);
	const height = useMeasuredHeight(inner);
	return (
		// Snaps under reduced motion; the New workspace dialog has no MotionConfig of its own.
		<MotionConfig reducedMotion="user">
			<motion.div
				// The padding keeps focus rings inside the clip while the height eases.
				className="-m-1 overflow-hidden p-1"
				initial={false}
				// The frame around it must reflow to the new height (a transform would only
				// scale the content), and it is one short ease per screen change.
				// react-doctor-disable-next-line react-doctor/no-layout-property-animation
				animate={{ height: height === null ? "auto" : height + 8 }}
				transition={{ duration: 0.25, ease: EASE }}
			>
				<div ref={setInner}>{children}</div>
			</motion.div>
		</MotionConfig>
	);
}

/**
 * The chosen source's screens, drawn where the host puts them (inside its
 * frame's body, so the frame never remounts): each under the line of choices
 * made so far, whose first returns to the list of sources. The rest of the
 * frame (description, primary action, busy) is reported to the host.
 */
export function SourceScreens({
	source,
	services,
	report,
	onChangeSource,
}: {
	source: SourceContribution;
	services: Omit<NewFolderServices, "present">;
	report: ScreenReport;
	onChangeSource: () => void;
}) {
	const present = (view: WorkspaceSourceView) => {
		const choices: Choice[] = [
			{
				label: source.metadata.title,
				icon: <SourceIcon source={source} className="size-3.5" />,
				changeLabel: "Change how to start",
				onChange: onChangeSource,
				qaId: "workspace-source-chosen",
			},
		];
		if (view.choice) {
			const { icon: Icon, ...choice } = view.choice;
			choices.push({ ...choice, ...(Icon ? { icon: <Icon className="size-3.5" /> } : {}) });
		}
		return (
			<>
				<ReportScreen view={view} report={report} />
				{/* While the action runs (a clone), every field and choice is locked. */}
				<fieldset
					disabled={view.busy === true}
					className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0"
				>
					<ChoicesLine choices={choices} appearance={services.appearance} />
					{/* Another screen is another component calling present, so it mounts and enters afresh. */}
					<ScreenEntrance>
						<SourceForm view={view} className="flex flex-col gap-6">
							{view.body}
						</SourceForm>
					</ScreenEntrance>
				</fieldset>
			</>
		);
	};
	return (
		<NewFolderContext value={{ ...services, present }}>
			<RenderContribution<WorkspaceSourceProps>
				contribution={source}
				props={{
					onCreated: services.onCreated,
					NewFolderForm,
					appearance: services.appearance,
					children: present,
				}}
				select={selectComponent}
			/>
		</NewFolderContext>
	);
}

export function SourceIcon({
	source,
	className,
}: {
	source: SourceContribution;
	className: string;
}) {
	return (
		<RenderContribution<{ className?: string }>
			contribution={source}
			props={{ className }}
			select={selectIcon}
		/>
	);
}

/** Reports a form's values to the host's preview whenever they change. */
export function useReportDraft(
	onDraft: ((draft: WorkspaceDraft) => void) | undefined,
	draft: WorkspaceDraft,
): void {
	const key = JSON.stringify(draft);
	useEffect(() => {
		onDraft?.(JSON.parse(key) as WorkspaceDraft);
	}, [onDraft, key]);
}
