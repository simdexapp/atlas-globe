// Famous natural + man-made landmarks. Used as fly-to bookmarks and as
// labeled markers in Cesium Surface mode. Coordinates are the actual
// site (not the nearest city).

export type Landmark = {
  id: string;
  name: string;
  emoji: string;
  lat: number;
  lon: number;
  // Approximate visit altitude in km — small for ground sites, larger
  // for ocean/mountain ranges where you want a wider view.
  zoomKm: number;
  kind: "natural" | "manmade";
};

export const LANDMARKS: Landmark[] = [
  // Natural wonders
  { id: "grand-canyon",   name: "Grand Canyon",       emoji: "🏞", lat:  36.0544, lon: -112.1401, zoomKm: 12, kind: "natural" },
  { id: "everest",        name: "Mount Everest",      emoji: "🏔",  lat:  27.9881, lon:   86.9250, zoomKm: 18, kind: "natural" },
  { id: "kilimanjaro",    name: "Mount Kilimanjaro",  emoji: "🏔",  lat:  -3.0674, lon:   37.3556, zoomKm: 18, kind: "natural" },
  { id: "fuji",           name: "Mount Fuji",         emoji: "🗻", lat:  35.3606, lon:  138.7274, zoomKm: 14, kind: "natural" },
  { id: "amazon-rainforest", name: "Amazon Rainforest", emoji: "🌳", lat:  -3.4653, lon:  -62.2159, zoomKm: 600, kind: "natural" },
  { id: "sahara",         name: "Sahara Desert",      emoji: "🏜",  lat:  23.4162, lon:   25.6628, zoomKm: 1500, kind: "natural" },
  { id: "great-barrier",  name: "Great Barrier Reef", emoji: "🐠", lat: -18.2871, lon:  147.6992, zoomKm: 200, kind: "natural" },
  { id: "niagara-falls",  name: "Niagara Falls",      emoji: "💦", lat:  43.0962, lon:  -79.0377, zoomKm: 6,  kind: "natural" },
  { id: "iguazu-falls",   name: "Iguazu Falls",       emoji: "💦", lat: -25.6953, lon:  -54.4367, zoomKm: 6,  kind: "natural" },
  { id: "victoria-falls", name: "Victoria Falls",     emoji: "💦", lat: -17.9243, lon:   25.8572, zoomKm: 6,  kind: "natural" },
  { id: "uluru",          name: "Uluru (Ayers Rock)", emoji: "🪨", lat: -25.3444, lon:  131.0369, zoomKm: 8,  kind: "natural" },
  { id: "yellowstone",    name: "Yellowstone NP",     emoji: "🌋", lat:  44.4280, lon: -110.5885, zoomKm: 80, kind: "natural" },
  { id: "iceland-glacier",name: "Vatnajökull (Iceland)", emoji: "🧊", lat: 64.4163, lon: -16.7700, zoomKm: 60, kind: "natural" },
  { id: "dead-sea",       name: "Dead Sea",           emoji: "💧", lat:  31.5497, lon:   35.4732, zoomKm: 30, kind: "natural" },
  { id: "matterhorn",     name: "Matterhorn",         emoji: "🏔",  lat:  45.9763, lon:    7.6586, zoomKm: 15, kind: "natural" },

  // Man-made wonders
  { id: "great-wall",     name: "Great Wall of China", emoji: "🧱", lat: 40.4319, lon: 116.5704, zoomKm: 8,  kind: "manmade" },
  { id: "pyramids",       name: "Pyramids of Giza",    emoji: "🏛", lat: 29.9792, lon:  31.1342, zoomKm: 4,  kind: "manmade" },
  { id: "petra",          name: "Petra",               emoji: "🏛", lat: 30.3285, lon:  35.4444, zoomKm: 4,  kind: "manmade" },
  { id: "machu-picchu",   name: "Machu Picchu",        emoji: "🏛", lat: -13.1631, lon: -72.5450, zoomKm: 4,  kind: "manmade" },
  { id: "colosseum",      name: "Colosseum",           emoji: "🏛", lat: 41.8902, lon:  12.4922, zoomKm: 2,  kind: "manmade" },
  { id: "taj-mahal",      name: "Taj Mahal",           emoji: "🕌", lat: 27.1751, lon:  78.0421, zoomKm: 2,  kind: "manmade" },
  { id: "angkor-wat",     name: "Angkor Wat",          emoji: "🛕", lat: 13.4125, lon: 103.8670, zoomKm: 4,  kind: "manmade" },
  { id: "eiffel-tower",   name: "Eiffel Tower",        emoji: "🗼", lat: 48.8584, lon:   2.2945, zoomKm: 1.5,kind: "manmade" },
  { id: "statue-liberty", name: "Statue of Liberty",   emoji: "🗽", lat: 40.6892, lon: -74.0445, zoomKm: 1.5,kind: "manmade" },
  { id: "sydney-opera",   name: "Sydney Opera House",  emoji: "🎭", lat: -33.8568, lon: 151.2153, zoomKm: 1.5,kind: "manmade" },
  { id: "burj-khalifa",   name: "Burj Khalifa",        emoji: "🏙", lat: 25.1972, lon:  55.2744, zoomKm: 2,  kind: "manmade" },
  { id: "christ-redeemer",name: "Christ the Redeemer", emoji: "⛪", lat: -22.9519, lon: -43.2105, zoomKm: 2,  kind: "manmade" },
  { id: "stonehenge",     name: "Stonehenge",          emoji: "🪨", lat: 51.1789, lon:  -1.8262, zoomKm: 2,  kind: "manmade" },
  { id: "moai",           name: "Easter Island Moai",  emoji: "🗿", lat: -27.1212, lon: -109.3676,zoomKm: 6,  kind: "manmade" },
  { id: "chichen-itza",   name: "Chichén Itzá",        emoji: "🛕", lat: 20.6843, lon: -88.5678, zoomKm: 2,  kind: "manmade" },
  { id: "vatican",        name: "Vatican City",        emoji: "⛪", lat: 41.9029, lon:  12.4534, zoomKm: 2,  kind: "manmade" },
  { id: "kremlin",        name: "Moscow Kremlin",      emoji: "🏛", lat: 55.7520, lon:  37.6175, zoomKm: 2,  kind: "manmade" },
  { id: "mecca",          name: "Kaaba (Mecca)",       emoji: "🕌", lat: 21.4225, lon:  39.8262, zoomKm: 2,  kind: "manmade" },
  { id: "hagia-sophia",   name: "Hagia Sophia",        emoji: "🕌", lat: 41.0086, lon:  28.9802, zoomKm: 2,  kind: "manmade" },
  { id: "potala",         name: "Potala Palace",       emoji: "🛕", lat: 29.6573, lon:  91.1170, zoomKm: 4,  kind: "manmade" },

  // ===== Expanded set: more mountains =====
  { id: "k2",             name: "K2",                  emoji: "🏔", lat: 35.8825, lon:  76.5133, zoomKm: 18, kind: "natural" },
  { id: "annapurna",      name: "Annapurna",           emoji: "🏔", lat: 28.5961, lon:  83.8203, zoomKm: 18, kind: "natural" },
  { id: "aconcagua",      name: "Aconcagua",           emoji: "🏔", lat: -32.6532,lon: -70.0109, zoomKm: 18, kind: "natural" },
  { id: "denali",         name: "Denali",              emoji: "🏔", lat: 63.0692, lon:-151.0070, zoomKm: 18, kind: "natural" },
  { id: "mont-blanc",     name: "Mont Blanc",          emoji: "🏔", lat: 45.8326, lon:   6.8650, zoomKm: 14, kind: "natural" },
  { id: "elbrus",         name: "Mt. Elbrus",          emoji: "🏔", lat: 43.3499, lon:  42.4395, zoomKm: 14, kind: "natural" },
  { id: "table-mountain", name: "Table Mountain",      emoji: "🗻", lat: -33.9628,lon:  18.4097, zoomKm: 8,  kind: "natural" },
  { id: "rushmore",       name: "Mount Rushmore",      emoji: "🗿", lat: 43.8791, lon:-103.4591, zoomKm: 4,  kind: "manmade" },

  // ===== Volcanoes =====
  { id: "vesuvius",       name: "Mt. Vesuvius",        emoji: "🌋", lat: 40.8224, lon:  14.4289, zoomKm: 12, kind: "natural" },
  { id: "etna",           name: "Mt. Etna",            emoji: "🌋", lat: 37.7510, lon:  14.9934, zoomKm: 14, kind: "natural" },
  { id: "krakatoa",       name: "Krakatoa",            emoji: "🌋", lat: -6.1023, lon: 105.4233, zoomKm: 14, kind: "natural" },
  { id: "cotopaxi",       name: "Cotopaxi",            emoji: "🌋", lat: -0.6772, lon: -78.4366, zoomKm: 14, kind: "natural" },
  { id: "mt-erebus",      name: "Mt. Erebus (Antarctica)", emoji: "🌋", lat: -77.5300, lon: 167.1500, zoomKm: 18, kind: "natural" },
  { id: "kilauea",        name: "Kīlauea (Hawaii)",    emoji: "🌋", lat: 19.4072, lon:-155.2834, zoomKm: 14, kind: "natural" },
  { id: "mt-st-helens",   name: "Mt. St. Helens",      emoji: "🌋", lat: 46.1912, lon:-122.1944, zoomKm: 14, kind: "natural" },

  // ===== Deserts / unique landscapes =====
  { id: "atacama",        name: "Atacama Desert",      emoji: "🏜", lat: -24.5000,lon: -69.2500, zoomKm: 600, kind: "natural" },
  { id: "gobi",           name: "Gobi Desert",         emoji: "🏜", lat: 42.7960, lon: 105.0324, zoomKm: 1500,kind: "natural" },
  { id: "namib",          name: "Namib Desert",        emoji: "🏜", lat: -24.5000,lon:  15.0000, zoomKm: 600, kind: "natural" },
  { id: "salar-uyuni",    name: "Salar de Uyuni",      emoji: "🧂", lat: -20.1338,lon: -67.4891, zoomKm: 80,  kind: "natural" },
  { id: "death-valley",   name: "Death Valley",        emoji: "🏜", lat: 36.5054, lon:-117.0794, zoomKm: 80,  kind: "natural" },
  { id: "wadi-rum",       name: "Wadi Rum",            emoji: "🏜", lat: 29.5765, lon:  35.4206, zoomKm: 30,  kind: "natural" },

  // ===== Lakes / rivers / oceans =====
  { id: "baikal",         name: "Lake Baikal",         emoji: "🌊", lat: 53.5587, lon: 108.1650, zoomKm: 600, kind: "natural" },
  { id: "tanganyika",     name: "Lake Tanganyika",     emoji: "🌊", lat: -6.5000, lon:  29.5000, zoomKm: 600, kind: "natural" },
  { id: "titicaca",       name: "Lake Titicaca",       emoji: "🌊", lat: -15.7500,lon: -69.5000, zoomKm: 200, kind: "natural" },
  { id: "crater-lake",    name: "Crater Lake",         emoji: "🌊", lat: 42.9446, lon:-122.1090, zoomKm: 14,  kind: "natural" },
  { id: "tahoe",          name: "Lake Tahoe",          emoji: "🌊", lat: 39.0968, lon:-120.0324, zoomKm: 30,  kind: "natural" },
  { id: "great-blue-hole",name: "Great Blue Hole (Belize)", emoji: "🐠", lat: 17.3157, lon: -87.5343, zoomKm: 4, kind: "natural" },
  { id: "galapagos",      name: "Galápagos Islands",   emoji: "🐢", lat: -0.6666, lon: -90.5500, zoomKm: 200, kind: "natural" },
  { id: "lake-louise",    name: "Lake Louise (Banff)", emoji: "🏔", lat: 51.4254, lon:-116.1773, zoomKm: 8,   kind: "natural" },

  // ===== Caves & geological wonders =====
  { id: "son-doong",      name: "Hang Sơn Đoòng (Vietnam)", emoji: "🪨", lat: 17.4538, lon: 106.2880, zoomKm: 4, kind: "natural" },
  { id: "mammoth-cave",   name: "Mammoth Cave",        emoji: "🪨", lat: 37.1862, lon:  -86.1000, zoomKm: 4,  kind: "natural" },
  { id: "antelope-canyon",name: "Antelope Canyon",     emoji: "🪨", lat: 36.8619, lon:-111.3743, zoomKm: 1.5, kind: "natural" },
  { id: "devils-tower",   name: "Devils Tower",        emoji: "🪨", lat: 44.5902, lon:-104.7146, zoomKm: 4,   kind: "natural" },
  { id: "wave-rock",      name: "Wave Rock (Australia)",emoji: "🪨", lat: -32.4434,lon: 118.8975, zoomKm: 1.5, kind: "natural" },
  { id: "meteor-crater",  name: "Barringer Meteor Crater", emoji: "🪨", lat: 35.0270, lon:-111.0227, zoomKm: 4, kind: "natural" },
  { id: "stone-forest",   name: "Stone Forest (China)",emoji: "🪨", lat: 24.8167, lon: 103.3333, zoomKm: 8,   kind: "natural" },
  { id: "old-faithful",   name: "Old Faithful Geyser", emoji: "♨️", lat: 44.4605, lon:-110.8281, zoomKm: 1.5, kind: "natural" },

  // ===== Ice =====
  { id: "antarctica-peninsula", name: "Antarctic Peninsula", emoji: "🧊", lat: -65.0000, lon: -64.0000, zoomKm: 600, kind: "natural" },
  { id: "greenland-icecap",     name: "Greenland Ice Sheet", emoji: "🧊", lat:  72.0000, lon: -42.0000, zoomKm: 1500, kind: "natural" },
  { id: "perito-moreno",  name: "Perito Moreno Glacier", emoji: "🧊", lat: -50.4961, lon: -73.0510, zoomKm: 30, kind: "natural" },
  { id: "jokulsarlon",    name: "Jökulsárlón Lagoon",  emoji: "🧊", lat: 64.0784, lon: -16.2306, zoomKm: 14, kind: "natural" },

  // ===== Cultural / religious / ancient =====
  { id: "alhambra",       name: "Alhambra",            emoji: "🕌", lat: 37.1773, lon:  -3.5879, zoomKm: 1.5, kind: "manmade" },
  { id: "forbidden-city", name: "Forbidden City",      emoji: "🛕", lat: 39.9163, lon: 116.3972, zoomKm: 2,   kind: "manmade" },
  { id: "versailles",     name: "Palace of Versailles",emoji: "🏛", lat: 48.8049, lon:   2.1204, zoomKm: 2,   kind: "manmade" },
  { id: "neuschwanstein", name: "Neuschwanstein Castle",emoji: "🏰", lat: 47.5576, lon:  10.7498, zoomKm: 2,  kind: "manmade" },
  { id: "edinburgh-castle",name: "Edinburgh Castle",   emoji: "🏰", lat: 55.9486, lon:  -3.1999, zoomKm: 2,   kind: "manmade" },
  { id: "mont-saint-michel",name: "Mont Saint-Michel", emoji: "🏰", lat: 48.6361, lon:  -1.5114, zoomKm: 2,   kind: "manmade" },
  { id: "sagrada-familia",name: "Sagrada Família",     emoji: "⛪", lat: 41.4036, lon:   2.1744, zoomKm: 1.5, kind: "manmade" },
  { id: "notre-dame",     name: "Notre-Dame de Paris", emoji: "⛪", lat: 48.8530, lon:   2.3499, zoomKm: 1.5, kind: "manmade" },
  { id: "western-wall",   name: "Western Wall",        emoji: "🕍", lat: 31.7767, lon:  35.2345, zoomKm: 1.5, kind: "manmade" },
  { id: "potala-palace",  name: "Borobudur Temple",    emoji: "🛕", lat:  -7.6079, lon: 110.2038, zoomKm: 1.5, kind: "manmade" },
  { id: "ayasofya",       name: "Blue Mosque",         emoji: "🕌", lat: 41.0054, lon:  28.9768, zoomKm: 1.5, kind: "manmade" },
  { id: "leshan-buddha",  name: "Leshan Giant Buddha", emoji: "🛕", lat: 29.5446, lon: 103.7716, zoomKm: 1.5, kind: "manmade" },

  // ===== Modern architecture =====
  { id: "marina-bay-sands", name: "Marina Bay Sands",  emoji: "🏙", lat:  1.2834, lon: 103.8607, zoomKm: 2,   kind: "manmade" },
  { id: "burj-al-arab",   name: "Burj Al Arab",        emoji: "🏙", lat: 25.1412, lon:  55.1853, zoomKm: 1.5, kind: "manmade" },
  { id: "one-wtc",        name: "One World Trade Center",emoji: "🏙", lat: 40.7127, lon: -74.0134, zoomKm: 1.5, kind: "manmade" },
  { id: "shard-london",   name: "The Shard (London)",  emoji: "🏙", lat: 51.5045, lon:  -0.0865, zoomKm: 1.5, kind: "manmade" },
  { id: "petronas-towers",name: "Petronas Towers",     emoji: "🏙", lat:  3.1579, lon: 101.7114, zoomKm: 1.5, kind: "manmade" },
  { id: "tokyo-skytree",  name: "Tokyo Skytree",       emoji: "🗼", lat: 35.7101, lon: 139.8107, zoomKm: 1.5, kind: "manmade" },
  { id: "cn-tower",       name: "CN Tower (Toronto)",  emoji: "🗼", lat: 43.6426, lon: -79.3871, zoomKm: 1.5, kind: "manmade" },

  // ===== Engineering megaprojects =====
  { id: "panama-canal",   name: "Panama Canal",        emoji: "🚢", lat:  9.0817, lon: -79.6800, zoomKm: 30,  kind: "manmade" },
  { id: "suez-canal",     name: "Suez Canal",          emoji: "🚢", lat: 30.5852, lon:  32.2658, zoomKm: 60,  kind: "manmade" },
  { id: "hoover-dam",     name: "Hoover Dam",          emoji: "🏗", lat: 36.0161, lon:-114.7377, zoomKm: 4,   kind: "manmade" },
  { id: "three-gorges",   name: "Three Gorges Dam",    emoji: "🏗", lat: 30.8233, lon: 111.0036, zoomKm: 8,   kind: "manmade" },
  { id: "akashi-kaikyo",  name: "Akashi-Kaikyō Bridge",emoji: "🌉", lat: 34.6164, lon: 135.0214, zoomKm: 4,   kind: "manmade" },
  { id: "golden-gate",    name: "Golden Gate Bridge",  emoji: "🌉", lat: 37.8199, lon:-122.4783, zoomKm: 2,   kind: "manmade" },
  { id: "channel-tunnel", name: "Channel Tunnel (Folkestone end)", emoji: "🚇", lat: 51.0862, lon: 1.1336, zoomKm: 4, kind: "manmade" },
  { id: "burj-tower-fall",name: "Itaipu Dam",          emoji: "🏗", lat: -25.4080,lon: -54.5887, zoomKm: 8,   kind: "manmade" },

  // ===== Memorials / poignant historical =====
  { id: "auschwitz",      name: "Auschwitz Memorial",  emoji: "🕯", lat: 50.0359, lon:  19.1783, zoomKm: 4,   kind: "manmade" },
  { id: "hiroshima-peace",name: "Hiroshima Peace Park",emoji: "🕊", lat: 34.3955, lon: 132.4536, zoomKm: 1.5, kind: "manmade" },
  { id: "robben-island",  name: "Robben Island",       emoji: "🕊", lat: -33.8074,lon:  18.3666, zoomKm: 4,   kind: "manmade" },

  // ===== Sports / cultural icons =====
  { id: "maracana",       name: "Maracanã Stadium",    emoji: "⚽", lat: -22.9122,lon: -43.2302, zoomKm: 1.5, kind: "manmade" },
  { id: "wembley",        name: "Wembley Stadium",     emoji: "⚽", lat: 51.5560, lon:  -0.2796, zoomKm: 1.5, kind: "manmade" },

  // ===== Polar / extreme =====
  { id: "north-pole",     name: "Geographic North Pole",emoji: "📍", lat:  89.99, lon:    0.00,  zoomKm: 200, kind: "natural" },
  { id: "south-pole",     name: "Geographic South Pole",emoji: "📍", lat: -89.99, lon:    0.00,  zoomKm: 200, kind: "natural" },
  { id: "challenger-deep",name: "Challenger Deep (Mariana)", emoji: "🌊", lat: 11.3733, lon: 142.5917, zoomKm: 60, kind: "natural" },
];
