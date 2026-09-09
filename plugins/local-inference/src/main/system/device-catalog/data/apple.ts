export const APPLE_DB: Record<
	string,
	{ ram: number; bw: number; cpuCores: number; gpuCores: number }
> = {
	// Source: Apple Tech Specs / Newsroom
	// Criterio usado:
	// - aquí lo dejo en configuración "máxima" del chip dentro de una familia,
	//   para que la tabla sea consistente entre Pro/Max/Ultra.
	m6: { ram: 16, bw: 170, cpuCores: 12, gpuCores: 12 },
	"m5 ultra": { ram: 96, bw: 1200, cpuCores: 36, gpuCores: 80 },
	"m5 max": { ram: 36, bw: 614, cpuCores: 18, gpuCores: 40 }, // corregido
	"m5 pro": { ram: 24, bw: 307, cpuCores: 18, gpuCores: 20 }, // corregido
	m5: { ram: 16, bw: 153, cpuCores: 10, gpuCores: 10 }, // corregido bw
	"m4 max": { ram: 36, bw: 546, cpuCores: 16, gpuCores: 40 }, // corregido
	"m4 pro": { ram: 24, bw: 273, cpuCores: 14, gpuCores: 20 }, // corregido
	m4: { ram: 16, bw: 120, cpuCores: 10, gpuCores: 10 },
	"m3 ultra": { ram: 96, bw: 819, cpuCores: 32, gpuCores: 80 }, // corregido
	"m3 max": { ram: 36, bw: 400, cpuCores: 16, gpuCores: 40 }, // corregido
	"m3 pro": { ram: 18, bw: 150, cpuCores: 12, gpuCores: 18 }, // corregido
	m3: { ram: 8, bw: 100, cpuCores: 8, gpuCores: 10 },
	"m2 ultra": { ram: 64, bw: 800, cpuCores: 24, gpuCores: 76 }, // corregido
	"m2 max": { ram: 32, bw: 400, cpuCores: 12, gpuCores: 38 }, // corregido
	"m2 pro": { ram: 16, bw: 200, cpuCores: 12, gpuCores: 19 }, // corregido
	m2: { ram: 8, bw: 100, cpuCores: 8, gpuCores: 10 },
	"m1 ultra": { ram: 64, bw: 800, cpuCores: 20, gpuCores: 64 }, // corregido
	"m1 max": { ram: 32, bw: 400, cpuCores: 10, gpuCores: 32 }, // corregido
	"m1 pro": { ram: 16, bw: 200, cpuCores: 10, gpuCores: 16 }, // corregido
	m1: { ram: 8, bw: 68, cpuCores: 8, gpuCores: 8 }, // corregido a top bin
};
