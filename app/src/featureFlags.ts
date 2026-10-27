// Features not yet shown to everyone, each switched on by its own query param.
// useUrlState keeps params it doesn't know in the URL, so a flag stays on as
// the app's own params change.
const params = new URLSearchParams(window.location.search)

// ?substationSolar=true: the substation panel's distributed solar estimate
export const SUBSTATION_SOLAR = params.get('substationSolar') === 'true'
