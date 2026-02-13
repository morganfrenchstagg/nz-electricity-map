import { getTimeseriesGenerationData, getTimeseriesOfferData } from '../utilities/api.js';
import { getDateRelativeToNowInNZ, getCurrentTimeInNZ } from '../utilities/units.js';

const MILLISECONDS_IN_DAY = (1000 * 60 * 60 * 24);
const DAYS_IN_WEEK = 7;

/*
 * Fetches timeseries data for the last n days/hours
 * Example timeframes:
 * - "-0d" : today
 * - "-24h" : last 24 hours
 * - "-1d" : last day
 * - "-1w" : last week
 */
export async function getRelativeTimeseriesData(timeframe) {
    let data = {};
    let offerData = {};

    let hoursSelected = timeframe.slice(-1) === "h";
    let weeksSelected = timeframe.slice(-1) === "w";

    let number = parseInt(timeframe.slice(0, -1));

    if (weeksSelected){
        number = number * DAYS_IN_WEEK;
    }

    let daysAgoToFetch = 0;
    let startingDate = {};

    if (hoursSelected){
        startingDate = getDateRelativeToNowInNZ(0, -number);
        daysAgoToFetch = Math.round((getCurrentTimeInNZ().getTime() - getDateRelativeToNowInNZ(0, -number).getTime())/MILLISECONDS_IN_DAY);
    } else {
        startingDate = new Date(getDateRelativeToNowInNZ(-number).setHours(0, 0, 0, 0));
        daysAgoToFetch = -number;
    }

    console.debug(`Fetching data since ${startingDate.toLocaleDateString('en-NZ') + " " + startingDate.toLocaleTimeString('en-NZ')}`)
    console.debug(`Days ago to fetch: ${daysAgoToFetch}`);

    for (let relativeTimeUnit = daysAgoToFetch; relativeTimeUnit >= 0; relativeTimeUnit--) {
        let date = {};

        date = getDateRelativeToNowInNZ(relativeTimeUnit);

        let timeseriesData = await getTimeseriesGenerationData(date);

        if(Object.keys(timeseriesData).length == 0){
            return;
        }

        let timeseriesOfferData = await getTimeseriesOfferData(date);
        Object.assign(data, timeseriesData);
        Object.assign(offerData, timeseriesOfferData);
    }

    // since we only collect data in chunks of 1 day, we have fetched more data than we need (if we are doing an hourly relative comparison).
    // therefore we want to remove any data for times before the start time of our filter
    Object.keys(data)
        .filter((time) => timeIsBefore(time, startingDate))
        .forEach((time) => {
            delete data[time];
            delete offerData[time];
        });

    return [data, offerData];
}

function timeIsBefore(time, comparisonTime){
    return new Date(time).getTime() < new Date(comparisonTime).getTime();
}
