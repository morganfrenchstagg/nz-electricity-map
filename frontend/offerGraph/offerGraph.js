import { buildSupplyCurveWithMetadata, getSupplyCurveTooltip } from './offerSupplyCurve.js';
import { getLiveGenerationData, getTimeseriesOfferData } from '../utilities/api.js';
import { getCurrentTimeInNZ } from '../utilities/units.js';

const powerStationFilterDropdown = document.getElementById('power-station-select');
const regionSelectDropdown = document.getElementById('region-select');
const clearButton = document.getElementById('clear-button');
const statusSpan = document.getElementById("graph-status");

let currentDate = new Date();
let currentTradingPeriod = 1;
let allOfferData = {};
let liveGenData = null;

regionSelectDropdown.addEventListener('change', () => onRegionDropdownSelect(regionSelectDropdown));
powerStationFilterDropdown.addEventListener('change', () => onGeneratorDropdownSelect(powerStationFilterDropdown));
clearButton.addEventListener('click', () => onClearButtonSelect());

async function onGeneratorDropdownSelect(dropdownObject) {
    var selectedSiteCode = dropdownObject.options[dropdownObject.selectedIndex].value;
    setQueryParam("site", selectedSiteCode);
    updateSupplyCurve();
}

async function onRegionDropdownSelect(dropdownObject) {
    var selectedRegion = dropdownObject.options[dropdownObject.selectedIndex].value;

    if (selectedRegion.length === 2) {
        setQueryParam("site", "");
        setQueryParam("island", selectedRegion);
        setQueryParam("zone", "");
    } else if (selectedRegion.length === 3) {
        setQueryParam("site", "");
        setQueryParam("island", "");
        setQueryParam("zone", selectedRegion);
    } else {
        setQueryParam("island", "");
        setQueryParam("zone", "");
    }

    updateSupplyCurve();
}

function setQueryParam(param, value) {
    var searchParams = new URLSearchParams(window.location.search);

    if (value === "") {
        searchParams.delete(param);
    } else {
        searchParams.set(param, value);
    }

    var newRelativePathQuery = window.location.pathname + '?' + searchParams.toString();
    history.replaceState(null, '', newRelativePathQuery);
}

function onClearButtonSelect() {
    window.location.search = "";
}

function setGeneratorDropdown(liveGenData, zoneToFilterTo = [], islandToFilterTo = []) {
    let sortedGenerationData = liveGenData.generators.sort((a, b) => a.name.localeCompare(b.name));

    powerStationFilterDropdown.innerHTML = "";
    var defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.innerHTML = "Select Power Station";
    powerStationFilterDropdown.appendChild(defaultOption);

    sortedGenerationData.forEach(generator => {
        var thisUnitFuels = [];

        generator.units.forEach(unit => {
            let unitFuel = unit.fuel;
            if (unitFuel === "Battery (Charging)" || unitFuel === "Battery (Discharging)") {
                unitFuel = "Battery";
            }

            if (!thisUnitFuels.includes(unitFuel)) {
                thisUnitFuels.push(unitFuel);
            }
        });

        var opt = document.createElement("option");
        opt.value = generator.site;
        opt.innerHTML = `${generator.name} (${thisUnitFuels.join(", ")})`;

        if (zoneToFilterTo.length > 0 && !zoneToFilterTo.includes(generator.gridZone)) {
            return;
        }

        if (islandToFilterTo.length > 0 && !islandToFilterTo.includes(generator.island)) {
            return;
        }

        powerStationFilterDropdown.appendChild(opt);
    });
}

async function loadData() {
    statusSpan.innerHTML = "Loading data...";

    // Get filters from URL
    const searchParams = new URLSearchParams(window.location.search);
    const dateParam = searchParams.get("date");
    const periodParam = searchParams.get("period");

    if (dateParam) {
        currentDate = new Date(dateParam);
    }
    if (periodParam) {
        currentTradingPeriod = parseInt(periodParam);
    }

    // Load live generator data for site info
    liveGenData = await getLiveGenerationData();

    // Load offer data for the selected date
    allOfferData = await getTimeseriesOfferData(currentDate);

    const islandToFilterTo = searchParams.get("island")?.split(',') || [];
    const zoneToFilterTo = searchParams.get("zone")?.split(',') || [];

    setGeneratorDropdown(liveGenData, zoneToFilterTo, islandToFilterTo);

    updateSupplyCurve();
}

function updateSupplyCurve() {
    const searchParams = new URLSearchParams(window.location.search);
    const siteToFilterTo = searchParams.get("site")?.split(',') || [];
    const islandToFilterTo = searchParams.get("island")?.split(',') || [];
    const zoneToFilterTo = searchParams.get("zone")?.split(',') || [];

    // Get the timestamp for the current trading period
    const timestamps = Object.keys(allOfferData);
    if (timestamps.length === 0) {
        statusSpan.innerHTML = "No offer data available";
        return;
    }

    // Use the first timestamp for now (we'll add period selector later)
    const currentTimestamp = timestamps[currentTradingPeriod - 1] || timestamps[0];
    const offersForPeriod = allOfferData[currentTimestamp];

    if (!offersForPeriod) {
        statusSpan.innerHTML = "No offers for this period";
        return;
    }

    // Build supply curve data
    const seriesData = buildSupplyCurveWithMetadata(
        offersForPeriod,
        liveGenData,
        siteToFilterTo,
        islandToFilterTo,
        zoneToFilterTo
    );

    // Create the chart
    const date = new Date(currentTimestamp);
    const title = `Electricity Supply Curve - ${date.toLocaleDateString('en-NZ')} ${date.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: 'numeric' })}`;

    Highcharts.chart('generation-chart', {
        chart: {
            type: 'line',
            zoomType: 'xy'
        },
        title: {
            text: title
        },
        subtitle: {
            text: 'Trading Period ' + currentTradingPeriod
        },
        xAxis: {
            title: {
                text: 'Cumulative Capacity (MW)'
            },
            labels: {
                format: '{value} MW'
            }
        },
        yAxis: {
            title: {
                text: 'Price ($/MWh)'
            },
            labels: {
                format: '${value}'
            }
        },
        tooltip: {
            formatter: getSupplyCurveTooltip,
            shared: false
        },
        legend: {
            enabled: false
        },
        plotOptions: {
            series: {
                findNearestPointBy: 'xy',
                states: {
                    inactive: {
                        opacity: 1
                    }
                }
            }
        },
        series: seriesData,
        credits: {
            enabled: false
        }
    });

    statusSpan.innerHTML = `Showing Trading Period ${currentTradingPeriod}`;
}

// Initialize
loadData();
