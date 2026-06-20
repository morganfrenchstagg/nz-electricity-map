import { buildSupplyCurveWithMetadata, getSupplyCurveTooltip } from './offerSupplyCurve.js';
import { getStaticGeneratorData, getTimeseriesOfferData } from '../utilities/api.js';
import { OfferDateSelector } from './offerDateSelector.js';
import { OfferTradingPeriodSelector } from './offerTradingPeriodSelector.js';
import { formatDate } from '../utilities/units.js';

const siteFilterDropdown = document.getElementById('power-station-select');
const operatorFilterDropdown = document.getElementById('operator-select');
const clearButton = document.getElementById('clear-button');

let currentDate = new Date();
let currentTradingPeriod = 1;
let allOfferData = {};
let apiTimestamp;
let generatorDefinitions = null;
let dateSelector = null;
let tradingPeriodSelector = null;

operatorFilterDropdown.addEventListener('change', () => onOperatorFilterDropdownSelect(operatorFilterDropdown));
siteFilterDropdown.addEventListener('change', () => onSiteDropdownSelect(siteFilterDropdown));
clearButton.addEventListener('click', () => onClearButtonSelect());

async function onSiteDropdownSelect(dropdownObject) {
    var selectedSiteCode = dropdownObject.options[dropdownObject.selectedIndex].value;
    setQueryParam("site", selectedSiteCode);
    updateSupplyCurve();
}

async function onTradingPeriodChange(selectedTradingPeriod) {
    setQueryParam("tp", selectedTradingPeriod);
    currentTradingPeriod = selectedTradingPeriod;
    updateSupplyCurve();
}

async function onOperatorFilterDropdownSelect(dropdownObject) {
    var selectedOperator = dropdownObject.options[dropdownObject.selectedIndex].value;
    const operatorToFilterTo = selectedOperator ? [selectedOperator] : [];
    setStationDropdown(allOfferData, generatorDefinitions, operatorToFilterTo);

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

function setStationDropdown(allOfferData, generatorDefinitions, operatorToFilterTo = []) {
    const timestamps = Object.keys(allOfferData);
    const currentTimestamp = timestamps[currentTradingPeriod - 1] || timestamps[0];

    siteFilterDropdown.innerHTML = "";
    var defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.innerHTML = "Select Power Station";
    siteFilterDropdown.appendChild(defaultOption);

    generatorDefinitions.sort((a, b) => a.name.localeCompare(b.name)).forEach(generator => {
        var opt = document.createElement("option");
        opt.value = generator.site;
        opt.innerHTML = `${generator.name}`;

        siteFilterDropdown.appendChild(opt);
    })
}

function setOperatorDropdown(allOfferData, generatorDefinitions) {
    // Clear dropdown first
    operatorFilterDropdown.innerHTML = "";

    // Add default option
    var defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.innerHTML = "Select Operator";
    operatorFilterDropdown.appendChild(defaultOption);

    // Early return if data is missing or empty
    if (!allOfferData || !generatorDefinitions) {
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

    const generatorsBySite = new Map(generatorDefinitions.map(gen => [gen.site, gen]));
    const uniqueOperators = [... new Set(generatorDefinitions.map(generator => generator.operator))];
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

    // Get filters from URL
    const searchParams = new URLSearchParams(window.location.search);

    const dateParam = searchParams.get("date");
    const tradingPeriodParam = searchParams.get("tp");

    if (!tradingPeriodSelector) {
        tradingPeriodSelector = new OfferTradingPeriodSelector(tradingPeriodParam);
        tradingPeriodSelector.subscribe(onTradingPeriodChange)
    }

    if (tradingPeriodParam) {
        currentTradingPeriod = ((parseInt(tradingPeriodParam) - 1) % 48) + 1
    }

    if (dateParam) {
        currentDate = new Date(dateParam);
        generatorDefinitions = await getStaticGeneratorData(); //todo, does this need to get the generation data for the right date?
        let offerData = await getTimeseriesOfferData(currentDate);
        allOfferData = offerData.data;
    } else {
        generatorDefinitions = await getStaticGeneratorData();
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

    setOperatorDropdown(allOfferData, generatorDefinitions);
    setStationDropdown(allOfferData, generatorDefinitions, operatorToFilterTo);

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
        return;
    }

    const offersForPeriod = allOfferData[tradingPeriodFilterTo];

    if (!offersForPeriod) {
        return;
    }

    // Build supply curve data
    const seriesData = buildSupplyCurveWithMetadata(
        offersForPeriod,
        generatorDefinitions,
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
            type: 'area',
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
                        opacity: 0.5
                    }
                },
                animation: false
            }
        },
        series: seriesData,
        credits: {
            enabled: false
        }
    });
}

// Show back button if redirected from map
var redirect = (new URLSearchParams(window.location.search)).get("redirect");
var backButton = document.getElementById("back-link");
if (redirect) {
    backButton.style.display = "block";
}

// Initialize
loadData();