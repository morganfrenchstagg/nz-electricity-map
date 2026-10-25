// Credit for the map's CC BY 4.0 data: the electricity data and transmission lines
// the API serves, and LINZ's aerial imagery. Credited in the map's attribution
// (whichever map style is showing) and in InfoModal.
export const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/'

export const EMI = { name: 'Electricity Authority', url: 'https://www.ea.govt.nz/copyright-disclaimer-transparency/' }
export const TRANSPOWER = { name: 'Transpower New Zealand', url: 'https://www.transpower.co.nz' }
export const LINZ = { name: 'Toitū Te Whenua LINZ', url: 'https://www.linz.govt.nz/copyright' }
// The weather the distributed solar estimate is made from. Only credited in
// InfoModal, as the map shows none of it.
export const OPEN_METEO = { name: 'Open-Meteo.com', url: 'https://open-meteo.com/' }

// For maplibre's attribution control, which takes HTML
const link = (url: string, text: string) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`
export const DATA_ATTRIBUTION_HTML = [
  link(EMI.url, EMI.name),
  link(TRANSPOWER.url, TRANSPOWER.name),
  link(LINZ.url, LINZ.name),
  link(CC_BY_URL, 'CC BY 4.0'),
].join(', ')
