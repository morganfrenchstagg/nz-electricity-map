import { createHighchart } from '../graph/graphChart.js';
import { getColourForFuel } from '../utilities/colours.js';
import { FUELS_KEY, SKIP_LIST, displayMegawattsOrGigawatts } from '../utilities/units.js';
import { StationSelector } from '../chart/stationSelector.js';
import { Chart } from '../chart/chart.js';
import { DataSource } from '../chart/dataSource.js';

const urlParams = new URLSearchParams(window.location.search);

const stationSelector = new StationSelector(urlParams.get('site'));
const chart = new Chart(getTooltip);
const dataSource = new DataSource(urlParams.get('date'));

// does not need to refresh
const generatorData = await getGeneratorData();

export function createGraph() {
    console.log('Creating graph');

    stationSelector.subscribe(stationCallback);
    dataSource.subscribe(dataSourceUpdated);
    dataSource.start();
}

async function dataSourceUpdated() {
    console.log('Data source updated');
    await renderGraph();
}

async function stationCallback(selectedStation){
    console.log('Selected station changed: ' + selectedStation);
    //await renderGraph();
}

async function renderGraph() {
    const { timestamps, seriesDatapoints } = await getData();

    const generatorUnits = await getAllGeneratorUnits(generatorData);

    stationSelector.setGenerators(generatorData);

    const xAxisLabels = formatTimestamps(timestamps);
    const series = await getSeriesData(seriesDatapoints, generatorUnits);
    chart.updateSeries(xAxisLabels, series);
}

async function getSeriesData(seriesDatapoints, generatorUnits) {
    const { dataPoints, keys } = await getDataPointsByFuel(seriesDatapoints, generatorUnits);

    const fuelSeries = keys.map(fuel => {
        return {
            name: fuel,
            stack: fuel == "Battery (Charging)" ? "negative" : "positive",
            data: dataPoints[fuel],
            color: getColour(fuel)
        }
    });

    return fuelSeries;
}

async function getDataPointsByFuel(seriesDatapoints, generatorUnits) {
    let dataPointsByFuel = {};

    for (let unit of generatorUnits) {
        dataPointsByFuel[unit.fuel] = dataPointsByFuel[unit.fuel] ? dataPointsByFuel[unit.fuel].map((value, index) => {
            if (!seriesDatapoints[unit.node] || !seriesDatapoints[unit.node][index]) {
                return value;
            }
            return value + seriesDatapoints[unit.node][index];
        }) : seriesDatapoints[unit.node];
    }
    return {
        dataPoints: dataPointsByFuel,
        keys: keyOrder
    };
}

const keyOrder = ["Battery (Discharging)", "Diesel", "Hydro", "Solar", "Wind", "Gas", "Coal", "Geothermal", "Battery (Charging)"];

function getColour(fuel) {
    const fuelName = Object.keys(FUELS_KEY).at(Object.values(FUELS_KEY).indexOf(fuel))
    return getColourForFuel(fuelName);
}

function formatTimestamps(timestamps) {
    return timestamps.map(timestamp => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-NZ', {
            hour: "numeric",
            minute: "numeric"
        });
    });
}

async function getAllGeneratorUnits(generatorData) {
    let units = [];

    let filteredGeneratorData = generatorData;

    if(stationSelector.getSelectedStation()){
        filteredGeneratorData = generatorData.filter(generator => generator.site === stationSelector.getSelectedStation());
    }

    for (let generator of filteredGeneratorData) {
        for (let unit of Object.values(generator.units)) {
            units.push({ ...unit, generatorName: generator.name, site: generator.site });
        }
    }

    return units;
}

async function getData() {
    const responseJson = dataSource.getData();

    let timestamps = [];
    let seriesDatapoints = {};

    for (let dataPoint of responseJson.data) {
        timestamps.push(dataPoint[0]);

        for (let i = 1; i < dataPoint.length; i++) {
            if (!seriesDatapoints[responseJson.series[i - 1]]) {
                seriesDatapoints[responseJson.series[i - 1]] = [];
            }
            seriesDatapoints[responseJson.series[i - 1]].push(dataPoint[i]);
        }
    }

    return {
        timestamps,
        seriesDatapoints
    }
}

async function getGeneratorData() {
    // TODO: move to a better API
    const response = await fetch("https://raw.githubusercontent.com/morganfrenchstagg/nz-electricity-map/refs/heads/main/backend/data/generators.json");
    const generatorData = await response.json();

    return generatorData;
}

function getTooltip(){
    let html = `<b>${this.x}</b></br><br/>`;

    this.points.forEach(point => {
        html += `<span style="color:${point.color}">\u25CF</span> ${point.series.name}: <b>${displayMegawattsOrGigawatts(point.y)}</b><br/>`;
    });

    return html;
}

// onload
createGraph();