import { getCurrentTimeInNZ } from "./units.js";

var statusSpan = document.getElementById("graph-status");

let localUrl = (path) => `http://localhost:8080/backend/output/${path}`;
let prodUrl = (path) => `https://api.frenchsta.gg/v1/${path}`;

let isProd = false;

let timeseriesGenerationDataCache = {};

export async function fetchJson(path){
    let data = {};

    if (isProd) {
        data = await fetch(prodUrl(path));
    } else {
        data = await fetch(localUrl(path));
    }

    if(data.status === 200){
        return data.json();
    }

    return {};
}

function formatDate(date){
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

const spinnerHtml = '<div class="spinner-border spinner-border-sm text-primary" role="status"><span class="visually-hidden">Loading...</span></div>';

export async function getTimeseriesGenerationData(date){
    var currentTimeFormatted = formatDate(getCurrentTimeInNZ());
    var dateStr = formatDate(date);

    if(timeseriesGenerationDataCache[dateStr] && (dateStr != currentTimeFormatted)){
        return timeseriesGenerationDataCache[dateStr];
    }

    statusSpan.innerHTML = `${spinnerHtml} Fetching data for ${date.toLocaleDateString('en-NZ')}`;

    if(!isProd){
        const response = await fetchJson(`5min/${dateStr}.json`)

        timeseriesGenerationDataCache[dateStr] = response;
        return response;
    }
    const response = await fetchJson(`generator-history/5-min/${dateStr}.json`)

    timeseriesGenerationDataCache[dateStr] = response;

    return response;
}

export async function getTimeseriesPriceData(date){
        var dateStr = formatDate(date);

    if(!isProd) {
        const response = await (fetchJson(`5min/${dateStr}.price.json`))

        return response;
    }
    const response = await (fetchJson(`generator-history/5-min/${dateStr}.price.json`))

    return response;
}

export async function getLiveGenerationData(){
    if (!isProd) {
        return fetchJson('generatorOutput.json');
    }

    return fetchJson('generators');
}

export async function getLiveSubstationData(){
    if (!isProd) {
        return fetchJson('substationOutput.json');
    }

    return fetchJson('nzgrid');
}

export async function getTimeseriesOfferData(date){
    let url;

    if (!isProd) {
        if (date) {
            const dateStr = formatDate(date);
            url = `http://localhost:8787/v1/offers/date?date=${dateStr}`;
        } else {
            url = `http://localhost:8787/v1/offers/date`;
        }
        const response = await fetch(url);
        if (response.status === 200) {
            return response.json();
        }
        return {};
    }

    // Production endpoint would be on Cloudflare Worker
    if (date) {
        const dateStr = formatDate(date);
        url = `https://sites-api.frenchsta.gg/v1/offers/date?date=${dateStr}`;
    } else {
        url = `https://sites-api.frenchsta.gg/v1/offers/date`;
    }
    const response = await fetch(url);
    if (response.status === 200) {
        return response.json();
    }
    return {};
}
