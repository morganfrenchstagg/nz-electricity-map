import { getColourForFuel } from '../utilities/colours.js';
import { FUELS_KEY, SKIP_LIST } from '../utilities/units.js';

/**
 * Builds supply curve data from offers for a specific trading period
 * @param {Object} offers - Offers data for a specific timestamp
 * @param {Object} liveGenData - Live generation data with site/fuel info
 * @param {Array} siteFilter - Sites to filter to
 * @param {Array} islandFilter - Islands to filter to
 * @param {Array} zoneFilter - Zones to filter to
 * @returns {Array} Highcharts series data for supply curve
 */
export function buildSupplyCurveWithMetadata(offers, liveGenData, siteFilter = [], islandFilter = [], zoneFilter = []) {
    if (!offers || offers.length === 0) {
        return [];
    }

    // Collect all tranches
    let allTranches = [];

    offers.forEach(generator => {
        const genInfo = liveGenData.generators.find(g => g.site === generator.site);

        if (siteFilter.length > 0 && !siteFilter.includes(generator.site)) {
            return;
        }
        if (islandFilter.length > 0 && genInfo && !islandFilter.includes(genInfo.island)) {
            return;
        }
        if (zoneFilter.length > 0 && genInfo && !zoneFilter.includes(genInfo.gridZone)) {
            return;
        }
        if (SKIP_LIST.includes(generator.site)) {
            return;
        }

        generator.tranches.forEach(tranche => {
            if (tranche.megawatts != 0) {
                allTranches.push({
                    site: generator.site,
                    unit: generator.unit,
                    tranche: tranche.tranche,
                    megawatts: tranche.megawatts,
                    price: tranche.price,
                    fuel: genInfo ? genInfo.units[0]?.fuelCode : 'UNKNOWN',
                    name: genInfo ? genInfo.name : generator.site
                });
            }
        });
    });

    // Sort by price (merit order), then by fuel type to group same-priced offers by fuel
    allTranches.sort((a, b) => {
        if (a.price !== b.price) {
            return a.price - b.price;
        }
        // Same price - group by fuel
        return a.fuel.localeCompare(b.fuel);
    });

    // Build segments by fuel type
    let cumulativeMW = 0;
    let series = [];
    let currentSegment = null;
    let previousPrice = null;

    allTranches.forEach((tranche) => {
        const startMW = cumulativeMW;
        const endMW = cumulativeMW + tranche.megawatts;
        const midMW = (startMW + endMW) / 2;

        // Check if price changed from previous tranche
        const priceChanged = previousPrice !== null && previousPrice !== tranche.price;

        // If fuel changed or first tranche, start a new segment
        if (!currentSegment || currentSegment.fuel !== tranche.fuel) {
            if (currentSegment) {
                // Save previous segment
                series.push({
                    name: FUELS_KEY[currentSegment.fuel] || currentSegment.fuel,
                    type: 'line',
                    step: 'left',
                    data: currentSegment.data,
                    color: getColourForFuel(currentSegment.fuel),
                    lineWidth: 4,
                    connectNulls: false,
                    showInLegend: true
                });
            }

            // Start new segment
            currentSegment = {
                fuel: tranche.fuel,
                data: []
            };

            // If price changed, insert null to break the line
            if (priceChanged) {
                currentSegment.data.push(null);
            }

            // Add starting point for new segment (no marker)
            currentSegment.data.push({
                x: startMW,
                y: tranche.price,
                marker: {
                    enabled: false,
                    states: {
                        hover: {
                            enabled: false
                        }
                    }
                }
            });
        } else if (priceChanged) {
            // Same fuel but price changed - insert null to break vertical line
            currentSegment.data.push(null);

            // Add starting point at new price (no marker)
            currentSegment.data.push({
                x: startMW,
                y: tranche.price,
                marker: {
                    enabled: false,
                    states: {
                        hover: {
                            enabled: false
                        }
                    }
                }
            });
        }

        // Add middle point with marker for tooltip
        currentSegment.data.push({
            x: midMW,
            y: tranche.price,
            site: tranche.site,
            unit: tranche.unit,
            name: tranche.name,
            tranche: tranche.tranche,
            megawatts: tranche.megawatts,
            fuel: tranche.fuel,
            marker: {
                enabled: true,
                radius: 3,
                symbol: 'circle',
                states: {
                    hover: {
                        enabled: true,
                        radius: 6
                    }
                }
            },
        });

        // Add end point of this tranche (no marker)
        currentSegment.data.push({
            x: endMW,
            y: tranche.price,
            marker: {
                enabled: false,
                states: {
                    hover: {
                        enabled: false
                    }
                }
            }
        });

        cumulativeMW = endMW;
        previousPrice = tranche.price;
    });

    // Add the last segment
    if (currentSegment) {
        series.push({
            name: FUELS_KEY[currentSegment.fuel] || currentSegment.fuel,
            type: 'line',
            step: 'left',
            data: currentSegment.data,
            color: getColourForFuel(currentSegment.fuel),
            marker: {
                enabled: false,
            },
        });
    }

    return series;
}

export function getSupplyCurveTooltip() {
    if (!this.point) return '';

    const point = this.point;

    return `
        <b>${point.name || point.site} - ${point.unit}</b><br>
        Tranche ${point.tranche}<br>
        Price: <b>$${point.y.toFixed(2)}/MWh</b><br>
        Quantity: <b>${point.megawatts.toFixed(1)} MW</b><br>
        Cumulative: <b>${point.x.toFixed(1)} MW</b><br>
        Fuel: ${FUELS_KEY[point.fuel] || point.fuel}
    `;
}
