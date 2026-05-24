import { RENEWABLE_FUELS, displayMegawattsOrGigawatts, FUELS_KEY, SKIP_LIST } from '../utilities/units.js';
import { getColourForFuel } from '../utilities/colours.js';

const keyOrder = [
    "BESS",
    "DIE",
    "HYD",
    "SOL",
    "WIN",
    "GAS",
    "CLG",
    "GEO",
    "BESS-C"
];

export async function getChartSeriesDataByFuel(liveGenData, data, offers, siteFilter = [], islandFilter = [], zoneFilter = [], fuelFilter = []){
    var tradingPeriodTimestamps = Object.keys(data);
    var outputGenerationByFuel = {};
    var capacityByTimestamp = [];
    window.latestPricingTimeseries = [];
    
    var filteredGeneratorList = liveGenData.generators.filter(generator => {
        return isGeneratorInFilter(generator, siteFilter, islandFilter, zoneFilter);
    });
    
    // find all of the fuels that we will need to chart
    var allFuels = [];
    filteredGeneratorList.forEach(generator => {
        generator.units.forEach(unit => {
            const fuelKey = Object.keys(FUELS_KEY).at(Object.values(FUELS_KEY).indexOf(unit.fuel));
            
            if(fuelKey === "BESS" && !allFuels.includes("BESS-C")){
                allFuels.push("BESS-C");
                outputGenerationByFuel["BESS-C"] = [];
            }

            if (!allFuels.includes(fuelKey)) {
                allFuels.push(fuelKey);
                outputGenerationByFuel[fuelKey] = [];
            }
        });
    });

    tradingPeriodTimestamps.forEach(tradingPeriodTimestamp => {
        var thisTimestampCapacity = 0;

        var gens = Object.keys(data[tradingPeriodTimestamp]);
        if(gens.length === 0){ //do generation data for this trading period - leave a gap in the graph
            allFuels.forEach(fuel => {
                outputGenerationByFuel[fuel].push(null);
            });
            capacityByTimestamp.push(null);
            window.latestPricingTimeseries.push(null)
            return;
        }

        window.latestPricingTimeseries.push(offers[tradingPeriodTimestamp])

        var generationData = data[tradingPeriodTimestamp];
        var thisTradingPeriodSummaryByFuel = {};

        filteredGeneratorList.forEach(generator => {
            generator.units.forEach(unit => {
                if(unit.installedCapacity){
                    thisTimestampCapacity += unit.installedCapacity;
                } else {
                    thisTimestampCapacity += (unit.capacity >= 0) ? unit.capacity : 0;
                }

                
                if (unit.outage.length > 0){
                    let seenOutages = [];
                    unit.outage.forEach(outage => {
                        var now = new Date(tradingPeriodTimestamp) // todo - daylight savings?
                        var outageKey = outage.outageBlock + "_" + outage.from + "_" + outage.mwLost;
                        
                        var outageStarted = new Date(outage.from) <= now;
                        var outageEnded = new Date(outage.until) <= now;
                        var duplicateOutage = seenOutages.includes(outageKey);

                        if(outageStarted && !outageEnded && !duplicateOutage){
                            thisTimestampCapacity -= outage.mwLost;
                            seenOutages.push(outageKey);
                        }
                    });
                }
            });

            // find the data from this trading period for this generator
            var genData = generationData.filter(gen => gen.site === generator.site);
            if(genData.length == 0){
                return;
            }

            genData.forEach(generationDataPoint => {
                if(generationDataPoint.fuel === "BESS" && generationDataPoint.gen < 0){
                    // negative generation from a battery is charging
                    generationDataPoint.fuel = "BESS-C";
                }

                // append it - to the relevant fuel
                thisTradingPeriodSummaryByFuel[generationDataPoint.fuel] = (thisTradingPeriodSummaryByFuel[generationDataPoint.fuel] || 0) + generationDataPoint.gen;
            });
        });
 
        // for all fuels we will graph, find their summarised generation for this trading period
        allFuels.forEach(fuel => {
            outputGenerationByFuel[fuel].push(thisTradingPeriodSummaryByFuel[fuel] || 0);
        });

        capacityByTimestamp.push((thisTimestampCapacity >= 0) ? thisTimestampCapacity : 0);
    });

    let highchartSeries = orderedFuelList(outputGenerationByFuel)
        .map(fuel => getHighchartDatapointForFuel(fuel, outputGenerationByFuel, fuelFilter));

    if(siteFilter.length > 0){
        highchartSeries.push({
            name: 'Capacity',
            type: 'line',
            data: capacityByTimestamp,
            visible: true,
            color: '#000000'
        });
    }
    
    return highchartSeries;
}

function getPriceForIndex(pricing, index){
    if(pricing != {})
        return pricing[Object.keys(pricing)[index]]
    return {};
}

export function getTooltipForFuelFilteredGraph(){
    let header = `<b>${this.x}</b><br>`;
    var renewableGeneration = 0;
    var totalGeneration = 0;
    var totalCapacity = 0;

    let body = "";
    let pricingForThisTime = getPriceForIndex(window.latestPricingTimeseries, this.point.index);

    this.points.forEach(point => {
        if(RENEWABLE_FUELS.includes(point.series.name)){
            renewableGeneration += point.y;
        }

        if(point.series.name === "Capacity"){
            totalCapacity = point.y;
        } else if (point.series.name !== "Battery (Charging)") {
            totalGeneration += point.y;
        }
    });

    this.points.forEach(point => {
        if (point.series.name === "Capacity"){
            return;
        }

        if(point.y == 0){
            body += `
                <span style="color: ${point.color}">\u25CF</span> 
                ${point.series.name}: 0 MW
                <br>`;
        } else {
            const generationSum = point.y;
            const percentage = (totalGeneration != 0 && this.points.length > 2) ? `(${Math.round(generationSum / totalGeneration * 100)}%)` : '';

            body += `
                <span style="color: ${point.color}">\u25CF</span> 
                ${point.series.name}: <b>${displayMegawattsOrGigawatts(generationSum)}</b> ${percentage}
                <br>`;
        }
    })

    const renewablePercentage = (totalGeneration != 0) ? Math.floor(renewableGeneration / totalGeneration * 100) : 0;
    
    let totalCapacityText = (totalCapacity > 0) ? ` / <b>${displayMegawattsOrGigawatts(totalCapacity)}</b> (${Math.round(totalGeneration / totalCapacity * 100)}%)` : "";
    let footer = `<br>Total Generation: <b>${displayMegawattsOrGigawatts(totalGeneration)}</b>${totalCapacityText}<br>`;
    footer += `Renewable: <b>${renewablePercentage}%</b><br><br>`;

    if(Object.keys(window.latestPricingTimeseries).length > 0 && pricingForThisTime != undefined){
        footer += `Real Time Dispatch Pricing: <br>`
        footer += `Ōtāhuhu: <b>$${pricingForThisTime['OTA2201'].toFixed(2)}</b><br>`
        footer += `Benmore: <b>$${pricingForThisTime['BEN2201'].toFixed(2)}</b><br>`
    }

    return header + body + footer;

}

function orderedFuelList(fuels){
    return keyOrder.filter(fuel => Object.keys(fuels).includes(fuel));
}

function getHighchartDatapointForFuel(fuel, fuels, fuelFilter){
    var fuelName = FUELS_KEY[fuel] || fuel;
    return {
        name: fuelName,
        stack: (fuels[fuel].some((x) => x > 0)) ? "positive": "negative",
        data: fuels[fuel],
        visible: fuelFilter.length == 0 || fuelFilter.includes(fuel),
        color: getColourForFuel(fuel)
    }
}

function isGeneratorInFilter(generator, siteFilter, islandFilter, zoneFilter){
    if(SKIP_LIST.includes(generator.site)){
        return false;
    }

    if(siteFilter.length > 0 && !siteFilter.includes(generator.site)){
        return false;
    }

    if(islandFilter.length > 0 && !islandFilter.includes(generator.island)){
        return false;
    }

    if(zoneFilter.length > 0 && !zoneFilter.includes(generator.gridZone)){
        return false;
    }

    return true;
}
