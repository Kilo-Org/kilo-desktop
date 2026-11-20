import { FolderIcon, FolderPlusIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@kilo-desktop/ui/lib/utils";

import { DEFAULT_WORKSPACE_IDENTITY_COLOR } from "../../../contracts";
import { KiloLogo } from "@kilo-desktop/ui/components/brand/kilo-logo";
import type { WorkspaceDraft } from "../new-folder-context";
import { FLOW, workspaceFlow } from "./workspace-flow";

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const tint = (color: string, percent: number) =>
	`color-mix(in oklab, ${color} ${percent}%, transparent)`;

/**
 * The workspace as a concept rather than a UI copy: the chosen folders wire
 * into a tile in the workspace's identity colour, which wires into Kilo. Every
 * value is live from the chosen source's form; with no folders the wiring is dashed and a
 * single "Add a folder" stand-in waits on the left.
 */
export function WorkspacePreview({ draft }: { draft: WorkspaceDraft | null }) {
	const color = draft?.color || DEFAULT_WORKSPACE_IDENTITY_COLOR;
	const folders = (draft?.folders ?? []).map(folderName);
	const name = draft?.name.trim() || folders[0] || "My workspace";
	const { pills, pending } = workspaceFlow(folders);
	const tileY = (FLOW.height - FLOW.tileHeight) / 2;

	return (
		<div className="flex flex-col items-center gap-8 select-none">
			<div className="relative shrink-0" style={{ width: FLOW.width, height: FLOW.height }}>
				<svg
					data-qa-id="onboarding-workspace-wires"
					className="text-foreground absolute inset-0"
					width={FLOW.width}
					height={FLOW.height}
					viewBox={`0 0 ${FLOW.width} ${FLOW.height}`}
					fill="none"
				>
					<AnimatePresence initial={false}>
						{pills.map((pill) => (
							<motion.path
								key={pill.key}
								d={pill.connector}
								stroke="currentColor"
								strokeOpacity="0.18"
								strokeWidth="1.25"
								strokeDasharray={pending ? "3 4" : undefined}
								// pathLength drives the dash array, so the dashed (pending) wire only fades.
								initial={pending ? { opacity: 0 } : { pathLength: 0, opacity: 0 }}
								animate={
									pending ? { opacity: 1 } : { pathLength: 1, opacity: 1, d: pill.connector }
								}
								exit={{ opacity: 0 }}
								transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
							/>
						))}
					</AnimatePresence>
					<path
						d={`M ${FLOW.tileX + FLOW.tileWidth} ${FLOW.height / 2} L ${FLOW.kiloX} ${FLOW.height / 2}`}
						stroke="currentColor"
						strokeOpacity="0.18"
						strokeWidth="1.25"
						strokeDasharray={pending ? "3 4" : undefined}
					/>
				</svg>

				<AnimatePresence initial={false}>
					{pills.map((pill) => (
						<motion.div
							key={pill.key}
							className={cn(
								"bg-foreground/5 absolute top-0 left-0 flex items-center gap-2 rounded-full px-3.5 text-xs",
								pill.placeholder ? "text-muted-foreground" : "text-foreground/80",
							)}
							style={{ width: FLOW.pillWidth, height: FLOW.pillHeight }}
							initial={{ opacity: 0, x: -8, y: pill.y }}
							animate={{ opacity: 1, x: 0, y: pill.y }}
							exit={{ opacity: 0, x: -8 }}
							transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
						>
							{pending ? (
								<FolderPlusIcon className="size-3.5 shrink-0" />
							) : (
								<FolderIcon
									className="size-3.5 shrink-0"
									color={pill.placeholder ? undefined : color}
								/>
							)}
							<span className="truncate">{pill.label}</span>
						</motion.div>
					))}
				</AnimatePresence>

				<motion.div
					className="absolute flex flex-col items-center justify-center gap-2.5 rounded-3xl px-2"
					style={{ left: FLOW.tileX, top: tileY, width: FLOW.tileWidth, height: FLOW.tileHeight }}
					animate={{ backgroundColor: tint(color, 14) }}
					transition={{ duration: 0.3 }}
				>
					<motion.span
						className="grid size-10 place-items-center rounded-xl"
						animate={{ backgroundColor: tint(color, 24) }}
						transition={{ duration: 0.3 }}
					>
						<FolderIcon className="size-5" color={color} />
					</motion.span>
					<span className="w-full truncate text-center text-xs font-medium">{name}</span>
				</motion.div>

				<span
					data-qa-id="onboarding-workspace-kilo"
					className="bg-foreground/5 text-foreground/80 absolute flex items-center gap-2 rounded-full px-3.5 text-xs"
					style={{
						left: FLOW.kiloX,
						top: (FLOW.height - FLOW.pillHeight) / 2,
						width: FLOW.pillWidth,
						height: FLOW.pillHeight,
					}}
				>
					<span className="text-foreground size-3.5 shrink-0">
						<KiloLogo />
					</span>
					Kilo
				</span>
			</div>
			<p className="text-muted-foreground text-center text-xs">
				Kilo reads and edits only the folders in this workspace.
			</p>
		</div>
	);
}
