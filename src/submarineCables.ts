// Major submarine fiber-optic cables — the backbone of the global
// internet. Coordinates are landing-station pairs; the actual cable
// follows a great-circle (or somewhat curved seabed route, but
// great-circle is a fine approximation for visualization at globe
// zoom). Capacity is the design Tbps where published.
//
// Curated to ~30 of the biggest / most strategically-important
// cables. Source: TeleGeography submarine cable map (publicly
// referenced data), each cable's Wikipedia entry, vendor pages.

export type SubmarineCable = {
  id: string;
  name: string;
  fromName: string;
  toName: string;
  fromLat: number; fromLon: number;
  toLat: number;   toLon: number;
  capacityTbps?: number;     // design capacity per fibre pair × pairs
  yearLive?: number;
  consortium?: string;
};

export const SUBMARINE_CABLES: SubmarineCable[] = [
  // ===== Trans-Atlantic =====
  { id: "marea",       name: "MAREA",         fromName: "Virginia Beach, US",   toName: "Bilbao, Spain",         fromLat: 36.847, fromLon: -75.978, toLat: 43.263, toLon: -2.935, capacityTbps: 200, yearLive: 2017, consortium: "Microsoft + Meta + Telxius" },
  { id: "dunant",      name: "Dunant",        fromName: "Virginia Beach, US",   toName: "Saint-Hilaire-de-Riez, France", fromLat: 36.847, fromLon: -75.978, toLat: 46.708, toLon: -1.928, capacityTbps: 250, yearLive: 2021, consortium: "Google" },
  { id: "amitie",      name: "Amitié",        fromName: "Lynn, US",             toName: "Le Porge, France",      fromLat: 42.466, fromLon: -70.949, toLat: 44.893, toLon: -1.181, capacityTbps: 400, yearLive: 2022, consortium: "Meta" },
  { id: "grace-hopper",name: "Grace Hopper",  fromName: "Bude, UK",             toName: "Bilbao, Spain",         fromLat: 50.829, fromLon: -4.547, toLat: 43.263, toLon: -2.935, capacityTbps: 350, yearLive: 2022, consortium: "Google" },
  { id: "havfrue",     name: "Havfrue",       fromName: "Wall Township, US",    toName: "Blaabjerg, Denmark",    fromLat: 40.169, fromLon: -74.072, toLat: 55.674, toLon: 8.182, capacityTbps: 108, yearLive: 2020, consortium: "Aqua Comms + Facebook + Google" },
  { id: "tatk",        name: "TAT-14",        fromName: "Manasquan, US",        toName: "Tuckerton, US (loop)",  fromLat: 40.105, fromLon: -74.045, toLat: 39.601, toLon: -74.341, capacityTbps: 9.4, yearLive: 2001, consortium: "TAT-14 Consortium" },

  // ===== Trans-Pacific =====
  { id: "jupiter",     name: "JUPITER",       fromName: "Hermosa Beach, US",    toName: "Maruyama, Japan",       fromLat: 33.862, fromLon: -118.398, toLat: 35.044, toLon: 140.038, capacityTbps: 60, yearLive: 2020, consortium: "Amazon + Facebook + NTT + SoftBank" },
  { id: "echo",        name: "Echo",          fromName: "Eureka, US",           toName: "Singapore",             fromLat: 40.802, fromLon: -124.165, toLat: 1.290,  toLon: 103.851, capacityTbps: 144, yearLive: 2024, consortium: "Google + Meta" },
  { id: "bifrost",     name: "Bifrost",       fromName: "Grover Beach, US",     toName: "Manado, Indonesia",     fromLat: 35.121, fromLon: -120.622, toLat: 1.474,  toLon: 124.842, capacityTbps: 144, yearLive: 2024, consortium: "Meta + Telin + Keppel" },
  { id: "pli-pacific", name: "Pacific Light Cable Network", fromName: "El Segundo, US", toName: "Hong Kong", fromLat: 33.913, fromLon: -118.420, toLat: 22.319, toLon: 114.169, capacityTbps: 144, yearLive: 2018, consortium: "Pacific Light Data" },
  { id: "n-cross",     name: "New Cross Pacific", fromName: "Pacific City, US", toName: "Chongming, China",      fromLat: 45.205, fromLon: -123.965, toLat: 31.625, toLon: 121.480, capacityTbps: 80, yearLive: 2018, consortium: "China Telecom + KT + SoftBank + Microsoft" },

  // ===== Asia-Europe =====
  { id: "see-me-we-6", name: "SEA-ME-WE 6",   fromName: "Marseille, France",    toName: "Singapore",             fromLat: 43.296, fromLon: 5.370,   toLat: 1.290,  toLon: 103.851, capacityTbps: 100, yearLive: 2025, consortium: "Telecom Egypt + 16 others" },
  { id: "see-me-we-5", name: "SEA-ME-WE 5",   fromName: "Toulon, France",      toName: "Singapore",             fromLat: 43.124, fromLon: 5.928,   toLat: 1.290,  toLon: 103.851, capacityTbps: 24, yearLive: 2016, consortium: "SEA-ME-WE 5 Consortium" },
  { id: "aae-1",       name: "AAE-1",         fromName: "Marseille, France",    toName: "Hong Kong",             fromLat: 43.296, fromLon: 5.370,   toLat: 22.319, toLon: 114.169, capacityTbps: 40, yearLive: 2017, consortium: "AAE-1 Consortium" },
  { id: "blue-raman",  name: "Blue/Raman",    fromName: "Genoa, Italy",         toName: "Mumbai, India",         fromLat: 44.405, fromLon: 8.946,   toLat: 19.076, toLon: 72.878, capacityTbps: 200, yearLive: 2024, consortium: "Google" },
  { id: "peace",       name: "PEACE",         fromName: "Marseille, France",    toName: "Karachi, Pakistan",     fromLat: 43.296, fromLon: 5.370,   toLat: 24.861, toLon: 67.001, capacityTbps: 96, yearLive: 2022, consortium: "PEACE Cable Intl." },

  // ===== Africa =====
  { id: "2africa",     name: "2Africa",       fromName: "Genoa, Italy",         toName: "Cape Town, South Africa", fromLat: 44.405, fromLon: 8.946, toLat: -33.925, toLon: 18.424, capacityTbps: 180, yearLive: 2024, consortium: "Meta + Vodafone + China Mobile + 6 others" },
  { id: "equiano",     name: "Equiano",       fromName: "Lisbon, Portugal",     toName: "Cape Town, South Africa", fromLat: 38.722, fromLon: -9.139, toLat: -33.925, toLon: 18.424, capacityTbps: 144, yearLive: 2023, consortium: "Google" },
  { id: "wacs",        name: "WACS",          fromName: "London, UK",           toName: "Cape Town, South Africa", fromLat: 51.508, fromLon: -0.128, toLat: -33.925, toLon: 18.424, capacityTbps: 14.5, yearLive: 2012, consortium: "WACS Consortium" },
  { id: "sat3",        name: "SAT-3/WASC",    fromName: "Sesimbra, Portugal",   toName: "Melkbosstrand, South Africa", fromLat: 38.444, fromLon: -9.103, toLat: -33.722, toLon: 18.443, capacityTbps: 0.34, yearLive: 2002, consortium: "SAT-3 Consortium" },
  { id: "eassy",       name: "EASSy",         fromName: "Port Sudan, Sudan",    toName: "Mtunzini, South Africa", fromLat: 19.617, fromLon: 37.215,   toLat: -28.957, toLon: 31.751, capacityTbps: 10, yearLive: 2010, consortium: "EASSy Consortium" },

  // ===== South America =====
  { id: "monet",       name: "Monet",         fromName: "Boca Raton, US",       toName: "Fortaleza, Brazil",     fromLat: 26.359, fromLon: -80.083, toLat: -3.732, toLon: -38.527, capacityTbps: 64, yearLive: 2017, consortium: "Google + Algar + Antel + Angola Cables" },
  { id: "firmina",     name: "Firmina",       fromName: "Myrtle Beach, US",     toName: "Las Toninas, Argentina", fromLat: 33.689, fromLon: -78.886, toLat: -36.516, toLon: -56.685, capacityTbps: 240, yearLive: 2025, consortium: "Google" },
  { id: "south-america-1", name: "South America-1", fromName: "Las Toninas, Argentina", toName: "Boca Raton, US", fromLat: -36.516, fromLon: -56.685, toLat: 26.359, toLon: -80.083, capacityTbps: 5.12, yearLive: 2017, consortium: "Telxius" },

  // ===== Indian Ocean / Oceania =====
  { id: "indigo",      name: "INDIGO",        fromName: "Sydney, Australia",    toName: "Singapore",             fromLat: -33.869, fromLon: 151.209, toLat: 1.290, toLon: 103.851, capacityTbps: 36, yearLive: 2019, consortium: "Telstra + Singtel + Indosat + Google" },
  { id: "hawaiki",     name: "Hawaiki",       fromName: "Hillsboro, US",        toName: "Sydney, Australia",     fromLat: 45.523, fromLon: -122.989, toLat: -33.869, toLon: 151.209, capacityTbps: 43, yearLive: 2018, consortium: "Hawaiki Submarine Cable" },
  { id: "southern-cross", name: "Southern Cross NEXT", fromName: "Los Angeles, US", toName: "Sydney, Australia", fromLat: 33.913, fromLon: -118.420, toLat: -33.869, toLon: 151.209, capacityTbps: 72, yearLive: 2022, consortium: "Southern Cross Cables" },

  // ===== Arctic =====
  { id: "polar-express", name: "Polar Express", fromName: "Murmansk, Russia",   toName: "Vladivostok, Russia",   fromLat: 68.970, fromLon: 33.075,  toLat: 43.120, toLon: 131.886, capacityTbps: 104, yearLive: 2026, consortium: "Rostelecom" },
  { id: "fennoskan",   name: "Fenno-Skan",    fromName: "Stockholm, Sweden",    toName: "Helsinki, Finland",     fromLat: 59.329, fromLon: 18.069,  toLat: 60.170, toLon: 24.938, capacityTbps: 1.6, yearLive: 2011, consortium: "Cinia" },
];
