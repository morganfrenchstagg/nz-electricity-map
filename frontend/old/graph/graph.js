
import { getRelativeTimeseriesData } from './graphData.js';
import { getChartSeriesDataByFuel, getTooltipForFuelFilteredGraph } from './graphByFuel.js';
import { FUELS_KEY, SKIP_LIST } from '../utilities/units.js';
import { getLiveGenerationData, getTimeseriesGenerationData, getTimeseriesPriceData } from '../utilities/api.js';
import { getCurrentTimeInNZ } from '../utilities/units.js';
import { createHighchart } from './graphChart.js';
import { TimeFrameSelector } from '../chart/timeframeSelector.js';
import { QueryParams } from '../chart/queryParams.js';
import { decomissioned } from '../utilities/decomissioned.js';
import { getSunrise, getSunset } from '../utilities/sunrise-sunset.js';
import { NIGHTTIME_SHADING } from '../utilities/colours.js';

const queryParamsNew = new QueryParams();
const timeframeSelector = new TimeFrameSelector(queryParamsNew.timeframe, queryParamsNew.date);

timeframeSelector.subscribe(updateQueryParams)

function updateQueryParams() {
    if (timeframeSelector.selectionType == "relative") {
        queryParamsNew.setRelativeTimeframe(timeframeSelector.relativeTimeframe);
    } else if (timeframeSelector.selectionType == "absolute") {
        queryParamsNew.setAbsoluteTimeframe(timeframeSelector.absoluteTimeframe);
    }

    getTradingPeriodStats(true)
}

const THIRTY_MINUTES_IN_MS = 30 * 60 * 1000;
const FIVE_MINUTES_IN_MS = 5 * 60 * 1000;

const powerStationFilterDropdown = document.getElementById('power-station-select');
const regionSelectDropdown = document.getElementById('region-select');
const clearButton = document.getElementById('clear-button');
const statusSpan = document.getElementById("graph-status");

regionSelectDropdown.addEventListener('change', () => onRegionDropdownSelect(regionSelectDropdown));
powerStationFilterDropdown.addEventListener('change', () => onGeneratorDropdownSelect(powerStationFilterDropdown));
clearButton.addEventListener('click', () => onClearButtonSelect());

const generatorData = await getLiveGenerationData();

function isMidnight(time) {
    return time.split("T")[1] === "00:00:00";
}

let graphLastUpdatedTimestamp = "";

let updateInProgress = false;

/**
 * Checks for any gaps in the data and fills them in with empty objects
 * @param {*} data 
 * @returns 
 */
function fillInGaps(data) {
    let maximumDataGapAllowed = THIRTY_MINUTES_IN_MS;

    if ((new URLSearchParams(window.location.search)).get("gaps") === "true") {
        maximumDataGapAllowed = FIVE_MINUTES_IN_MS;
    }

    var timestamps = Object.keys(data);
    var returnData = {};

    let previousTimestamp = new Date(timestamps[0]);
    timestamps.forEach((timestamp) => {
        var currentTimestamp = previousTimestamp;

        while (currentTimestamp < (new Date(timestamp) - maximumDataGapAllowed)) {
            currentTimestamp = new Date(currentTimestamp.getTime() + FIVE_MINUTES_IN_MS);
            let date = currentTimestamp;

            let monthWithLeadingZero = (date.getMonth() + 1).toString().padStart(2, '0');
            let dateWithLeadingZero = date.getDate().toString().padStart(2, '0');
            let hoursWithLeadingZero = date.getHours().toString().padStart(2, '0');
            let minutesWithLeadingZero = date.getMinutes().toString().padStart(2, '0');

            let formattedDateString = `${date.getFullYear()}-${monthWithLeadingZero}-${dateWithLeadingZero}T${hoursWithLeadingZero}:${minutesWithLeadingZero}:00`
            returnData[formattedDateString] = {};
        }

        returnData[timestamp] = data[timestamp];
        previousTimestamp = new Date(timestamp);
    })

    return returnData;
}

async function onGeneratorDropdownSelect(dropdownObject) {
    var selectedSiteCode = dropdownObject.options[dropdownObject.selectedIndex].value;
    setQueryParam("site", selectedSiteCode);
    setQueryParam("fuel", "");
    getTradingPeriodStats(true);
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

    getTradingPeriodStats(true);
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
    timeframeSelector.update();
}

function getSubtitleText(oldestTimestamp, newestTimestamp) {
    const formattedOldDate = new Date(oldestTimestamp)
        .toLocaleDateString('en-NZ', { weekday: "long", year: "numeric", month: "short", day: "numeric" });

    const formattedOldTime = new Date(oldestTimestamp).toLocaleTimeString('en-NZ', { hour: "numeric", minute: "numeric" });

    const formattedLatestDate = new Date(newestTimestamp)
        .toLocaleDateString('en-NZ', { weekday: "long", year: "numeric", month: "short", day: "numeric" });

    const formattedLatestTime = new Date(newestTimestamp).toLocaleTimeString('en-NZ', { hour: "numeric", minute: "numeric" });

    return (formattedOldDate == formattedLatestDate) ?
        `${formattedOldDate} ${formattedOldTime} - ${formattedLatestTime}` :
        `${formattedOldDate} ${formattedOldTime} - ${formattedLatestDate} ${formattedLatestTime}`;
}

function setGeneratorDropdown(liveGenData, zoneToFilterTo = [], islandToFilterTo = []) {
    let sortedGenerationData = liveGenData.generators.sort((a, b) => a.name.localeCompare(b.name));

    //clear generator dropdown
    powerStationFilterDropdown.innerHTML = "";
    var defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.innerHTML = "Select Power Station";
    powerStationFilterDropdown.appendChild(defaultOption);

    //populate generator dropdown
    sortedGenerationData.forEach(generator => {
        if (SKIP_LIST.includes(generator.site)) {
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

        if (zoneToFilterTo.length > 0 && !zoneToFilterTo.includes(generator.gridZone)) {
            return;
        }

        if (islandToFilterTo.length > 0 && !islandToFilterTo.includes(generator.island)) {
            return;
        }

        powerStationFilterDropdown.appendChild(opt);
    });
}

async function getTradingPeriodStats(forceUpdate = false) {
    if (updateInProgress) {
        console.log("Update already in progress")
        return;
    }

    let graphUpdatedMinutesAgo = Math.round((getCurrentTimeInNZ() - Date.parse(graphLastUpdatedTimestamp)) / 1000 / 60);

    if (!forceUpdate && graphLastUpdatedTimestamp && graphUpdatedMinutesAgo <= 5) {
        statusSpan.innerHTML = `Last Updated: ${graphUpdatedMinutesAgo} minutes ago`;
        return;
    }

    updateInProgress = true;
    timeframeSelector.toggleBlockSelectionChanges();
    console.debug("Updating trading period stats graph");

    statusSpan.innerHTML = "Fetching data...";
    statusSpan.style.display = "block";

    const siteToFilterTo = (new URLSearchParams(window.location.search)).get("site")?.split(',') || [];
    const islandToFilterTo = (new URLSearchParams(window.location.search)).get("island")?.split(',') || [];
    const zoneToFilterTo = (new URLSearchParams(window.location.search)).get("zone")?.split(',') || [];
    const fuelsToFilterTo = (new URLSearchParams(window.location.search)).get("fuel")?.split(',') || [];
    const timeframe = (new URLSearchParams(window.location.search)).get("timeframe") || "-0d";
    const date = (new URLSearchParams(window.location.search)).get("date");

    let data = {};
    let pricing = {};
    if (date) {
        data = await getTimeseriesGenerationData(new Date(date));
        pricing = await getTimeseriesPriceData(new Date(date));
    } else {
        let output = await getRelativeTimeseriesData(timeframe);

        if (output == undefined) {
            updateInProgress = false;
            statusSpan.innerHTML = "Error Loading data"

            let chartHTML = document.getElementById("generation-chart");
            chartHTML.innerHTML = "" +
                "<div class=\"text-center\" style=\"padding-top: 30vh;\">" +
                "<div class=\"pt-4\">Error loading chart data</div>" +
                "<div class=\"pt-4\">Please try again later</div>" +
                "</div>"

            return;
        }

        data = output[0]
        pricing = output[1]
    }

    statusSpan.innerHTML = "Updating graph...";

    data = fillInGaps(data);

    const tradingPeriodTimestamps = Object.keys(data);

    // populate 'Last updated x minutes ago' on statusbar
    var lastUpdatedDate = Date.parse(tradingPeriodTimestamps[tradingPeriodTimestamps.length - 1]);
    var lastUpdatedMinutesAgo = Math.round((getCurrentTimeInNZ() - lastUpdatedDate) / 1000 / 60);
    var lastUpdatedString = `Last Updated: ${lastUpdatedMinutesAgo} minutes ago`;

    //show back button if this request was directed from the map
    var redirect = (new URLSearchParams(window.location.search)).get("redirect");
    var backButton = document.getElementById("back-link");
    if (redirect) {
        backButton.style.display = "block";
    } else {
        backButton.style.display = "none";
    }

    setGeneratorDropdown(generatorData, zoneToFilterTo, islandToFilterTo);

    // Build up a string that contains the sites we are filtering to
    let filterDescription = "";
    if (siteToFilterTo.length > 0) {
        powerStationFilterDropdown.value = siteToFilterTo[0];

        siteToFilterTo.forEach(site => {
            var liveGeneratorData = (generatorData.generators.filter((gen) => gen.site === site))[0];
            if (liveGeneratorData)
                filterDescription += (filterDescription != "") ? ", " + liveGeneratorData.name : liveGeneratorData.name;
        });
    } else {
        powerStationFilterDropdown.value = "";
    }

    if (islandToFilterTo.length > 0) {
        regionSelectDropdown.value = islandToFilterTo[0];

        var islandNames = islandToFilterTo.map(island => island === "NI" ? "North Island" : "South Island");

        filterDescription += (filterDescription != "") ? ", " : "";
        filterDescription += islandNames.join(", ");
    }

    if (zoneToFilterTo.length > 0) {
        regionSelectDropdown.value = zoneToFilterTo[0];

        var zoneNames = zoneToFilterTo.map(zone => {
            switch (zone) {
                case "UNI":
                    return "Upper North Island"
                case "CNI":
                    return "Central North Island"
                case "LNI":
                    return "Lower North Island"
                case "USI":
                    return "Upper South Island"
                case "LSI":
                    return "Lower South Island"
                default:
                    return zone;
            }
        }
        );

        filterDescription += (filterDescription != "") ? ", " : "";
        filterDescription += zoneNames.join(", ");
    }

    if (islandToFilterTo.length == 0 && zoneToFilterTo.length == 0) {
        regionSelectDropdown.value = "";
    }

    const mostRecentTradingPeriodTimestamp = tradingPeriodTimestamps[tradingPeriodTimestamps.length - 1];

    if (!forceUpdate && mostRecentTradingPeriodTimestamp === graphLastUpdatedTimestamp) {
        // don't update the graph if nothing has changed (forces a re-render)
        updateInProgress = false;
        statusSpan.innerHTML = lastUpdatedString;
        timeframeSelector.toggleBlockSelectionChanges();
        return;
    }

    graphLastUpdatedTimestamp = mostRecentTradingPeriodTimestamp;

    let plotLines = [];
    var plotBands = [];

    let xAxisLabels = [];

    var firstTradingPeriodDate = new Date(`${tradingPeriodTimestamps[0].split("T")[0]}T00:00:00`);
    var sunrise = new Date(new Date(getSunrise(-41.2924, 174.7787, firstTradingPeriodDate) - 24 * 60 * 60 * 1000).toLocaleString("en-US", { timeZone: "Pacific/Auckland" }))
    var sunset = new Date(getSunset(-41.2924, 174.7787, firstTradingPeriodDate).toLocaleString("en-US", { timeZone: "Pacific/Auckland" }));

    var sunriseFound = false;
    var sunsetFound = false;

    var previousTimestamp = new Date(tradingPeriodTimestamps[0]);
    tradingPeriodTimestamps.forEach((time, index) => {
        var currentTimestamp = new Date(time);

        xAxisLabels.push(
            currentTimestamp
                .toLocaleTimeString('en-NZ', {
                    hour: "numeric",
                    minute: "numeric"
                }));

        if (currentTimestamp.getDate() != previousTimestamp.getDate()) {
            // adds a 'plotline' to the graph at Midnight to delineate when the date changes
            plotLines.push({
                color: 'black',
                width: 1,
                value: index,
                label: {
                    text: currentTimestamp.toLocaleString('en-NZ', { weekday: "long", year: "numeric", month: "short", day: "numeric" }),
                    align: 'top',
                    x: 10,
                    y: 10
                }
            });
        }

        if (timeframe == "-0d" && !sunriseFound && (currentTimestamp.getTime() > sunrise.getTime())) {
            sunriseFound = true;
            plotBands.push({
                color: NIGHTTIME_SHADING,
                from: 0,
                to: index,
                zIndex: 0
            })
        }

        if (timeframe == "-0d" && !sunsetFound && (currentTimestamp.getTime() > sunset.getTime())) {
            sunsetFound = true;
            plotBands.push({
                color: NIGHTTIME_SHADING,
                from: index,
                to: tradingPeriodTimestamps.length - 1,
                zIndex: 0
            })
        }
        previousTimestamp = currentTimestamp;
    });

    let subtitle = getSubtitleText(tradingPeriodTimestamps[0], mostRecentTradingPeriodTimestamp);

    decomissioned.forEach((decomissionedGenerator) => {
        generatorData.generators.push(decomissionedGenerator)
    })

    let seriesData = await getChartSeriesDataByFuel(generatorData, data, pricing, siteToFilterTo, islandToFilterTo, zoneToFilterTo, fuelsToFilterTo);

    let title = `NZ Electricity Generation ${(filterDescription !== "") ? " - " + filterDescription : ""}`;
    createHighchart(title, subtitle, xAxisLabels, seriesData, plotLines, plotBands, getTooltipForFuelFilteredGraph, onRedraw);

    updateInProgress = false;
    timeframeSelector.toggleBlockSelectionChanges();
    statusSpan.innerHTML = lastUpdatedString;
}

function onRedraw(event) {
    // if the user has manually hidden a series, update the URL query parameter to reflect this
    let visibleSeriesCommaSeparatedString = "";
    const series = this.userOptions.series;
    series.forEach((series, index) => {

        if (series.visible !== false) {
            visibleSeriesCommaSeparatedString += (visibleSeriesCommaSeparatedString.length > 0) ? "," : "";
            visibleSeriesCommaSeparatedString += Object.keys(FUELS_KEY).at(Object.values(FUELS_KEY).indexOf(series.name));
        }

    });
    setQueryParam("fuel", visibleSeriesCommaSeparatedString);
}

getTradingPeriodStats();
window.setInterval(() => getTradingPeriodStats(), 60000);