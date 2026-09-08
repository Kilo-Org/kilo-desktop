// Device specifications synchronized with canirun.ai commit db81865.
// Keep the four catalogs complete so local estimates cover every CanIRun preset.

export const GPU_DB: Record<string, { vram: number; bw: number; cores: number }> = {
	// NVIDIA GeForce desktop
	// Source: NVIDIA official GeForce product pages / compare pages
	"RTX 5090": { vram: 32, bw: 1792, cores: 21760 },
	"RTX 5080": { vram: 16, bw: 960, cores: 10752 },
	"RTX 5070 Ti": { vram: 16, bw: 896, cores: 8960 },
	"RTX 5070": { vram: 12, bw: 672, cores: 6144 },
	"RTX 5060 Ti 16GB": { vram: 16, bw: 448, cores: 4608 },
	"RTX 5060 Ti": { vram: 8, bw: 448, cores: 4608 },
	"RTX 5060": { vram: 8, bw: 448, cores: 3840 },
	"RTX 5050": { vram: 8, bw: 320, cores: 2560 },
	"RTX 4090": { vram: 24, bw: 1008, cores: 16384 },
	"RTX 4080 SUPER": { vram: 16, bw: 736, cores: 10240 },
	"RTX 4080": { vram: 16, bw: 717, cores: 9728 },
	"RTX 4070 Ti SUPER": { vram: 16, bw: 672, cores: 8448 },
	"RTX 4070 Ti": { vram: 12, bw: 504, cores: 7680 },
	"RTX 4070 SUPER": { vram: 12, bw: 504, cores: 7168 },
	"RTX 4070": { vram: 12, bw: 504, cores: 5888 },
	"RTX 4060 Ti 16GB": { vram: 16, bw: 288, cores: 4352 },
	"RTX 4060 Ti": { vram: 8, bw: 288, cores: 4352 },
	"RTX 4060": { vram: 8, bw: 272, cores: 3072 },
	"RTX 3090 Ti": { vram: 24, bw: 1008, cores: 10752 },
	"RTX 3090": { vram: 24, bw: 936, cores: 10496 },
	"RTX 3080 Ti": { vram: 12, bw: 912, cores: 10240 },
	"RTX 3080 12GB": { vram: 12, bw: 912, cores: 8960 },
	"RTX 3080": { vram: 10, bw: 760, cores: 8704 },
	"RTX 3070 Ti": { vram: 8, bw: 608, cores: 6144 },
	"RTX 3070": { vram: 8, bw: 448, cores: 5888 },
	"RTX 3060 Ti": { vram: 8, bw: 448, cores: 4864 },
	"RTX 3060": { vram: 12, bw: 360, cores: 3584 },
	"RTX 3050": { vram: 8, bw: 224, cores: 2560 },

	// NVIDIA Laptop GPUs — RTX 50 series
	// Source: NVIDIA GeForce RTX 50 Laptop compare page
	"RTX 5090 Laptop": { vram: 24, bw: 896, cores: 10496 },
	"RTX 5080 Laptop": { vram: 16, bw: 896, cores: 7680 },
	"RTX 5070 Ti Laptop": { vram: 12, bw: 672, cores: 5888 }, // corregido
	"RTX 5070 Laptop": { vram: 8, bw: 384, cores: 4608 }, // corregido
	"RTX 5060 Laptop": { vram: 8, bw: 384, cores: 3328 },
	"RTX 5050 Laptop": { vram: 8, bw: 384, cores: 2560 },

	// NVIDIA Laptop GPUs — RTX 40 series
	// Source: NVIDIA GeForce RTX laptop compare page
	"RTX 4090 Laptop": { vram: 16, bw: 576, cores: 9728 },
	"RTX 4080 Laptop": { vram: 12, bw: 432, cores: 7424 },
	"RTX 4070 Laptop": { vram: 8, bw: 256, cores: 4608 },
	"RTX 4060 Laptop": { vram: 8, bw: 256, cores: 3072 },
	"RTX 4050 Laptop": { vram: 6, bw: 192, cores: 2560 },

	// NVIDIA Laptop GPUs — RTX 30 series
	// Source: NVIDIA laptop compare page / official launch material
	"RTX 3080 Ti Laptop": { vram: 16, bw: 512, cores: 7424 },
	"RTX 3080 Laptop": { vram: 16, bw: 448, cores: 6144 },
	"RTX 3070 Ti Laptop": { vram: 8, bw: 448, cores: 5888 },
	"RTX 3070 Laptop": { vram: 8, bw: 448, cores: 5120 },
	"RTX 3060 Laptop": { vram: 6, bw: 336, cores: 3840 },
	"RTX 3050 Ti Laptop": { vram: 4, bw: 192, cores: 2560 },
	"RTX 3050 Laptop": { vram: 4, bw: 192, cores: 2048 },

	// NVIDIA workstation / pro desktop
	// Source: NVIDIA professional desktop product pages / line cards
	"RTX PRO 6000": { vram: 96, bw: 1792, cores: 24064 },
	"RTX 6000 Ada": { vram: 48, bw: 960, cores: 18176 },
	"RTX 5880 Ada": { vram: 48, bw: 960, cores: 14080 },
	"RTX 5000 Ada": { vram: 32, bw: 800, cores: 12800 },
	"RTX 4500 Ada": { vram: 24, bw: 432, cores: 7680 },
	"RTX 4000 SFF Ada": { vram: 20, bw: 320, cores: 6144 }, // corregido
	"RTX 4000 Ada": { vram: 20, bw: 360, cores: 6144 },
	"RTX 3500 Ada": { vram: 12, bw: 432, cores: 5120 }, // corregido a variante laptop/pro usada en line card
	"RTX 2000 Ada": { vram: 16, bw: 224, cores: 2816 },
	"RTX A6000": { vram: 48, bw: 768, cores: 10752 },
	"RTX A5500": { vram: 24, bw: 768, cores: 10240 },
	"RTX A5000": { vram: 24, bw: 768, cores: 8192 },
	"RTX A4500": { vram: 20, bw: 640, cores: 7168 },
	"RTX A4000": { vram: 16, bw: 448, cores: 6144 },
	"RTX A2000": { vram: 6, bw: 288, cores: 3328 },

	// RTX 20 series
	// Source: NVIDIA official GeForce specs
	"RTX 2080 Ti": { vram: 11, bw: 616, cores: 4352 },
	"RTX 2080 SUPER": { vram: 8, bw: 496, cores: 3072 },
	"RTX 2080": { vram: 8, bw: 448, cores: 2944 },
	"RTX 2070 SUPER": { vram: 8, bw: 448, cores: 2560 },
	"RTX 2070": { vram: 8, bw: 448, cores: 2304 },
	"RTX 2060 SUPER": { vram: 8, bw: 448, cores: 2176 },
	"RTX 2060": { vram: 6, bw: 336, cores: 1920 },

	// Variantes útiles
	// Source: NVIDIA official GeForce specs
	"RTX 2060 12GB": { vram: 12, bw: 336, cores: 2176 },
	"RTX 3050 6GB": { vram: 6, bw: 168, cores: 2304 },

	// Data center / AI / inference
	// Source: NVIDIA official product pages / docs
	B200: { vram: 192, bw: 8000, cores: 20480 },
	H200: { vram: 141, bw: 4800, cores: 16896 },
	A100: { vram: 80, bw: 2039, cores: 6912 },
	"A100 40GB": { vram: 40, bw: 1555, cores: 6912 },
	H100: { vram: 80, bw: 3350, cores: 14592 },
	// Blackwell Ultra: up to 160 SMs × 128 CUDA cores
	"GB300-WS": { vram: 252, bw: 7100, cores: 20480 },
	GB300: { vram: 288, bw: 8000, cores: 20480 },
	GH200: { vram: 96, bw: 4000, cores: 16896 },
	"DGX Spark": { vram: 128, bw: 273, cores: 6144 },
	L40S: { vram: 48, bw: 864, cores: 18176 },
	L20: { vram: 48, bw: 864, cores: 11776 },
	L4: { vram: 24, bw: 300, cores: 7424 },
	A10: { vram: 24, bw: 600, cores: 9216 },
	A10G: { vram: 24, bw: 600, cores: 9216 },
	T4: { vram: 16, bw: 300, cores: 2560 },
	"Tesla P40": { vram: 24, bw: 346, cores: 3840 },
	"Tesla V100 32GB": { vram: 32, bw: 900, cores: 5120 },
	"Tesla V100": { vram: 16, bw: 900, cores: 5120 },

	// AMD desktop
	// Source: AMD official product specs
	"RX 7900 XTX": { vram: 24, bw: 960, cores: 6144 },
	"RX 7900 XT": { vram: 20, bw: 800, cores: 5376 },
	"RX 7800 XT": { vram: 16, bw: 624, cores: 3840 },
	"RX 7700 XT": { vram: 12, bw: 432, cores: 3456 },
	"RX 7600 XT": { vram: 16, bw: 288, cores: 2048 },
	"RX 7600": { vram: 8, bw: 288, cores: 2048 },
	"RX 6900 XT": { vram: 16, bw: 512, cores: 5120 },
	"RX 6800 XT": { vram: 16, bw: 512, cores: 4608 },
	"RX 6800": { vram: 16, bw: 512, cores: 3840 },
	"RX 6750 XT": { vram: 12, bw: 432, cores: 2560 },
	"RX 6700 XT": { vram: 12, bw: 384, cores: 2560 },
	"RX 6650 XT": { vram: 8, bw: 280, cores: 2048 },
	"RX 6600 XT": { vram: 8, bw: 256, cores: 2048 },
	"RX 6600": { vram: 8, bw: 224, cores: 1792 },
	"RX 6500 XT": { vram: 4, bw: 144, cores: 1024 },

	// Intel Arc desktop
	// Source: Intel official product specs
	"Arc A770": { vram: 16, bw: 560, cores: 4096 },
	"Arc A750": { vram: 8, bw: 512, cores: 3584 },
	"Arc A580": { vram: 8, bw: 512, cores: 3072 },
	"Arc A380": { vram: 6, bw: 186, cores: 1024 },
	"Arc Pro B70": { vram: 32, bw: 608, cores: 4096 }, // 32 Xe2-cores × 128, GDDR6 256-bit
	"Arc Pro B60": { vram: 24, bw: 456, cores: 2560 }, // 20 Xe2-cores × 128, GDDR6 192-bit

	// GTX 16 series
	// Source: NVIDIA official GeForce compare/specs
	"GTX 1660 Ti": { vram: 6, bw: 288, cores: 1536 },
	"GTX 1660 SUPER": { vram: 6, bw: 336, cores: 1408 },
	"GTX 1660": { vram: 6, bw: 192, cores: 1408 },
	"GTX 1650 SUPER": { vram: 4, bw: 192, cores: 1280 },
	"GTX 1650 Ti": { vram: 4, bw: 192, cores: 1024 },
	"GTX 1650": { vram: 4, bw: 128, cores: 896 },
	"GTX 1630": { vram: 4, bw: 96, cores: 512 },

	// GTX 10 series
	// Source: NVIDIA official GeForce compare/specs
	"GTX 1080 Ti": { vram: 11, bw: 484, cores: 3584 },
	"GTX 1080": { vram: 8, bw: 320, cores: 2560 },
	"GTX 1070 Ti": { vram: 8, bw: 256, cores: 2432 },
	"GTX 1070": { vram: 8, bw: 256, cores: 1920 },
	"GTX 1060 6GB": { vram: 6, bw: 192, cores: 1280 },
	"GTX 1060 3GB": { vram: 3, bw: 192, cores: 1152 },
	"GTX 1060": { vram: 6, bw: 192, cores: 1280 },
	"GTX 1050 Ti": { vram: 4, bw: 112, cores: 768 },
	"GTX 1050": { vram: 2, bw: 112, cores: 640 },

	// GTX 9 series
	// Source: NVIDIA official GeForce compare/specs
	"GTX 980 Ti": { vram: 6, bw: 336, cores: 2816 },
	"GTX 980": { vram: 4, bw: 224, cores: 2048 },
	"GTX 970": { vram: 4, bw: 224, cores: 1664 },
	"GTX 960": { vram: 2, bw: 112, cores: 1024 },
	"GTX 950": { vram: 2, bw: 105, cores: 768 },

	// NVIDIA Quadro / professional (Turing / T-series mobile-first naming in this block)
	// Source: NVIDIA mobile workstation line cards + professional line cards
	"Quadro RTX 8000": { vram: 48, bw: 672, cores: 4608 },
	"Quadro RTX 6000": { vram: 24, bw: 672, cores: 4608 },
	"Quadro RTX 5000": { vram: 16, bw: 448, cores: 3072 },
	"Quadro RTX 4000": { vram: 8, bw: 416, cores: 2304 },
	"Quadro RTX 3000": { vram: 6, bw: 336, cores: 1920 },
	"Quadro T2000": { vram: 4, bw: 128, cores: 1024 },
	"Quadro T1000": { vram: 4, bw: 128, cores: 896 }, // corregido
	T1200: { vram: 4, bw: 192, cores: 1024 }, // corregido
	"NVIDIA T600": { vram: 4, bw: 192, cores: 896 }, // corregido a variante mobile/pro
	"NVIDIA T550": { vram: 4, bw: 112, cores: 1024 }, // corregido
	"NVIDIA T500": { vram: 4, bw: 80, cores: 896 }, // corregido

	// NVIDIA Quadro / professional (Pascal mobile)
	// Source: NVIDIA mobile line cards + Notebookcheck
	"Quadro P5200": { vram: 16, bw: 230, cores: 2560 }, // corregido
	"Quadro P5000": { vram: 16, bw: 288, cores: 2560 },
	"Quadro P4200": { vram: 8, bw: 224, cores: 1792 },
	"Quadro P4000": { vram: 8, bw: 192, cores: 1792 }, // corregido
	"Quadro P3000": { vram: 6, bw: 168, cores: 1280 },
	"Quadro P3200": { vram: 6, bw: 192, cores: 1792 }, // corregido
	"Quadro P2000": { vram: 5, bw: 140, cores: 1024 },
	"Quadro P1000": { vram: 4, bw: 82, cores: 640 },
	"Quadro P620": { vram: 4, bw: 96, cores: 512 }, // corregido
	"Quadro P600": { vram: 2, bw: 64, cores: 384 },
	"Quadro P520": { vram: 2, bw: 48, cores: 384 }, // corregido
	"Quadro P500": { vram: 2, bw: 64, cores: 256 },

	// NVIDIA Quadro / professional (Maxwell mobile)
	// Source: Notebookcheck
	"Quadro M5500": { vram: 8, bw: 211, cores: 2048 },
	"Quadro M5000M": { vram: 8, bw: 160, cores: 1536 },
	"Quadro M4000M": { vram: 4, bw: 160, cores: 1024 },
	"Quadro M3000M": { vram: 4, bw: 160, cores: 1024 },
	"Quadro M2200": { vram: 4, bw: 140, cores: 1024 },
	"Quadro M2000M": { vram: 4, bw: 80, cores: 640 },
	"Quadro M1200": { vram: 4, bw: 128, cores: 640 },
	"Quadro M1000M": { vram: 2, bw: 80, cores: 512 },
	"Quadro M620": { vram: 2, bw: 80, cores: 512 },
	"Quadro M600M": { vram: 2, bw: 64, cores: 384 },
	"Quadro M520": { vram: 1, bw: 40, cores: 384 }, // corregido
	"Quadro M500M": { vram: 2, bw: 16, cores: 384 }, // corregido

	// NVIDIA Quadro / professional (Kepler)
	// Source: NVIDIA official specs
	"Quadro K4200": { vram: 4, bw: 173, cores: 1344 },

	// NVIDIA Quadro / professional (Kepler mobile)
	// Source: Notebookcheck
	"Quadro K5100M": { vram: 8, bw: 160, cores: 1536 },
	"Quadro K5000M": { vram: 4, bw: 173, cores: 1344 },
	"Quadro K4100M": { vram: 4, bw: 115, cores: 1152 },
	"Quadro K4000M": { vram: 4, bw: 134, cores: 960 },
	"Quadro K3100M": { vram: 4, bw: 80, cores: 768 },
	"Quadro K3000M": { vram: 2, bw: 80, cores: 576 },
	"Quadro K2100M": { vram: 2, bw: 48, cores: 576 }, // corregido
	"Quadro K2000M": { vram: 2, bw: 64, cores: 384 },
	"Quadro K1100M": { vram: 2, bw: 64, cores: 384 },
	"Quadro K1000M": { vram: 2, bw: 64, cores: 384 },
	"Quadro K620M": { vram: 2, bw: 16, cores: 384 }, // corregido
	"Quadro K610M": { vram: 1, bw: 29, cores: 192 },
	"Quadro K510M": { vram: 1, bw: 19.2, cores: 192 }, // corregido
	"Quadro K500M": { vram: 2, bw: 28.8, cores: 192 }, // corregido

	// NVIDIA RTX Ampere workstation entries
	// Source: NVIDIA Professional Graphics Solutions line card
	"RTX A3000": { vram: 6, bw: 192, cores: 4096 }, // mantenido tal como lo tenías por nomenclatura usada en tu DB
	"RTX A3000 12GB": { vram: 12, bw: 336, cores: 4096 },
	"RTX A2000 8GB": { vram: 8, bw: 224, cores: 2560 }, // corregido
	"RTX A1000": { vram: 4, bw: 224, cores: 2048 }, // corregido
	"RTX A500": { vram: 4, bw: 112, cores: 2048 }, // corregido

	// AMD RX 5xxx (RDNA 1)
	// Source: AMD official product specs
	"RX 5700 XT": { vram: 8, bw: 448, cores: 2560 },
	"RX 5700": { vram: 8, bw: 448, cores: 2304 },
	"RX 5600 XT": { vram: 6, bw: 288, cores: 2304 },
	"RX 5500 XT": { vram: 8, bw: 224, cores: 1408 },

	// AMD RX 500 series (Polaris)
	// Source: AMD official product specs
	"RX 590": { vram: 8, bw: 256, cores: 2304 },
	"RX 580": { vram: 8, bw: 256, cores: 2304 },
	"RX 570": { vram: 4, bw: 224, cores: 2048 },
	"RX 560": { vram: 4, bw: 112, cores: 1024 },

	// AMD RX Vega
	// Source: AMD official product specs
	"Radeon VII": { vram: 16, bw: 1024, cores: 3840 },
	"Vega 64": { vram: 8, bw: 484, cores: 4096 },
	"Vega 56": { vram: 8, bw: 410, cores: 3584 },

	// AMD RX 9xxx (RDNA 4)
	// Source: AMD official product specs
	"RX 9070 XT": { vram: 16, bw: 640, cores: 4096 }, // corregido
	"RX 9070": { vram: 16, bw: 640, cores: 3584 }, // corregido
	"RX 9060 XT 8GB": { vram: 8, bw: 320, cores: 2048 }, // Navi 44, GDDR6 128-bit 20Gbps
	"RX 9060 XT": { vram: 16, bw: 320, cores: 2048 }, // Navi 44, 16 GB SKU (default when size is omitted)

	// AMD Discrete Laptop GPUs (RX 7000M/S)
	// Source: AMD official product specs
	"RX 7900M": { vram: 16, bw: 720, cores: 4608 },
	"RX 7700S": { vram: 8, bw: 288, cores: 2048 },
	"RX 7600M XT": { vram: 8, bw: 288, cores: 2048 },
	"RX 7600M": { vram: 8, bw: 288, cores: 1792 },
	"RX 7600S": { vram: 8, bw: 288, cores: 1792 },

	// AMD Discrete Laptop GPUs (RX 6000M)
	// Source: AMD official product specs
	"RX 6800M": { vram: 12, bw: 384, cores: 2560 },
	"RX 6700M": { vram: 10, bw: 320, cores: 2304 },
	"RX 6600M": { vram: 8, bw: 224, cores: 1792 }, // corregido
	"RX 6500M": { vram: 4, bw: 144, cores: 1024 },

	// AMD Integrated GPUs (Ryzen APUs)
	// Source: AMD platform memory specs / common LPDDR5 or DDR5 practical bandwidth assumptions
	"Ryzen AI MAX+ 395": { vram: 96, bw: 256, cores: 2560 },
	"Radeon 890M": { vram: 0, bw: 89, cores: 1024 },
	"Radeon 880M": { vram: 0, bw: 89, cores: 768 },
	"Radeon 780M": { vram: 0, bw: 89, cores: 768 },
	"Radeon 760M": { vram: 0, bw: 89, cores: 512 },
	"Radeon 680M": { vram: 0, bw: 77, cores: 768 },
	"Radeon 660M": { vram: 0, bw: 77, cores: 384 },
	"Vega 8": { vram: 0, bw: 51, cores: 512 },
	"Vega 7": { vram: 0, bw: 51, cores: 448 },

	// Intel Arc Laptop GPUs
	// Source: Intel official product specs
	"Arc A770M": { vram: 16, bw: 512, cores: 4096 },
	"Arc A550M": { vram: 8, bw: 224, cores: 2048 },
	"Arc A370M": { vram: 4, bw: 112, cores: 1024 },

	// Intel integrated
	// Source: Intel platform memory specs / common system memory bandwidth assumptions
	"Iris Xe": { vram: 0, bw: 68, cores: 96 },
	"Iris Plus": { vram: 0, bw: 50, cores: 64 },
	"UHD 770": { vram: 0, bw: 76, cores: 32 },
	"UHD 730": { vram: 0, bw: 76, cores: 24 },
	"UHD Graphics 630": { vram: 0, bw: 42, cores: 24 },
	"UHD Graphics 620": { vram: 0, bw: 34, cores: 24 },
};

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

export const MOBILE_GPU_DB: Record<string, { bw: number; ram?: number }> = {
	"Adreno 830": { bw: 90 },
	"Adreno 750": { bw: 77 },
	"Adreno 740": { bw: 62 },
	"Adreno 735": { bw: 51 },
	"Adreno 730": { bw: 51 },
	"Adreno 725": { bw: 44 },
	"Adreno 720": { bw: 38 },
	"Adreno 710": { bw: 34 },
	"Adreno 660": { bw: 44 },
	"Adreno 650": { bw: 44 },
	"Adreno 642": { bw: 17 },
	"Adreno 640": { bw: 34 },
	"Adreno 630": { bw: 30 },
	"Adreno 620": { bw: 17 },
	"Adreno 619": { bw: 17 },
	"Adreno 618": { bw: 14 },
	"Adreno 616": { bw: 14 },
	"Adreno 612": { bw: 10 },
	"Immortalis-G925": { bw: 77 },
	"Immortalis-G720": { bw: 77 },
	"Immortalis-G715": { bw: 51 },
	"Mali-G925": { bw: 77 },
	"Mali-G720": { bw: 77 },
	"Mali-G715": { bw: 51 },
	"Mali-G710": { bw: 44 },
	"Mali-G78": { bw: 35 },
	"Mali-G77": { bw: 30 },
	"Mali-G76": { bw: 25 },
	"Mali-G72": { bw: 20 },
	"Mali-G71": { bw: 15 },
	"Mali-G57": { bw: 17 },
	"Mali-G52": { bw: 12 },
	"Xclipse 940": { bw: 51 },
	"Xclipse 930": { bw: 44 },
	"Xclipse 920": { bw: 38 },
	"Tensor G5": { bw: 56, ram: 16 },
	"Tensor G4": { bw: 51, ram: 12 },
	"Tensor G3": { bw: 51, ram: 8 },
	"Tensor G2": { bw: 44, ram: 8 },
	"Tensor G1": { bw: 35, ram: 8 },
};

export const SBC_DB: Record<string, { ram: number; bw: number }> = {
	"Raspberry Pi 5 (16 GB)": { ram: 16, bw: 32 },
	"Raspberry Pi 5 (8 GB)": { ram: 8, bw: 32 },
	"Raspberry Pi 5 (4 GB)": { ram: 4, bw: 32 },
	"Raspberry Pi 4 (8 GB)": { ram: 8, bw: 13 },
	"Raspberry Pi 4 (4 GB)": { ram: 4, bw: 13 },
};

type GpuDeviceSpec = (typeof GPU_DB)[string];
type AppleDeviceSpec = (typeof APPLE_DB)[string];
type MobileDeviceSpec = (typeof MOBILE_GPU_DB)[string];
type SbcDeviceSpec = (typeof SBC_DB)[string];

export interface MatchedGpuDevice extends GpuDeviceSpec {
	readonly name: string;
}

export interface MatchedAppleDevice extends AppleDeviceSpec {
	readonly name: string;
}

export interface MatchedMobileDevice extends MobileDeviceSpec {
	readonly name: string;
}

export interface MatchedSbcDevice extends SbcDeviceSpec {
	readonly name: string;
}

export const CANIRUN_DEVICE_COUNTS = {
	gpu: 227,
	apple: 20,
	mobile: 40,
	sbc: 5,
} as const;

const GPU_ALIASES: ReadonlyArray<readonly [RegExp, keyof typeof GPU_DB]> = [
	[/\bGB10(?:-1(?:-A)?)?\b/i, "DGX Spark"],
];

const APPLE_BANDWIDTH_OVERRIDES: Readonly<Record<string, number>> = {
	"m6 ultra": 1_200,
	"m6 max": 614,
	"m6 pro": 307,
	"m4 ultra": 819,
};

function normalizedDeviceName(value: string): string {
	return value.toUpperCase().replaceAll("(TM)", "").replace(/\s+/g, " ").trim();
}

function longestMatchingEntry<T>(
	value: string,
	entries: Readonly<Record<string, T>>,
): { readonly name: string; readonly spec: T } | null {
	const normalized = normalizedDeviceName(value);
	let result: { readonly name: string; readonly spec: T } | null = null;

	for (const [name, spec] of Object.entries(entries)) {
		if (normalized.includes(name.toUpperCase()) && (!result || name.length > result.name.length)) {
			result = { name, spec };
		}
	}

	return result;
}

export function matchCanIRunGpu(value: string): MatchedGpuDevice | null {
	for (const [pattern, canonicalName] of GPU_ALIASES) {
		const spec = GPU_DB[canonicalName];
		if (pattern.test(value) && spec) return { name: canonicalName, ...spec };
	}

	const match = longestMatchingEntry(value, GPU_DB);
	return match ? { name: match.name, ...match.spec } : null;
}

export function matchCanIRunApple(value: string): MatchedAppleDevice | null {
	const match = longestMatchingEntry(value, APPLE_DB);
	if (!match) return null;

	const normalizedName = match.name.toLowerCase();
	const override = Object.entries(APPLE_BANDWIDTH_OVERRIDES).find(([name]) =>
		value.toLowerCase().includes(name),
	)?.[1];
	return {
		name: override
			? value
					.trim()
					.replace(/^apple\s+/i, "")
					.toLowerCase()
			: match.name,
		...match.spec,
		bw: override ?? APPLE_BANDWIDTH_OVERRIDES[normalizedName] ?? match.spec.bw,
	};
}

export function matchCanIRunMobile(value: string): MatchedMobileDevice | null {
	const match = longestMatchingEntry(value, MOBILE_GPU_DB);
	return match ? { name: match.name, ...match.spec } : null;
}

export function matchCanIRunSbc(value: string, memoryGib?: number): MatchedSbcDevice | null {
	const directMatch = longestMatchingEntry(value, SBC_DB);
	if (directMatch) return { name: directMatch.name, ...directMatch.spec };

	const generation = value.match(/Raspberry Pi\s+([45])/i)?.[1];
	if (!generation) return null;

	const candidates = Object.entries(SBC_DB).filter(([name]) =>
		name.startsWith(`Raspberry Pi ${generation} `),
	);
	const selected = candidates.reduce<(typeof candidates)[number] | null>((best, candidate) => {
		if (!best) return candidate;
		const target = memoryGib ?? candidate[1].ram;
		return Math.abs(candidate[1].ram - target) < Math.abs(best[1].ram - target) ? candidate : best;
	}, null);
	return selected ? { name: selected[0], ...selected[1] } : null;
}
