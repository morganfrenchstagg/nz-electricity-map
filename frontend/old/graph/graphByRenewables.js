import { RENEWABLE_FUELS, FUELS_KEY } from '../utilities/units.js';

export async function getChartSeriesDataByRenewables(liveGenData, data){
    var tradingPeriodTimestamps = Object.keys(data);

    var renewables = [];
    var other = [];

    tradingPeriodTimestamps.forEach(tradingPeriodTimestamp => {
        let thisTradingPeriodRenewables = 0;
        let thisTradingPeriodOther = 0;

        let thisTradingPeriodTimestamp = data[tradingPeriodTimestamp];

        thisTradingPeriodTimestamp.forEach(generationDataPoint => {
            let fuel = generationDataPoint.fuel;

            if(RENEWABLE_FUELS.includes(FUELS_KEY[fuel])){
                thisTradingPeriodRenewables += generationDataPoint.gen;
            } else {
                thisTradingPeriodOther += generationDataPoint.gen;
            }

            //console.log(fuel + " " + generationDataPoint.gen);
        })

        console.log(tradingPeriodTimestamp + " Renewables: " + thisTradingPeriodRenewables + " Other: " + thisTradingPeriodOther);
        renewables.push(thisTradingPeriodRenewables);
        other.push(thisTradingPeriodOther);
    });

    return [
        getHighchartDatapointForType("Renewables", renewables, []),
        getHighchartDatapointForType("Other", other, [])
    ];
}

function getHighchartDatapointForType(type, data){
    var fuelName = type;
    return {
        name: fuelName,
        data: data,
        //color: getColourForFuel(type)
    }
}