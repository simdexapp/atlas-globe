// Country centroid labels for the Cesium globe. Each entry is the rough
// geographic center of the country (not the capital) so the label sits in
// the middle of the landmass at far zoom. Used for orbit-level country
// identification — at closer zoom Cesium's own country borders + city
// labels take over.
//
// Tier-1 means major countries (visible from very far out / orbital view).
// Tier-2 are mid-sized; only show when zoomed somewhat close.
// Curated; not auto-generated from a TopoJSON file (which would be cheaper
// in tokens than centroids but would clip oddly on multi-region nations).

export type CountryCentroid = {
  name: string;
  code: string;          // ISO 3166-1 alpha-2
  lat: number;
  lon: number;
  tier: 1 | 2;           // 1 = always-on, 2 = closer-zoom
};

export const COUNTRY_CENTROIDS: CountryCentroid[] = [
  // ===== Tier 1: Largest / most populous nations =====
  { name: "United States", code: "US", lat: 39.8283,  lon: -98.5795, tier: 1 },
  { name: "Russia",        code: "RU", lat: 61.5240,  lon:  105.3188, tier: 1 },
  { name: "China",         code: "CN", lat: 35.8617,  lon:  104.1954, tier: 1 },
  { name: "Brazil",        code: "BR", lat: -14.2350, lon:  -51.9253, tier: 1 },
  { name: "Australia",     code: "AU", lat: -25.2744, lon:  133.7751, tier: 1 },
  { name: "India",         code: "IN", lat: 20.5937,  lon:   78.9629, tier: 1 },
  { name: "Canada",        code: "CA", lat: 56.1304,  lon: -106.3468, tier: 1 },
  { name: "Argentina",     code: "AR", lat: -38.4161, lon:  -63.6167, tier: 1 },
  { name: "Algeria",       code: "DZ", lat: 28.0339,  lon:    1.6596, tier: 1 },
  { name: "Saudi Arabia",  code: "SA", lat: 23.8859,  lon:   45.0792, tier: 1 },
  { name: "Mexico",        code: "MX", lat: 23.6345,  lon: -102.5528, tier: 1 },
  { name: "Indonesia",     code: "ID", lat: -0.7893,  lon:  113.9213, tier: 1 },
  { name: "Mongolia",      code: "MN", lat: 46.8625,  lon:  103.8467, tier: 1 },
  { name: "Greenland",     code: "GL", lat: 71.7069,  lon:  -42.6043, tier: 1 },
  { name: "Antarctica",    code: "AQ", lat: -82.8628, lon:  135.0000, tier: 1 },

  // ===== Tier 2: Other countries (mid-zoom) =====
  { name: "Japan",         code: "JP", lat: 36.2048,  lon:  138.2529, tier: 2 },
  { name: "Germany",       code: "DE", lat: 51.1657,  lon:   10.4515, tier: 2 },
  { name: "France",        code: "FR", lat: 46.6034,  lon:    1.8883, tier: 2 },
  { name: "United Kingdom",code: "GB", lat: 55.3781,  lon:   -3.4360, tier: 2 },
  { name: "Spain",         code: "ES", lat: 40.4637,  lon:   -3.7492, tier: 2 },
  { name: "Italy",         code: "IT", lat: 41.8719,  lon:   12.5674, tier: 2 },
  { name: "Turkey",        code: "TR", lat: 38.9637,  lon:   35.2433, tier: 2 },
  { name: "Iran",          code: "IR", lat: 32.4279,  lon:   53.6880, tier: 2 },
  { name: "Egypt",         code: "EG", lat: 26.8206,  lon:   30.8025, tier: 2 },
  { name: "Pakistan",      code: "PK", lat: 30.3753,  lon:   69.3451, tier: 2 },
  { name: "Nigeria",       code: "NG", lat:  9.0820,  lon:    8.6753, tier: 2 },
  { name: "Ethiopia",      code: "ET", lat:  9.1450,  lon:   40.4897, tier: 2 },
  { name: "Kazakhstan",    code: "KZ", lat: 48.0196,  lon:   66.9237, tier: 2 },
  { name: "South Africa",  code: "ZA", lat: -30.5595, lon:   22.9375, tier: 2 },
  { name: "Colombia",      code: "CO", lat:  4.5709,  lon:  -74.2973, tier: 2 },
  { name: "Peru",          code: "PE", lat: -9.1900,  lon:  -75.0152, tier: 2 },
  { name: "Bolivia",       code: "BO", lat: -16.2902, lon:  -63.5887, tier: 2 },
  { name: "Venezuela",     code: "VE", lat:  6.4238,  lon:  -66.5897, tier: 2 },
  { name: "Chile",         code: "CL", lat: -35.6751, lon:  -71.5430, tier: 2 },
  { name: "Sweden",        code: "SE", lat: 60.1282,  lon:   18.6435, tier: 2 },
  { name: "Norway",        code: "NO", lat: 60.4720,  lon:    8.4689, tier: 2 },
  { name: "Finland",       code: "FI", lat: 61.9241,  lon:   25.7482, tier: 2 },
  { name: "Poland",        code: "PL", lat: 51.9194,  lon:   19.1451, tier: 2 },
  { name: "Ukraine",       code: "UA", lat: 48.3794,  lon:   31.1656, tier: 2 },
  { name: "Vietnam",       code: "VN", lat: 14.0583,  lon:  108.2772, tier: 2 },
  { name: "Thailand",      code: "TH", lat: 15.8700,  lon:  100.9925, tier: 2 },
  { name: "Philippines",   code: "PH", lat: 12.8797,  lon:  121.7740, tier: 2 },
  { name: "Malaysia",      code: "MY", lat:  4.2105,  lon:  101.9758, tier: 2 },
  { name: "South Korea",   code: "KR", lat: 35.9078,  lon:  127.7669, tier: 2 },
  { name: "North Korea",   code: "KP", lat: 40.3399,  lon:  127.5101, tier: 2 },
  { name: "Iraq",          code: "IQ", lat: 33.2232,  lon:   43.6793, tier: 2 },
  { name: "Afghanistan",   code: "AF", lat: 33.9391,  lon:   67.7100, tier: 2 },
  { name: "Sudan",         code: "SD", lat: 12.8628,  lon:   30.2176, tier: 2 },
  { name: "Libya",         code: "LY", lat: 26.3351,  lon:   17.2283, tier: 2 },
  { name: "Morocco",       code: "MA", lat: 31.7917,  lon:   -7.0926, tier: 2 },
  { name: "Kenya",         code: "KE", lat: -0.0236,  lon:   37.9062, tier: 2 },
  { name: "Tanzania",      code: "TZ", lat: -6.3690,  lon:   34.8888, tier: 2 },
  { name: "Madagascar",    code: "MG", lat: -18.7669, lon:   46.8691, tier: 2 },
  { name: "New Zealand",   code: "NZ", lat: -40.9006, lon:  174.8860, tier: 2 },
  { name: "Papua New Guinea",code: "PG", lat: -6.3150,lon:  143.9555, tier: 2 },
  { name: "Iceland",       code: "IS", lat: 64.9631,  lon:  -19.0208, tier: 2 },
  { name: "Cuba",          code: "CU", lat: 21.5218,  lon:  -77.7812, tier: 2 },
];
