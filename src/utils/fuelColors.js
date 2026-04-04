// Fuel type color indicators for visual identification
const FUEL_COLORS = {
  // Gasoline / Petrol — greens
  SP95: '#86efac', E10: '#86efac', E5: '#86efac', e5: '#86efac', e10: '#86efac',
  gasolina95: '#86efac', gasolina93: '#86efac', euro95: '#86efac',
  regular: '#86efac', ULP: '#86efac', ULP93: '#86efac', ULP95: '#86efac',
  unleaded: '#86efac', RON95: '#86efac', B027: '#86efac', '91': '#86efac',
  nafta_super: '#86efac', gasolina: '#86efac', benzina: '#86efac', E95: '#86efac',
  unleaded_95: '#86efac', SUP: '#86efac', eurosuper95: '#86efac', eurosuper100: '#2d6a4f', gasolina_95: '#86efac',
  petrol: '#86efac', gasoline_95: '#86efac',
  // Premium gasoline — dark green
  SP98: '#2d6a4f', gasolina98: '#2d6a4f', gasolina97: '#2d6a4f', E98: '#2d6a4f',
  super_unleaded: '#2d6a4f', PULP95: '#2d6a4f', PULP98: '#2d6a4f',
  premium: '#2d6a4f', nafta_premium: '#2d6a4f', gasolina_ad: '#2d6a4f',
  B034: '#2d6a4f', RON97: '#2d6a4f', P95: '#2d6a4f', P98: '#2d6a4f',
  '95': '#86efac', '98': '#2d6a4f', special95: '#2d6a4f', super98: '#2d6a4f',
  unleaded_100: '#2d6a4f', U91: '#2d6a4f',
  // Diesel — orange
  Gazole: '#f59e0b', diesel: '#f59e0b', Diesel: '#f59e0b', gasoleo: '#f59e0b',
  gasolio: '#f59e0b', GOE: '#f59e0b', DIE: '#f59e0b', D047: '#f59e0b', DL: '#f59e0b',
  diesel_extra: '#f59e0b', diesel_premium: '#f59e0b', diesel_50: '#f59e0b',
  diesel_500: '#f59e0b', eurodizel: '#f59e0b', dizel: '#f59e0b',
  gasoleo_especial: '#f59e0b', 'dizel-premium': '#f59e0b',
  // LPG / Gas — purple
  GPLc: '#a78bfa', glp: '#a78bfa', gpl: '#a78bfa', GPL: '#a78bfa',
  LPG: '#a78bfa', lpg: '#a78bfa', GAS: '#a78bfa', gnv: '#a78bfa', gnc: '#a78bfa',
  metano: '#a78bfa', K015: '#a78bfa', 'avtoplin-lpg': '#a78bfa', cng: '#a78bfa',
  // E85 — sky blue
  E85: '#38bdf8',
  // Ethanol — cyan
  etanol: '#22d3ee', eplus91: '#22d3ee',
};

export function getFuelColor(fuelId) {
  return FUEL_COLORS[fuelId] || '#9ca3af';
}
