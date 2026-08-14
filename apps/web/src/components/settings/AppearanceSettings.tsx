import type { ReactNode } from "react";
import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react";

import { themeChromeColors, type ThemeSource } from "@anaconda-agentic-desktop/contracts";
import {
	FieldDescription,
	FieldLegend,
	FieldSet,
} from "@anaconda-agentic-desktop/ui/components/field";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { useColorScheme } from "@/platform/theme/ThemeProvider";

const THEME_OPTIONS = [
	{ value: "light", label: "Light", Icon: SunIcon },
	{ value: "dark", label: "Dark", Icon: MoonIcon },
	{ value: "system", label: "System", Icon: MonitorIcon },
] as const satisfies ReadonlyArray<{
	value: ThemeSource;
	label: string;
	Icon: LucideIcon;
}>;

/**
 * Shell-owned Appearance settings. Theme source is renderer-owned
 * (`ThemeProvider` / localStorage); this page is the user-facing control.
 */
export function AppearanceSettings() {
	const { source, setSource } = useColorScheme();

	return (
		<div className="mx-auto w-full max-w-2xl" data-qa-id="appearance-settings">
			<h1 className="text-xl font-semibold tracking-tight" data-qa-id="settings-section-heading">
				Appearance
			</h1>
			<FieldSet className="mt-6">
				<FieldLegend>Theme</FieldLegend>
				<FieldDescription>Light, dark, or match your system.</FieldDescription>
				<div
					role="radiogroup"
					aria-label="Theme"
					className="grid grid-cols-3 gap-3"
					data-qa-id="appearance-theme"
				>
					{THEME_OPTIONS.map((option) => (
						<ThemeChoice
							key={option.value}
							label={option.label}
							Icon={option.Icon}
							selected={source === option.value}
							preview={<ThemePreview source={option.value} />}
							onSelect={() => setSource(option.value)}
							qaId={`appearance-theme-${option.value}`}
						/>
					))}
				</div>
			</FieldSet>
		</div>
	);
}

function ThemeChoice({
	label,
	Icon,
	selected,
	preview,
	onSelect,
	qaId,
}: {
	label: string;
	Icon: LucideIcon;
	selected: boolean;
	preview: ReactNode;
	onSelect: () => void;
	qaId: string;
}) {
	return (
		<button
			type="button"
			role="radio"
			aria-checked={selected}
			onClick={onSelect}
			data-qa-id={qaId}
			className={cn(
				"flex flex-col gap-2 rounded-lg p-2 text-left outline-none transition-shadow",
				"focus-visible:ring-3 focus-visible:ring-ring/50",
				selected ? "bg-foreground/5 ring-2 ring-ring" : "ring-1 ring-border hover:bg-foreground/5",
			)}
		>
			{preview}
			<span className="flex items-center justify-center gap-1.5 pb-0.5 text-sm font-medium">
				<Icon className="size-3.5" />
				{label}
			</span>
		</button>
	);
}

function ThemePreview({ source }: { source: ThemeSource }) {
	switch (source) {
		case "system":
			return (
				<div className="relative overflow-hidden rounded-lg">
					<MiniWindow scheme="light" />
					<div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden">
						<div className="absolute inset-y-0 right-0 w-[200%]">
							<MiniWindow scheme="dark" />
						</div>
					</div>
				</div>
			);
		case "light":
			return <MiniWindow scheme="light" />;
		case "dark":
			return <MiniWindow scheme="dark" />;
		default: {
			const exhaustive: never = source;
			return exhaustive;
		}
	}
}

const WINDOW_PALETTE = {
	light: {
		bar: "#ffffff",
		sidebar: "#e6eaf0",
		line: "rgb(0 0 0 / 0.14)",
		muted: "rgb(0 0 0 / 0.08)",
		block: "rgb(0 0 0 / 0.05)",
		border: "border-black/10",
	},
	dark: {
		bar: "#1a1e28",
		sidebar: "#1c212c",
		line: "rgb(255 255 255 / 0.22)",
		muted: "rgb(255 255 255 / 0.1)",
		block: "rgb(255 255 255 / 0.06)",
		border: "border-white/10",
	},
} as const;

/**
 * Hardcoded chrome so Light/Dark previews stay true when the live app theme
 * changes. Window fill matches `themeChromeColors`.
 */
function MiniWindow({ scheme }: { scheme: "light" | "dark" }) {
	const chrome = themeChromeColors[scheme];
	const paint = WINDOW_PALETTE[scheme];
	return (
		<div
			className={cn("overflow-hidden rounded-lg border shadow-xs", paint.border)}
			style={{ background: chrome.background }}
		>
			<div className="flex h-3.5 items-center gap-1 px-2" style={{ background: paint.bar }}>
				<span className="size-1.5 rounded-full bg-[#ff5f57]" />
				<span className="size-1.5 rounded-full bg-[#febc2e]" />
				<span className="size-1.5 rounded-full bg-[#28c840]" />
			</div>
			<div className="flex h-20">
				<div className="w-[30%]" style={{ background: paint.sidebar }} />
				<div className="flex flex-1 flex-col gap-1.5 p-2.5">
					<div className="h-1.5 w-[72%] rounded-full" style={{ background: paint.line }} />
					<div className="h-1.5 w-[48%] rounded-full" style={{ background: paint.muted }} />
					<div className="mt-auto h-6 w-full rounded-md" style={{ background: paint.block }} />
				</div>
			</div>
		</div>
	);
}
