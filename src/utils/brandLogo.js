/**
 * Maps fuel station brand names to logo URLs.
 * Logos are served via the unified Cloudflare Worker (/logo/{domain})
 * which proxies from Uplead/Google with CORS headers and KV caching.
 */

const WORKER_URL = import.meta.env.VITE_WORKER_URL;

// Brand name (lowercase) → website domain
const BRAND_DOMAINS = {
  // Global / multi-country
  totalenergies: 'totalenergies.com',
  total: 'totalenergies.com',
  shell: 'shell.com',
  bp: 'bp.com',
  esso: 'esso.com',
  exxonmobil: 'exxonmobil.com',
  mobil: 'exxonmobil.com',
  avia: 'avia-international.com',

  // France
  leclerc: 'e.leclerc',
  carrefour: 'carrefour.fr',
  'carrefour market': 'carrefour.fr',
  'carrefour contact': 'carrefour.fr',
  'intermarche': 'intermarche.com',
  'intermarch\u00E9': 'intermarche.com',
  auchan: 'auchan.fr',
  'systeme u': 'magasins-u.com',
  'super u': 'magasins-u.com',
  'casino': 'groupe-casino.fr',
  neste: 'neste.com',
  'oil!': 'oil-tankstellen.ch',

  // Germany
  aral: 'aral.de',
  jet: 'jet.de',
  star: 'star.de',
  agip: 'eni.com',
  hoyer: 'hoyer-energie.de',
  westfalen: 'westfalen.com',
  classic: 'classic-oil.de',
  hem: 'hem-tankstelle.de',
  orlen: 'orlen.de',

  // UK
  tesco: 'tesco.com',
  "sainsbury's": 'sainsburys.co.uk',
  sainsburys: 'sainsburys.co.uk',
  asda: 'asda.com',
  morrisons: 'morrisons.com',
  texaco: 'texaco.com',
  murco: 'murco.co.uk',

  // Spain
  repsol: 'repsol.com',
  cepsa: 'cepsa.com',
  galp: 'galp.com',
  petronor: 'petronor.com',
  ballenoil: 'ballenoil.es',
  bonarea: 'bonarea.com',
  plenoil: 'plenoil.es',
  plenergy: 'plenergy.es',
  moeve: 'moeve.com',
  petroprix: 'petroprix.com',
  eroski: 'eroski.es',
  alcampo: 'alcampo.es',
  meroil: 'meroil.es',
  star: 'star.es',
  'star petroleum': 'star.es',
  dyneff: 'dyneff.es',
  disa: 'disa.com',
  'euskadi low cost': 'euskadilowcost.com',
  easygas: 'easygas.es',
  scat: 'scat.es',
  'gm oil': 'gmoil.com',
  campsa: 'campsa.es',
  'campsa express': 'campsa.es',
  gasexpress: 'gasexpress.es',
  costco: 'costco.es',
  petrocat: 'petrocat.es',
  'full & go': 'fullgo.es',
  nafte: 'nafte.es',
  'confort auto': 'confortauto.com',
  minioil: 'minioil.es',
  autonetoil: 'autonetoil.com',
  hafesa: 'hafesa.es',
  valcarce: 'valcarce.com',
  'avanza energy': 'avanzaenergy.es',
  'avanza low cost': 'avanzaenergy.es',
  'gv oil': 'gvoil.es',
  'b-oil': 'b-oil.es',
  oilprix: 'oilprix.es',
  'petrol & go': 'petrolandgo.com',
  fueling: 'fueling.es',
  'fast fuel': 'fastfuel.es',
  atlantis: 'atlantisexpress.es',
  'canary oil': 'canaryoil.es',
  dinergia: 'dinergia.com',
  'asc carburantes': 'asccarburantes.es',
  ecobenz: 'ecobenz.es',
  alsa: 'alsa.es',
  texako: 'texaco.com',
  carrrefour: 'carrefour.fr',
  'smile oil': 'smileoil.es',
  gax: 'gax.es',

  // Italy
  eni: 'eni.com',
  ip: 'gruppoapi.com',
  'api-ip': 'gruppoapi.com',
  q8: 'q8.it',
  totalerg: 'totalenergies.com',
  tamoil: 'tamoil.it',
  api: 'gruppoapi.com',

  // Switzerland
  migrol: 'migrol.ch',
  coop: 'coop.ch',
  'coop pronto': 'coop.ch',
  agrola: 'agrola.ch',
  socar: 'socar.com',
  'ruedi r\u00FCssel': 'ruedirussel.ch',
  ruedirussel: 'ruedirussel.ch',
  'ruedi russel': 'ruedirussel.ch',
  miniprix: 'miniprix.ch',
  midland: 'midland.ch',

  // Netherlands
  tinq: 'tinq.nl',
  tango: 'tango.nl',
  argos: 'argos-energies.nl',
  makro: 'makro.nl',
  lukoil: 'lukoil.com',
  ok: 'ok.nl',
  fieten: 'fietenoliehandel.nl',
  supertank: 'supertank.nl',

  // Belgium
  'dats 24': 'dats24.be',
  dats24: 'dats24.be',
  'octa+': 'octaplus.be',
  gabriels: 'gabriels.be',

  // Ireland
  'circle k': 'circlek.com',
  applegreen: 'applegreenstores.com',
  maxol: 'maxol.ie',
  emo: 'emo.ie',
  amber: 'amberstation.ie',
  certa: 'certa.ie',
  campus: 'campus.ie',
  inver: 'inver.ie',
  'corrib oil': 'corriboil.com',
  go: 'goireland.ie',
  top: 'topaz.ie',

  // Norway
  'uno-x': 'unox.no',
  'uno x': 'unox.no',
  yx: 'yx.no',
  best: 'best.no',
  'automat 1': 'automat1.no',
  'bunker oil': 'bunkeroil.no',

  // Sweden
  okq8: 'okq8.se',
  preem: 'preem.se',
  st1: 'st1.se',
  tanka: 'tanka.se',
  ingo: 'ingo.se',
  qstar: 'qstar.se',
  'q-star': 'qstar.se',

  // Baltic States
  alexela: 'alexela.ee',
  terminal: 'terminaloil.ee',
  olerex: 'olerex.ee',
  krooning: 'krooning.ee',
  viada: 'viada.lt',
  virsi: 'virsi.lv',
  astarte: 'astarte.lv',
  gotika: 'gotika.lv',
  emsi: 'emsi.lt',

  // Poland
  moya: 'moya.pl',
  lotos: 'lotos.pl',
  amic: 'amic.pl',

  // Croatia
  ina: 'ina.hr',
  tifon: 'tifon.hr',
  crodux: 'crodux.hr',

  // Slovenia
  petrol: 'petrol.si',
  mol: 'molgroup.info',
  euroil: 'euroil.si',

  // Portugal
  prio: 'prio.pt',
  'oz energia': 'ozenergia.pt',

  // Austria
  omv: 'omv.com',
  avanti: 'avanti.at',
  'turm\u00F6l': 'turmoel.at',
  iq: 'iq-energy.at',

  // South Korea
  'sk energy': 'skenergy.com',
  'gs caltex': 'gscaltex.com',
  's-oil': 's-oil.com',
  'hyundai oilbank': 'oilbank.co.kr',

  // Chile
  copec: 'copec.cl',
  terpel: 'terpel.com',
  enex: 'enex.cl',
  aramco: 'aramco.com',
  gasco: 'gasco.cl',
  okey: 'okey.cl',

  // Australia
  caltex: 'caltex.com.au',
  '7-eleven': '7eleven.com.au',
  united: 'unitedpetroleum.com.au',
  'coles express': 'coles.com.au',
  woolworths: 'woolworths.com.au',
  ampol: 'ampol.com.au',

  // UAE
  adnoc: 'adnoc.ae',
  enoc: 'enoc.com',
  eppco: 'eppco.ae',
  emarat: 'emarat.ae',

  // Mexico
  pemex: 'pemex.com',
  'oxxo gas': 'oxxo.com',
  oxxo: 'oxxo.com',
  g500: 'g500.mx',
  arco: 'arco.com',
  chevron: 'chevron.com',
  hidrosina: 'hidrosina.com.mx',
  rendichicas: 'rendichicas.com.mx',
  valero: 'valero.com',
  marathon: 'marathonpetroleum.com',
  '76': '76.com',

  // Brazil
  petrobras: 'petrobras.com.br',
  ipiranga: 'ipiranga.com.br',
  ale: 'ale.com.br',
  vibra: 'vibraenergia.com.br',

  // Argentina
  ypf: 'ypf.com',
  'axion energy': 'axionenergy.com',
  axion: 'axionenergy.com',
  puma: 'pumaenergy.com',
  gulf: 'gulfoil.com',
  dapsa: 'dapsa.com.ar',
  refinor: 'refinor.com.ar',
  voy: 'voyconenergia.com',

  // Turkey
  'petrol ofisi': 'petrolofisi.com.tr',
  opet: 'opet.com.tr',
  aytemiz: 'aytemiz.com.tr',
  tp: 'tppetrol.com.tr',
  alpet: 'alpet.com.tr',
  kadoil: 'kadoil.com.tr',
};

// Direct logo URLs for brands where the domain-based proxy doesn't work well
const BRAND_DIRECT_LOGOS = {
  leclerc: 'https://upload.wikimedia.org/wikipedia/commons/e/ed/Logo_E.Leclerc_Sans_le_texte.svg',
  'intermarch': 'https://play-lh.googleusercontent.com/y8py7OoxNFqBibg-CZrmIACpVLocBOa7yy3U4F3S8G6Fqjljb7g8w-y4WhaGKtAbKzk',
};

const LOGO_CACHE = new Map();

/**
 * Get a logo URL for a fuel station brand.
 * Returns null if brand is unknown.
 */
export function getBrandLogoUrl(brand) {
  if (!brand) return null;

  const key = brand.toLowerCase().trim();
  if (LOGO_CACHE.has(key)) return LOGO_CACHE.get(key);

  // Check direct logo overrides first
  for (const [brandKey, directUrl] of Object.entries(BRAND_DIRECT_LOGOS)) {
    if (key === brandKey || key.includes(brandKey)) {
      LOGO_CACHE.set(key, directUrl);
      return directUrl;
    }
  }

  // Try exact match first
  let domain = BRAND_DOMAINS[key];

  // Try partial match (e.g. "TotalEnergies Access" → "totalenergies")
  if (!domain) {
    for (const [brandKey, d] of Object.entries(BRAND_DOMAINS)) {
      if (key.includes(brandKey) || brandKey.includes(key)) {
        domain = d;
        break;
      }
    }
  }

  if (!domain) {
    LOGO_CACHE.set(key, null);
    return null;
  }

  const url = WORKER_URL
    ? `${WORKER_URL}/logo/${domain}?v=2`
    : `https://logo.clearbit.com/${domain}?size=64`;

  LOGO_CACHE.set(key, url);
  return url;
}
