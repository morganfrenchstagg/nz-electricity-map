export const NIGHTTIME_SHADING = '#edeffc';


export function detemineMapColour(unit) {
    if (unit.fuel === 'Wind') {
        return '#87CEEB'
    } else if (unit.fuel === 'Hydro') {
        return '#191970'
    } else if (unit.fuel === 'Geothermal') {
        return '#ffaf40'
    } else if (unit.fuel === 'Solar') {
        return '#ccff00'
    } else if (unit.fuel === 'Battery (Discharging)') {
        return '#76721E'
    } else if (unit.fuel === 'Battery'){
        return '#76721E'
    } else {
        return '#ff0000'
    }
}

export function getColourForFuel(fuel) {
    if (fuel === 'WIN') {
        return 'rgb(65, 117, 5)'
    } else if (fuel === 'HYD') {
        return 'rgb(69, 130, 180)'
    } else if (fuel === 'GEO') {
        return 'rgb(252, 3, 3)'
    } else if (fuel === 'SOL') {
        return 'rgb(254, 213, 0)'
    } else if (fuel === 'BESS' || fuel === 'BESS-C') {
        return '#76721E'
    } else if (fuel === 'CLG') {
        return 'rgb(139, 87, 42)'
    } else if (fuel === 'GAS') {
        return 'rgb(253, 180, 98)'
    } else if (fuel === 'DIE') {
        return 'rgb(135, 72, 0)'
    } else {
        return 'rgb(0, 0, 0)'
    }
}