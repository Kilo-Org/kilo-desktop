import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react";

import {
	ACCENTS,
	APP_THEMES,
	getThemeVariant,
	themeChromeColors,
	type ThemeSource,
} from "@kilo-desktop/contracts";
import { SettingsPageHeader } from "@kilo-desktop/sdk-react";
import {
	FieldContent,
	FieldDescription,
	FieldLegend,
	FieldSet,
} from "@kilo-desktop/ui/components/field";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { RadioGroup } from "@kilo-desktop/ui/components/radio-group";
import { Switch } from "@kilo-desktop/ui/components/switch";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { ColorSwatchPicker } from "@kilo-desktop/ui/components/color-swatch-picker";
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
		<div className="flex min-w-0 flex-col gap-6">
			<SettingsPageHeader />
			<FieldSet
				className="min-w-0"
				aria-labelledby="appearance-theme-heading"
				data-qa-id="appearance-settings"
			>
				<FieldContent>
					<FieldLegend id="appearance-theme-heading" variant="label" className="mb-0">
						Theme
					</FieldLegend>
					<FieldDescription>Light, dark, or match your system.</FieldDescription>
				</FieldContent>
				<RadioGroup
					aria-label="Theme"
					value={source}
					onValueChange={(value) => setSource(value as ThemeSource)}
					className="grid grid-cols-3 gap-4"
					data-qa-id="appearance-theme"
				>
					{THEME_OPTIONS.map(({ value, label, Icon }) => (
						// The whole card is the radio: no indicator dot, the ring shows selection.
						<RadioPrimitive.Root
							key={value}
							value={value}
							data-qa-id={`appearance-theme-${value}`}
							className="ring-border hover:bg-muted focus-visible:ring-ring/50 data-checked:bg-muted data-checked:ring-ring flex cursor-default flex-col gap-2 rounded-lg p-2 text-left ring-1 transition-shadow outline-none focus-visible:ring-3 data-checked:ring-2"
						>
							<ThemePreview source={value} />
							<span className="flex items-center justify-center gap-1.5 pb-0.5 text-sm">
								<Icon aria-hidden="true" className="size-3.5" />
								{label}
							</span>
						</RadioPrimitive.Root>
					))}
				</RadioGroup>
				<section className="border-border bg-card divide-border min-w-0 divide-y overflow-hidden rounded-lg border">
					<div>
						<SummaryCard.Row>
							<SummaryCard.Content>
								<SummaryCard.Title>
									<label htmlFor="color-theme">Color theme</label>
								</SummaryCard.Title>
								<SummaryCard.Description>
									One palette for the app, terminal, and code.
								</SummaryCard.Description>
							</SummaryCard.Content>
							<SummaryCard.Actions>
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
										className="w-52"
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
							</SummaryCard.Actions>
						</SummaryCard.Row>
					</div>
					<div>
						<SummaryCard.Row>
							<SummaryCard.Content>
								<SummaryCard.Title id="accent-label">Accent color</SummaryCard.Title>
								<SummaryCard.Description>
									Use the theme's accent or choose your own.
								</SummaryCard.Description>
							</SummaryCard.Content>
							<SummaryCard.Actions>
								<ColorSwatchPicker
									aria-labelledby="accent-label"
									value={appTheme.accentId}
									onValueChange={(accentId) => setAppTheme({ ...appTheme, accentId })}
									swatches={ACCENTS.map((accent) => ({
										value: accent.id,
										label: accent.name,
										...(accent.id === "theme" ? {} : { color: accent[resolved].color }),
										qaId: `appearance-accent-${accent.id}`,
									}))}
								/>
							</SummaryCard.Actions>
						</SummaryCard.Row>
					</div>
					<div>
						<SummaryCard.Row>
							<SummaryCard.Content>
								<SummaryCard.Title>
									<label htmlFor="sidebar-vibrancy">Sidebar vibrancy</label>
								</SummaryCard.Title>
								<SummaryCard.Description>
									Show a translucent sidebar background.
								</SummaryCard.Description>
							</SummaryCard.Content>
							<SummaryCard.Actions>
								<Switch
									id="sidebar-vibrancy"
									data-qa-id="appearance-sidebar-vibrancy"
									checked={sidebarVibrancy}
									onCheckedChange={setSidebarVibrancy}
								/>
							</SummaryCard.Actions>
						</SummaryCard.Row>
					</div>
				</section>
			</FieldSet>
		</div>
	);
}

function ThemeSwatch({ themeId, scheme }: { themeId: string; scheme: "light" | "dark" }) {
	const tokens = getThemeVariant(themeId, scheme)?.tokens;
	return (
		<span
			aria-hidden="true"
			className="text-2xs inline-flex size-4 shrink-0 items-center justify-center self-center rounded-sm border leading-none font-medium"
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
