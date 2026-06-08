import { buildSupplyCurveWithMetadata, getSupplyCurveTooltip } from './offerSupplyCurve.js';
import { getLiveGenerationData, getTimeseriesOfferData } from '../utilities/api.js';
import { OfferDateSelector } from './offerDateSelector.js';
import { formatDate } from '../utilities/units.js';

const siteFilterDropdown = document.getElementById('power-station-select');
const operatorFilterDropdown = document.getElementById('operator-select');
const tradingPeriodDropdown = document.getElementById('trading-period-select');
const clearButton = document.getElementById('clear-button');
const statusSpan = document.getElementById("graph-status");

let currentDate = new Date();
let currentTradingPeriod = 1;
let allOfferData = {};
let apiTimestamp;
let liveGenData = null;
let dateSelector = null;

operatorFilterDropdown.addEventListener('change', () => onOperatorFilterDropdownSelect(operatorFilterDropdown));
siteFilterDropdown.addEventListener('change', () => onSiteDropdownSelect(siteFilterDropdown));
tradingPeriodDropdown.addEventListener('change', () => onTradingPeriodSelect(tradingPeriodDropdown));
clearButton.addEventListener('click', () => onClearButtonSelect());

async function onSiteDropdownSelect(dropdownObject) {
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

async function onOperatorFilterDropdownSelect(dropdownObject) {
    var selectedOperator = dropdownObject.options[dropdownObject.selectedIndex].value;
    const operatorToFilterTo = selectedOperator ? [selectedOperator] : [];
    setStationDropdown(allOfferData, liveGenData, operatorToFilterTo);

    setQueryParam('operator', selectedOperator);
    setQueryParam('site', "");

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

function setStationDropdown(allOfferData, liveGenData, operatorToFilterTo = []) {
    const timestamps = Object.keys(allOfferData);
    const currentTimestamp = timestamps[currentTradingPeriod - 1] || timestamps[0];

    siteFilterDropdown.innerHTML = "";
    var defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.innerHTML = "Select Power Station";
    siteFilterDropdown.appendChild(defaultOption);

    liveGenData.generators.sort((a, b) => a.name.localeCompare(b.name)).forEach(generator => {
        var opt = document.createElement("option");
        opt.value = generator.site;
        opt.innerHTML = `${generator.name}`;

        siteFilterDropdown.appendChild(opt);
    })
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
    operatorFilterDropdown.innerHTML = "";

    // Add default option
    var defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.innerHTML = "Select Operator";
    operatorFilterDropdown.appendChild(defaultOption);

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
    const uniqueOperators = [... new Set(liveGenData.generators.map(generator => generator.operator))];
    uniqueOperators.forEach(operator => {
        var opt = document.createElement("option");
        opt.value = operator;
        opt.innerHTML = operator;
        operatorFilterDropdown.appendChild(opt);
    })
}

async function loadData() {
    if (dateSelector) {
        dateSelector.disableSelectionChanges();
    }

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
        let offerData = await getTimeseriesOfferData(currentDate);
        allOfferData = offerData.data;
    } else {
        liveGenData = await getLiveGenerationData();
        let offerData = await getTimeseriesOfferData();
        allOfferData = offerData.data;
        apiTimestamp = offerData.date.substr(0, 4) + '-' + offerData.date.substr(4, 2) + '-' + offerData.date.substr(6);
    }

    // Initialize date selector
    if (!dateSelector) {
        dateSelector = new OfferDateSelector(dateParam || apiTimestamp);
        dateSelector.subscribe(onDateChange);
    }

    const operatorToFilterTo = searchParams.get("operator")?.split(',') || [];

    setOperatorDropdown(allOfferData, liveGenData);
    setStationDropdown(allOfferData, liveGenData, operatorToFilterTo);
    setTradingPeriodDropdown();

    updateSupplyCurve();

    if (dateSelector) {
        dateSelector.enableSelectionChanges();
        dateSelector.updateWithoutNotify(dateParam || apiTimestamp)
        setQueryParam("date", formatDate(dateParam || apiTimestamp));
    }
}

async function onDateChange(newDate) {
    setQueryParam("date", newDate);
    await loadData();
}

function updateSupplyCurve() {
    const searchParams = new URLSearchParams(window.location.search);
    const siteToFilterTo = searchParams.get("site")?.split(',') || [];
    const tradingPeriodFilterTo = parseInt(searchParams.get("tp")) || currentTradingPeriod;
    const date = searchParams.get("date") || apiTimestamp;
    const operatorToFilterTo = searchParams.get("operator")?.split(',') || [];

    // Get the timestamp for the current trading period
    const timestamps = Object.keys(allOfferData);
    if (timestamps.length === 0) {
        statusSpan.innerHTML = "No offer data available";
        return;
    }

    const offersForPeriod = allOfferData[tradingPeriodFilterTo];

    if (!offersForPeriod) {
        statusSpan.innerHTML = "No offers for this period";
        return;
    }

    // Build supply curve data
    const seriesData = buildSupplyCurveWithMetadata(
        offersForPeriod,
        liveGenData,
        siteToFilterTo,
        operatorToFilterTo
    );

    // Create the chart
    const title = `Electricity Supply Curve - ${new Date(date).toLocaleDateString('en-NZ', {
        year: "numeric",
        month: "short",
        day: "numeric"
    })}`;

    const chart = Highcharts.chart('generation-chart', {
        chart: {
            type: 'line',
            zoomType: 'xy'
        },
        title: {
            text: title
        },
        subtitle: {
            text: 'Trading Period: ' + tradingPeriodFilterTo
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

// Show back button if redirected from map
var redirect = (new URLSearchParams(window.location.search)).get("redirect");
var backButton = document.getElementById("back-link");
if (redirect) {
    backButton.style.display = "block";
}

// Initialize
loadData();