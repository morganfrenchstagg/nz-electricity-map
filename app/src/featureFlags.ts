// Unreleased features, each switched on by its own query param. useUrlState keeps unknown params
// in the URL, so a flag survives changes to the app's own.
const params = new URLSearchParams(window.location.search)

// ?substationSolar=true: the substation panel's distributed solar estimate
export const SUBSTATION_SOLAR = params.get('substationSolar') === 'true'
