// Top ~50 metropolitan areas worldwide. Used for label overlays in Surface
// mode and as quick-access bookmarks. Sources: UN World Population Prospects.

export type MajorCity = {
  name: string;
  country: string;
  lat: number;
  lon: number;
  population: number;       // approximate metro population in millions × 1_000_000
};

export const MAJOR_CITIES: MajorCity[] = [
  { name: "Tokyo",         country: "JP", lat: 35.6762,  lon: 139.6503,  population: 37_000_000 },
  { name: "Delhi",         country: "IN", lat: 28.7041,  lon: 77.1025,   population: 33_000_000 },
  { name: "Shanghai",      country: "CN", lat: 31.2304,  lon: 121.4737,  population: 29_000_000 },
  { name: "São Paulo",     country: "BR", lat: -23.5505, lon: -46.6333,  population: 22_500_000 },
  { name: "Mexico City",   country: "MX", lat: 19.4326,  lon: -99.1332,  population: 22_000_000 },
  { name: "Cairo",         country: "EG", lat: 30.0444,  lon: 31.2357,   population: 22_000_000 },
  { name: "Mumbai",        country: "IN", lat: 19.0760,  lon: 72.8777,   population: 21_300_000 },
  { name: "Beijing",       country: "CN", lat: 39.9042,  lon: 116.4074,  population: 21_300_000 },
  { name: "Dhaka",         country: "BD", lat: 23.8103,  lon: 90.4125,   population: 22_500_000 },
  { name: "Osaka",         country: "JP", lat: 34.6937,  lon: 135.5023,  population: 19_100_000 },
  { name: "New York",      country: "US", lat: 40.7128,  lon: -74.0060,  population: 18_900_000 },
  { name: "Karachi",       country: "PK", lat: 24.8607,  lon: 67.0011,   population: 16_800_000 },
  { name: "Buenos Aires",  country: "AR", lat: -34.6037, lon: -58.3816,  population: 15_400_000 },
  { name: "Chongqing",     country: "CN", lat: 29.4316,  lon: 106.9123,  population: 16_400_000 },
  { name: "Istanbul",      country: "TR", lat: 41.0082,  lon: 28.9784,   population: 15_500_000 },
  { name: "Kolkata",       country: "IN", lat: 22.5726,  lon: 88.3639,   population: 14_900_000 },
  { name: "Manila",        country: "PH", lat: 14.5995,  lon: 120.9842,  population: 14_400_000 },
  { name: "Lagos",         country: "NG", lat: 6.5244,   lon: 3.3792,    population: 15_400_000 },
  { name: "Rio de Janeiro",country: "BR", lat: -22.9068, lon: -43.1729,  population: 13_500_000 },
  { name: "Tianjin",       country: "CN", lat: 39.3434,  lon: 117.3616,  population: 13_600_000 },
  { name: "Kinshasa",      country: "CD", lat: -4.4419,  lon: 15.2663,   population: 14_300_000 },
  { name: "Guangzhou",     country: "CN", lat: 23.1291,  lon: 113.2644,  population: 13_500_000 },
  { name: "Los Angeles",   country: "US", lat: 34.0522,  lon: -118.2437, population: 12_400_000 },
  { name: "Moscow",        country: "RU", lat: 55.7558,  lon: 37.6173,   population: 12_500_000 },
  { name: "Shenzhen",      country: "CN", lat: 22.5431,  lon: 114.0579,  population: 12_400_000 },
  { name: "Lahore",        country: "PK", lat: 31.5204,  lon: 74.3587,   population: 13_000_000 },
  { name: "Bangalore",     country: "IN", lat: 12.9716,  lon: 77.5946,   population: 12_300_000 },
  { name: "Paris",         country: "FR", lat: 48.8566,  lon: 2.3522,    population: 11_100_000 },
  { name: "Bogotá",        country: "CO", lat: 4.7110,   lon: -74.0721,  population: 11_300_000 },
  { name: "Jakarta",       country: "ID", lat: -6.2088,  lon: 106.8456,  population: 10_800_000 },
  { name: "Chennai",       country: "IN", lat: 13.0827,  lon: 80.2707,   population: 11_500_000 },
  { name: "Lima",          country: "PE", lat: -12.0464, lon: -77.0428,  population: 11_000_000 },
  { name: "Bangkok",       country: "TH", lat: 13.7563,  lon: 100.5018,  population: 10_700_000 },
  { name: "Seoul",         country: "KR", lat: 37.5665,  lon: 126.9780,  population: 9_900_000 },
  { name: "Nagoya",        country: "JP", lat: 35.1815,  lon: 136.9066,  population: 9_500_000 },
  { name: "Hyderabad",     country: "IN", lat: 17.3850,  lon: 78.4867,   population: 10_500_000 },
  { name: "London",        country: "GB", lat: 51.5074,  lon: -0.1278,   population: 9_500_000 },
  { name: "Tehran",        country: "IR", lat: 35.6892,  lon: 51.3890,   population: 9_300_000 },
  { name: "Chicago",       country: "US", lat: 41.8781,  lon: -87.6298,  population: 8_900_000 },
  { name: "Chengdu",       country: "CN", lat: 30.5728,  lon: 104.0668,  population: 9_100_000 },
  { name: "Nanjing",       country: "CN", lat: 32.0603,  lon: 118.7969,  population: 9_400_000 },
  { name: "Wuhan",         country: "CN", lat: 30.5928,  lon: 114.3055,  population: 8_400_000 },
  { name: "Ho Chi Minh",   country: "VN", lat: 10.8231,  lon: 106.6297,  population: 9_100_000 },
  { name: "Luanda",        country: "AO", lat: -8.8390,  lon: 13.2894,   population: 8_700_000 },
  { name: "Ahmedabad",     country: "IN", lat: 23.0225,  lon: 72.5714,   population: 8_400_000 },
  { name: "Madrid",        country: "ES", lat: 40.4168,  lon: -3.7038,   population: 6_700_000 },
  { name: "Toronto",       country: "CA", lat: 43.6532,  lon: -79.3832,  population: 6_400_000 },
  { name: "Sydney",        country: "AU", lat: -33.8688, lon: 151.2093,  population: 5_400_000 },
  { name: "Cape Town",     country: "ZA", lat: -33.9249, lon: 18.4241,   population: 4_700_000 },
  { name: "Singapore",     country: "SG", lat: 1.3521,   lon: 103.8198,  population: 5_900_000 },
  { name: "Berlin",        country: "DE", lat: 52.5200,  lon: 13.4050,   population: 4_500_000 },
  { name: "Stockholm",     country: "SE", lat: 59.3293,  lon: 18.0686,   population: 1_700_000 },
  { name: "Dubai",         country: "AE", lat: 25.2048,  lon: 55.2708,   population: 3_500_000 },
];
