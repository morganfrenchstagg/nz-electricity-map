import { buildSupplyCurveWithMetadata, getSupplyCurveTooltip } from './offerSupplyCurve.js';
import { getLiveGenerationData, getTimeseriesOfferData } from '../utilities/api.js';
import { getCurrentTimeInNZ } from '../utilities/units.js';

const powerStationFilterDropdown = document.getElementById('power-station-select');
const generatorFilterDropdown = document.getElementById('generator-select');
const tradingPeriodDropdown = document.getElementById('trading-period-select');
const clearButton = document.getElementById('clear-button');
const statusSpan = document.getElementById("graph-status");

let currentDate = new Date();
let currentTradingPeriod = 1;
let allOfferData = {};
let liveGenData = null;

generatorFilterDropdown.addEventListener('change', () => onGeneratorFilterDropdownSelect(generatorFilterDropdown));
powerStationFilterDropdown.addEventListener('change', () => onGeneratorDropdownSelect(powerStationFilterDropdown));
tradingPeriodDropdown.addEventListener('change', () => onTradingPeriodSelect(tradingPeriodDropdown));
clearButton.addEventListener('click', () => onClearButtonSelect());

async function onGeneratorDropdownSelect(dropdownObject) {
    var selectedSiteCode = dropdownObject.options[dropdownObject.selectedIndex].value;
    setQueryParam("site", selectedSiteCode);
    updateSupplyCurve();
}

async function onTradingPeriodSelect(dropdownObject) {
    var selectedTP = dropdownObject.options[dropdownObject.selectedIndex].value;
    setQueryParam("tp", selectedTP);
    currentTradingPeriod = parseInt(selectedTP);
    updateSupplyCurve();
}

async function onGeneratorFilterDropdownSelect(dropdownObject) {
    var selectedOperator = dropdownObject.options[dropdownObject.selectedIndex].value;
    setQueryParam("operator", selectedOperator);

    // Re-populate station dropdown with filtered operators
    const searchParams = new URLSearchParams(window.location.search);
    const zoneToFilterTo = searchParams.get("zone")?.split(',') || [];
    const operatorToFilterTo = selectedOperator ? [selectedOperator] : [];
    setStationDropdown(allOfferData, liveGenData, zoneToFilterTo, operatorToFilterTo);

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

function setStationDropdown(allOfferData, liveGenData, zoneToFilterTo = [], operatorToFilterTo = []) {
    const timestamps = Object.keys(allOfferData);
    const currentTimestamp = timestamps[currentTradingPeriod - 1] || timestamps[0];
    const generatorsBySite = new Map(liveGenData.generators.map(gen => [gen.site, gen]));
    const offersForPeriod = allOfferData[currentTimestamp];

    const uniqueSitesOffered = [...new Set(offersForPeriod.map(offer => offer.site))];

    let uniqueGenerators = uniqueSitesOffered
        .map(site => generatorsBySite.get(site))
        .filter(g => g !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name));

    powerStationFilterDropdown.innerHTML = "";
    var defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.innerHTML = "Select Power Station";
    powerStationFilterDropdown.appendChild(defaultOption);

    uniqueGenerators.forEach(generator => {
        // Apply filters
        if (zoneToFilterTo.length > 0 && !zoneToFilterTo.includes(generator.gridZone)) {
            return;
        }
        if (operatorToFilterTo.length > 0 && !operatorToFilterTo.includes(generator.operator)) {
            return;
        }

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

        powerStationFilterDropdown.appendChild(opt);
    });
}

function setTradingPeriodDropdown() {
    tradingPeriodDropdown.innerHTML = "";

    // Add default option
    var defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.innerHTML = "Select Trading Period";
    tradingPeriodDropdown.appendChild(defaultOption);

    // Add all 48 trading periods
    for (let i = 1; i <= 48; i++) {
        const periodStart = (i - 1) * 30;
        const hours = Math.floor(periodStart / 60);
        const minutes = periodStart % 60;
        const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

        var opt = document.createElement("option");
        opt.value = i;
        opt.innerHTML = `TP ${i} (${timeStr})`;

        if (i === currentTradingPeriod) {
            opt.selected = true;
        }

        tradingPeriodDropdown.appendChild(opt);
    }
}

function setOperatorDropdown(allOfferData, liveGenData) {
    // Clear dropdown first
    generatorFilterDropdown.innerHTML = "";

    // Add default option
    var defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.innerHTML = "Select Operator";
    generatorFilterDropdown.appendChild(defaultOption);

    // Early return if data is missing or empty
    if (!allOfferData || !liveGenData || !liveGenData.generators) {
        return;
    }

    const timestamps = Object.keys(allOfferData);
    if (timestamps.length === 0) {
        return;
    }

    const currentTimestamp = timestamps[currentTradingPeriod - 1] || timestamps[0];
    const offersForPeriod = allOfferData[currentTimestamp];

    if (!offersForPeriod || offersForPeriod.length === 0) {
        return;
    }

    const generatorsBySite = new Map(liveGenData.generators.map(gen => [gen.site, gen]));

    // Get unique operators from the current trading period's offers
    const uniqueSitesOffered = [...new Set(offersForPeriod.map(offer => offer.site))];
    const operatorsForPeriod = [...new Set(
        uniqueSitesOffered
            .map(site => generatorsBySite.get(site)?.operator)
            .filter(op => op !== undefined)
    )].sort();

    // Add operators
    operatorsForPeriod.forEach(operator => {
        var opt = document.createElement("option");
        opt.value = operator;
        opt.innerHTML = operator;
        generatorFilterDropdown.appendChild(opt);
    });

    // Set selected value from URL if present
    const searchParams = new URLSearchParams(window.location.search);
    const selectedOperator = searchParams.get("operator");
    if (selectedOperator) {
        generatorFilterDropdown.value = selectedOperator;
    }
}

async function loadData() {
    statusSpan.innerHTML = "Loading data...";

    // Get filters from URL
    const searchParams = new URLSearchParams(window.location.search);

    const dateParam = searchParams.get("date");
    const tradingPeriodParam = searchParams.get("tp");

    if (tradingPeriodParam) {
        currentTradingPeriod = ((parseInt(tradingPeriodParam) - 1) % 48) + 1
    }

    if (dateParam) {
        currentDate = new Date(dateParam);
        liveGenData = await getLiveGenerationData(); //todo, does this need to get the generation data for the right date?
        allOfferData = await getTimeseriesOfferData(currentDate);
    } else {
        liveGenData = await getLiveGenerationData();
        allOfferData = await getTimeseriesOfferData();
    }

    const zoneToFilterTo = searchParams.get("zone")?.split(',') || [];
    const operatorToFilterTo = searchParams.get("operator")?.split(',') || [];

    setOperatorDropdown(allOfferData, liveGenData);
    setStationDropdown(allOfferData, liveGenData, zoneToFilterTo, operatorToFilterTo);
    setTradingPeriodDropdown();

    updateSupplyCurve();
}

function updateSupplyCurve() {
    const searchParams = new URLSearchParams(window.location.search);
    const siteToFilterTo = searchParams.get("site")?.split(',') || [];
    const tradingPeriodFilterTo = parseInt(searchParams.get("tp")) || currentTradingPeriod;
    const zoneToFilterTo = searchParams.get("zone")?.split(',') || [];
    const operatorToFilterTo = searchParams.get("operator")?.split(',') || [];

    // Get the timestamp for the current trading period
    const timestamps = Object.keys(allOfferData);
    if (timestamps.length === 0) {
        statusSpan.innerHTML = "No offer data available";
        return;
    }

    const currentTimestamp = timestamps[tradingPeriodFilterTo - 1] || timestamps[0];
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
        zoneToFilterTo,
        operatorToFilterTo
    );

    // Create the chart
    const startTime = new Date(currentTimestamp);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // Add 30 minutes

    const dateStr = startTime.toLocaleDateString('en-NZ');
    const startTimeStr = startTime.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: 'numeric' });
    const endTimeStr = endTime.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: 'numeric' });

    const title = `Electricity Supply Curve - ${dateStr}, ${startTimeStr} - ${endTimeStr}`;

    const chart = Highcharts.chart('generation-chart', {
        chart: {
            type: 'line',
            zoomType: 'xy'
        },
        title: {
            text: title
        },
        subtitle: {
            text: 'Trading Period ' + tradingPeriodFilterTo
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
            shared: false,
            snap: 10
        },
        legend: {
            enabled: false
        },
        plotOptions: {
            series: {
                findNearestPointBy: 'xy',
                stickyTracking: false,
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

    statusSpan.innerHTML = `Showing Trading Period ${tradingPeriodFilterTo}`;
}

// Initialize
loadData();
