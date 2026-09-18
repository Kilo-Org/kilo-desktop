import type { ReactNode } from "react";
import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react";

import {
	ACCENTS,
	APP_THEMES,
	getThemeVariant,
	themeChromeColors,
	type ThemeSource,
} from "@kilo-desktop/contracts";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from "@kilo-desktop/ui/components/field";
import { Switch } from "@kilo-desktop/ui/components/switch";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { ToggleGroup, ToggleGroupItem } from "@kilo-desktop/ui/components/toggle-group";
import { cn } from "@kilo-desktop/ui/lib/utils";

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
	const {
		source,
		resolved,
		setSource,
		sidebarVibrancy,
		setSidebarVibrancy,
		appTheme,
		setAppTheme,
	} = useColorScheme();

	return (
		<div className="mx-auto w-full max-w-3xl" data-qa-id="appearance-settings">
			<h1 className="text-base font-semibold tracking-tight" data-qa-id="settings-section-heading">
				Appearance
			</h1>
			<FieldGroup className="gap-0">
				<FieldSet className="mt-6 gap-0">
					<FieldLegend variant="label" className="mb-0">
						Theme
					</FieldLegend>
					<FieldDescription>Light, dark, or match your system.</FieldDescription>
					<div
						role="radiogroup"
						aria-label="Theme"
						className="mt-4 grid grid-cols-3 gap-3"
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
				<Field orientation="responsive" className="mt-8">
					<FieldContent>
						<FieldLabel htmlFor="color-theme">Color theme</FieldLabel>
						<FieldDescription>
							{appTheme.themeId === "kilo"
								? "Kilo dark colors with an unofficial light companion."
								: "One palette for the app, terminal, and code."}
						</FieldDescription>
					</FieldContent>
					<Select
						value={appTheme.themeId}
						items={APP_THEMES.map((theme) => ({ value: theme.id, label: theme.name }))}
						onValueChange={(themeId) => {
							if (themeId) setAppTheme({ ...appTheme, themeId });
						}}
					>
						<SelectTrigger
							id="color-theme"
							aria-label="Color theme"
							className="w-full min-w-52 sm:w-52"
							data-qa-id="appearance-color-theme"
						>
							<ThemeSwatch themeId={appTheme.themeId} scheme={resolved} />
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{APP_THEMES.map((theme) => (
									<SelectItem
										key={theme.id}
										value={theme.id}
										data-qa-id={`appearance-color-theme-${theme.id}`}
									>
										<ThemeSwatch themeId={theme.id} scheme={resolved} />
										{theme.name}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</Field>
				<Field orientation="responsive" className="mt-6">
					<FieldContent>
						<FieldTitle id="accent-label">Accent color</FieldTitle>
						<FieldDescription>Use the theme's accent or choose your own.</FieldDescription>
					</FieldContent>
					<ToggleGroup
						aria-labelledby="accent-label"
						value={[appTheme.accentId]}
						onValueChange={([accentId]) => {
							if (accentId) setAppTheme({ ...appTheme, accentId });
						}}
						className="flex-wrap"
					>
						{ACCENTS.map((accent) => (
							<ToggleGroupItem
								key={accent.id}
								value={accent.id}
								aria-label={accent.name}
								title={accent.name}
								data-qa-id={`appearance-accent-${accent.id}`}
							>
								{accent.id === "theme" ? (
									accent.name
								) : (
									<span
										aria-hidden="true"
										className="border-foreground/10 size-4 rounded-full border"
										style={{ backgroundColor: accent[resolved].color }}
									/>
								)}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</Field>
				<Field orientation="horizontal" className="mt-8">
					<FieldContent>
						<FieldLabel htmlFor="sidebar-vibrancy">Sidebar vibrancy</FieldLabel>
						<FieldDescription>Show a translucent sidebar background.</FieldDescription>
					</FieldContent>
					<Switch
						id="sidebar-vibrancy"
						data-qa-id="appearance-sidebar-vibrancy"
						checked={sidebarVibrancy}
						onCheckedChange={setSidebarVibrancy}
					/>
				</Field>
			</FieldGroup>
		</div>
	);
}

function ThemeSwatch({ themeId, scheme }: { themeId: string; scheme: "light" | "dark" }) {
	const tokens = getThemeVariant(themeId, scheme)?.tokens;
	return (
		<span
			aria-hidden="true"
			className="inline-flex size-4 shrink-0 items-center justify-center self-center rounded-sm border text-[10px] leading-none font-medium"
			style={{
				background: tokens?.background ?? themeChromeColors[scheme].background,
				color: tokens?.primary ?? ACCENTS[0][scheme].color,
				borderColor: tokens?.border ?? "var(--border)",
			}}
		>
			Aa
		</span>
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
			<span className="flex items-center justify-center gap-1.5 pb-0.5 text-sm font-normal">
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
		sidebar: "var(--color-mist-50)",
		line: "rgb(0 0 0 / 0.14)",
		muted: "rgb(0 0 0 / 0.08)",
		block: "rgb(0 0 0 / 0.05)",
		border: "border-black/10",
	},
	dark: {
		bar: themeChromeColors.dark.background,
		sidebar: "var(--color-mist-900)",
		line: "rgb(255 255 255 / 0.22)",
		muted: "rgb(255 255 255 / 0.1)",
		block: "rgb(255 255 255 / 0.06)",
		border: "border-white/10",
	},
} as const;

function MiniWindow({ scheme }: { scheme: "light" | "dark" }) {
	const { appTheme } = useColorScheme();
	const tokens = getThemeVariant(appTheme.themeId, scheme)?.tokens;
	const chrome = tokens ?? themeChromeColors[scheme];
	const paint = WINDOW_PALETTE[scheme];
	return (
		<div
			className={cn("overflow-hidden rounded-lg border shadow-xs", paint.border)}
			style={{ background: chrome.background }}
		>
			<div
				className="flex h-3.5 items-center gap-1 px-2"
				style={{ background: tokens?.card ?? paint.bar }}
			>
				<span className="size-1.5 rounded-full bg-[#ff5f57]" />
				<span className="size-1.5 rounded-full bg-[#febc2e]" />
				<span className="size-1.5 rounded-full bg-[#28c840]" />
			</div>
			<div className="flex h-20">
				<div className="w-[30%]" style={{ background: tokens?.sidebar ?? paint.sidebar }} />
				<div className="flex flex-1 flex-col gap-1.5 p-2.5">
					<div className="h-1.5 w-[72%] rounded-full" style={{ background: paint.line }} />
					<div className="h-1.5 w-[48%] rounded-full" style={{ background: paint.muted }} />
					<div className="mt-auto h-6 w-full rounded-md" style={{ background: paint.block }} />
				</div>
			</div>
		</div>
	);
}
