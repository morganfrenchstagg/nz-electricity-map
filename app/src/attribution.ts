// Credit for the CC BY 4.0 data (the API's electricity data and transmission lines, LINZ's aerial
// imagery), shown in the map's attribution for every map style and in InfoModal
export const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/'

export const EMI = { name: 'Electricity Authority', url: 'https://www.ea.govt.nz/copyright-disclaimer-transparency/' }
export const TRANSPOWER = { name: 'Transpower New Zealand', url: 'https://www.transpower.co.nz' }
export const LINZ = { name: 'Toitū Te Whenua LINZ', url: 'https://www.linz.govt.nz/copyright' }
// Weather behind the distributed solar estimate. Credited only in InfoModal, as the map shows none of it.
export const OPEN_METEO = { name: 'Open-Meteo.com', url: 'https://open-meteo.com/' }

// For maplibre's attribution control, which takes HTML
const link = (url: string, text: string) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`
export const DATA_ATTRIBUTION_HTML = [
  link(EMI.url, EMI.name),
  link(TRANSPOWER.url, TRANSPOWER.name),
  link(LINZ.url, LINZ.name),
  link(CC_BY_URL, 'CC BY 4.0'),
].join(', ')
