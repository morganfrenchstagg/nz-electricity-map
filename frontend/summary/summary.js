import { displayMegawattsOrGigawatts, RENEWABLE_FUELS, FUELS_KEY, SKIP_LIST, formatFuel, getCurrentTimeInNZ } from '../utilities/units.js';
import { getLiveGenerationData } from '../utilities/api.js';

const waitakiGeneratorSiteCodes = ["TKA", "TKB", "OHA", "OHB", "OHC", "BEN", "AVI", "WTK"];
const waikatoHydroSiteCodes = ["ARA", "OHK", "ATI", "WKM", "MTI", "WPA", "ARI", "KPO"];
const manawatuWindSiteCodes = ["TAP", "TWF", "NZW", "TUR"];
//const waikeremoanaSiteCodes = ["KTW", "TUI", "PRI"];

let lastUpdated = "";
let isProd = (window.location.origin === 'https://electricitymap.frenchsta.gg');

isProd = true;

async function getStats() {
    var nzGeneration = 0;
    var nzCapacity = 0;

    var nzGenerationByFuel = {};
    var nzCapacityByFuel = {};

    var gridZoneGeneration = {};
    var gridZoneCapacity = {};

    var islandGeneration = {};
    var islandCapacity = {};

    var waitakiGenerators = 0;
    var waitakiCapacity = 0;

    var waikatoHydroGeneration = 0;
    var waikatoCapacity = 0;

    var manawatuWindGeneration = 0;
    var manawatuWindCapacity = 0;

    var niCapacityByFuel = {};
    var niGenerationByFuel = {};

    var siCapacityByFuel = {};
    var siGenerationByFuel = {};

    var status = document.getElementById("status");
    status.innerHTML = "Last Updated: .. minutes ago";

    const generationDataResponse = await fetch('https://api.electricitymap.frenchsta.gg/v1/dispatch/legacy/generators');
    const generationData = await generationDataResponse.json();

    var now = getCurrentTimeInNZ();
    var lastUpdatedDate = Date.parse(generationData.lastUpdate);
    var updatedMinutesAgo = Math.round((now - lastUpdatedDate) / 1000 / 60);
    var minutesAgoString = `${updatedMinutesAgo} minutes ago`;

    status.innerHTML = `Last Updated: ${minutesAgoString}`;

    if (generationData.lastUpdate === lastUpdated) {
        return;
    }

    lastUpdated = generationData.lastUpdate;

    generationData.generators.forEach(generator => {
        if (SKIP_LIST.includes(generator.site)) return;

        var totalGeneration = 0;
        var totalCapacity = 0;

        generator.units.forEach(unit => {
            totalGeneration += unit.generation;
            totalCapacity += unit.capacity;

            if (generator.island === "NI") {
                setForFuel(unit.fuel, niGenerationByFuel, niCapacityByFuel, unit.generation, unit.capacity);
            } else if (generator.island === "SI") {
                setForFuel(unit.fuel, siGenerationByFuel, siCapacityByFuel, unit.generation, unit.capacity);
            }

            setForFuel(unit.fuel, nzGenerationByFuel, nzCapacityByFuel, unit.generation, unit.capacity);
        })

        if (waitakiGeneratorSiteCodes.includes(generator.site)) {
            waitakiGenerators += totalGeneration;
            waitakiCapacity += totalCapacity;
        }

        if (waikatoHydroSiteCodes.includes(generator.site)) {
            waikatoHydroGeneration += totalGeneration;
            waikatoCapacity += totalCapacity;
        }

        if (manawatuWindSiteCodes.includes(generator.site)) {
            manawatuWindGeneration += totalGeneration;
            manawatuWindCapacity += totalCapacity;
        }

        nzGeneration += totalGeneration;
        nzCapacity += totalCapacity;

        addToObj(gridZoneGeneration, generator.gridZone, totalGeneration);
        addToObj(gridZoneCapacity, generator.gridZone, totalCapacity);

        addToObj(islandGeneration, generator.island, totalGeneration);
        addToObj(islandCapacity, generator.island, totalCapacity);
    });

    displayCurrentGenerationAndCapacity("ni-gen", islandGeneration.NI, islandCapacity.NI);
    displayCurrentGenerationAndCapacity("si-gen", islandGeneration.SI, islandCapacity.SI);
    displayCurrentGenerationAndCapacity("waitaki-gen", waitakiGenerators, waitakiCapacity);
    displayCurrentGenerationAndCapacity("waikato-gen", waikatoHydroGeneration, waikatoCapacity);
    displayCurrentGenerationAndCapacity("manawatu-gen", manawatuWindGeneration, manawatuWindCapacity);

    var gridZoneGenerationDiv = document.getElementById('grid-zones');
    gridZoneGenerationDiv.innerHTML = "";
    Object.keys(gridZoneGeneration).forEach(zone => {
        var zoneVal = gridZoneGeneration[zone];

        var zoneDiv = document.createElement('div');
        zoneDiv.textContent = zone + ": " + displayMegawattsOrGigawatts(zoneVal) + " / " + displayMegawattsOrGigawatts(gridZoneCapacity[zone]) + " (" + Math.round(zoneVal / gridZoneCapacity[zone] * 100) + "%)";

        gridZoneGenerationDiv.appendChild(zoneDiv);
    })

    var niGenByFuelTable = document.getElementById('ni-gen-by-fuel-table');
    niGenByFuelTable.innerHTML = "";

    Object.keys(niGenerationByFuel).sort((a, b) => niGenerationByFuel[b] - niGenerationByFuel[a]).forEach(fuel => {
        var newRow = niGenByFuelTable.insertRow();

        newRow.insertCell().appendChild(document.createTextNode(formatFuel(fuel)));
        newRow.insertCell().appendChild(document.createTextNode(displayMegawattsOrGigawatts(niGenerationByFuel[fuel])));
        newRow.insertCell().appendChild(document.createTextNode(displayMegawattsOrGigawatts(niCapacityByFuel[fuel])));
        newRow.insertCell().appendChild(document.createTextNode(Math.round(niGenerationByFuel[fuel] / islandGeneration.NI * 100) + "%"));
    });

    var siGenByFuelTable = document.getElementById('si-gen-by-fuel-table');
    siGenByFuelTable.innerHTML = "";
    Object.keys(siGenerationByFuel).sort((a, b) => siGenerationByFuel[b] - siGenerationByFuel[a]).forEach(fuel => {
        var newRow = siGenByFuelTable.insertRow();

        newRow.insertCell().appendChild(document.createTextNode(formatFuel(fuel)));
        newRow.insertCell().appendChild(document.createTextNode(displayMegawattsOrGigawatts(siGenerationByFuel[fuel])));
        newRow.insertCell().appendChild(document.createTextNode(displayMegawattsOrGigawatts(siCapacityByFuel[fuel])));
        newRow.insertCell().appendChild(document.createTextNode(Math.round(siGenerationByFuel[fuel] / islandGeneration.SI * 100) + "%"));
    });

    var nzGenByFuelTable = document.getElementById('nz-gen-by-fuel-table');
    nzGenByFuelTable.innerHTML = "";
    Object.keys(nzGenerationByFuel).sort((a, b) => nzGenerationByFuel[b] - nzGenerationByFuel[a]).forEach(fuel => {
        if (fuel === "Battery (Charging)") { return; }
        addGenerationRow(nzGenByFuelTable, formatFuel(fuel), nzGenerationByFuel[fuel], nzCapacityByFuel[fuel], nzGeneration);
    });

    addGenerationRow(nzGenByFuelTable, "Total Generation", nzGeneration, nzCapacity, nzGeneration, true);

    var renewableGeneration = 0;
    var renewableCapacity = 0;

    Object.keys(nzGenerationByFuel).forEach(fuel => {
        if (RENEWABLE_FUELS.includes(fuel)) {
            renewableGeneration += nzGenerationByFuel[fuel];
            renewableCapacity += nzCapacityByFuel[fuel];
        }
    });

    addGenerationRow(nzGenByFuelTable, "Renewables", renewableGeneration, renewableCapacity, nzGeneration);

    // Battery (charging) row
    addGenerationRow(nzGenByFuelTable, formatFuel(FUELS_KEY["BESS-C"]), nzGenerationByFuel[FUELS_KEY["BESS-C"]], nzCapacityByFuel[FUELS_KEY["BESS-C"]], nzGeneration);
}

function setForFuel(fuel, summaryGeneration, summaryCapacity, unitGeneration, unitCapacity) {
    if (summaryGeneration[fuel] === undefined) {
        summaryCapacity[fuel] = 0;
        summaryGeneration[fuel] = 0;
    }

    summaryCapacity[fuel] += unitCapacity;
    summaryGeneration[fuel] += unitGeneration;
}

function addGenerationRow(table, name, generation, capacity, totalGeneration, makeBold = false) {
    var newRow = table.insertRow();
    if (makeBold) {
        newRow.style.fontWeight = "bold";
        newRow.className = "table-info";
    }

    newRow.insertCell().appendChild(document.createTextNode(name));
    newRow.insertCell().appendChild(document.createTextNode(displayMegawattsOrGigawatts(generation)));
    newRow.insertCell().appendChild(document.createTextNode(displayMegawattsOrGigawatts(capacity)));
    newRow.insertCell().appendChild(document.createTextNode(Math.round(generation / capacity * 100) + "%"));
    newRow.insertCell().appendChild(document.createTextNode(Math.round(generation / totalGeneration * 100) + "%"));
}

function displayCurrentGenerationAndCapacity(spanId, generation, capacity) {
    var genSpan = document.getElementById(spanId);
    genSpan.textContent = displayMegawattsOrGigawatts(generation) + " / " + displayMegawattsOrGigawatts(capacity) + " (" + Math.round(generation / capacity * 100) + "%)";
}

function addToObj(obj, key, value) {
    if (obj[key] === undefined) {
        obj[key] = value;
    } else {
        obj[key] += value;
    }
}

getStats();
window.setInterval(() => getStats(), 30000);