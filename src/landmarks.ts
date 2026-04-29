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
];
