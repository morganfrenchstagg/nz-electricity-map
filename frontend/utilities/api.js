import { getCurrentTimeInNZ } from "./units.js";

var statusSpan = document.getElementById("graph-status");

let localUrl = (path) => `http://[::]:8000/backend/output/${path}`;
let prodUrl = (path) => `https://api.frenchsta.gg/v1/${path}`;

let isProd = (new URLSearchParams(window.location.search)).get('local') !== 'true';

let timeseriesGenerationDataCache = {};
let timeseriesPriceDataCache = {};

export async function fetchJson(path) {
    let data = {};

    if (isProd) {
        data = await fetch(prodUrl(path));
    } else {
        data = await fetch(localUrl(path));
    }

    if (data.status === 200) {
        return data.json();
    }

    return {};
}

function formatDate(date) {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

const spinnerHtml = '<div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">Loading...</span></div>';

export async function getTimeseriesGenerationData(date) {
    var currentTimeFormatted = formatDate(getCurrentTimeInNZ());
    var dateStr = formatDate(date);

    if (timeseriesGenerationDataCache[dateStr] && (dateStr != currentTimeFormatted)) {
        return timeseriesGenerationDataCache[dateStr];
    }

    statusSpan.innerHTML = `${spinnerHtml} Fetching data for ${date.toLocaleDateString('en-NZ')}`;

    const response = await fetch(`https://api.electricitymap.frenchsta.gg/v1/dispatch/legacy/history/generation/${dateStr}`)
    const json = response.json();

    timeseriesGenerationDataCache[dateStr] = json;

    return json;
}

export async function getTimeseriesPriceData(date) {
    var currentTimeFormatted = formatDate(getCurrentTimeInNZ());
    var dateStr = formatDate(date);

    if (timeseriesPriceDataCache[dateStr] && (dateStr != currentTimeFormatted)) {
        return timeseriesPriceDataCache[dateStr];
    }

    var dateStr = formatDate(date);
    const response = await fetch(`https://api.electricitymap.frenchsta.gg/v1/dispatch/legacy/history/price/${dateStr}`);
    const json = response.json();

    timeseriesPriceDataCache[dateStr] = json;

    return json;
}

export async function getLiveGenerationData() {
    const response = await fetch('https://api.electricitymap.frenchsta.gg/v1/dispatch/legacy/generators');

    return response.json();
}

export async function getTimeseriesOfferData(date) {
    console.log(date);
    var dateStr = formatDate(date);
    const result = fetch(`https://api.electricitymap.frenchsta.gg/v1/offers/${dateStr}`);
    return (await result).json();
}
