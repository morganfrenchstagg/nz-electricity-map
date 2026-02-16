import { underConstruction } from "../utilities/underConstruction.js";
import { formatFuel } from "../utilities/units.js";

var table = document.getElementById('generation-pipeline-table');

function populatePipelineTable(){
    const fuelMap = new Map();
    
    table.innerHTML = "";
    
    var sortKey = window.location.search.split('sort=')[1] || 'opening';
    
    var row = table.insertRow();
    row.style.fontWeight = "bold";
    row.className = "table-primary";

    addTitleCell(row, sortKey, "Name", "name");
    addTitleCell(row, sortKey, "Operator", "operator");
    addTitleCell(row, sortKey, "Type", "type");
    addTitleCell(row, sortKey, "Status", "status");
    addTitleCell(row, sortKey, "Potential Comissioning", "opening");
    addTitleCell(row, sortKey, "Nameplate Capacity (AC)", "nameplate");
    addCell(row, "");
    addTitleCell(row, sortKey, "Annual Generation", "annualGeneration");
    addTitleCell(row, sortKey, "Cost", "cost");
    addCell(row, "More Info");
    
    let totalAnnualGeneration = 0;
    let totalNameplateCapacity = 0;
    let totalCost = 0;

    let newGenerationGWhByYear = {};
    let nameplateCapacityByYear = {};

    sortList(underConstruction, sortKey).forEach(site => {
        addRow(site);
        
        if(site.capacityMW){
            fuelMap.set(site.fuel, (fuelMap.get(site.fuel) || 0) + site.capacityMW);
        }

        totalAnnualGeneration += site.yearlyGenerationGWh || 0;
        totalNameplateCapacity += site.capacityMW || site.predictedCapacityMW || 0;
        totalCost += (site.costMillionDollars !== undefined) ? site.costMillionDollars : 0;

        if(site.openBy){
            let year = new Date(site.openBy).getFullYear();
            if(newGenerationGWhByYear[year] === undefined){
                newGenerationGWhByYear[year] = 0;
            }

            newGenerationGWhByYear[year] += site.yearlyGenerationGWh || 0;

            if(nameplateCapacityByYear[year] === undefined){
                nameplateCapacityByYear[year] = 0;
            }

            nameplateCapacityByYear[year] += site.capacityMW || site.predictedCapacityMW || 0;
        }
    });
    
    var totalRow = table.insertRow();
    totalRow.style.fontWeight = "bold";
    totalRow.className = "table-info";
    
    addCell(totalRow, "Total");
    addCell(totalRow, "");
    addCell(totalRow, "");
    addCell(totalRow, "");
    addCell(totalRow, "");
    addCell(totalRow, totalNameplateCapacity.toFixed(1) + " MW");
    addCell(totalRow, "");
    addCell(totalRow, totalAnnualGeneration + " GWh");
    addCell(totalRow, "$" + (totalCost/1000).toFixed(2) + "b");
    addCell(totalRow, "");

    Object.keys(newGenerationGWhByYear).forEach(year => {
        var yearRow = table.insertRow();
        addCell(yearRow, `Total in ${year}`);
        addCell(yearRow, "");
        addCell(yearRow, "");
        addCell(yearRow, "");
        addCell(yearRow, "");
        addCell(yearRow, nameplateCapacityByYear[year].toFixed(1) + " MW");
        addCell(yearRow, "");
        addCell(yearRow, newGenerationGWhByYear[year] + " GWh");
        addCell(yearRow, "");
        addCell(yearRow, "");
    });

    fuelMap.forEach((capacity, fuel) => {
        var fuelRow = table.insertRow();
        addCell(fuelRow, "Total for " +formatFuel(fuel));
        addCell(fuelRow, "");
        addCell(fuelRow, "");
        addCell(fuelRow, "");
        addCell(fuelRow, "");
        addCell(fuelRow, capacity.toFixed(1) + " MW");
        addCell(fuelRow, "");
        addCell(fuelRow, "");
        addCell(fuelRow, "");
        addCell(fuelRow, "");
    });
}

function addTitleCell(row, sortKey, name, key){
    var cell = row.insertCell();
    
    if(sortKey == key){
        cell.innerHTML = `<a href="?sort=${key}" class="link-primary">${name} ↓</a>`;;
    } else {
        cell.innerHTML = `<a href="?sort=${key}" class="link-primary">${name}</a>`;;
    }
}

function addRow(site){
    var row = table.insertRow();

    if(site.status == "Under Construction"){
        row.className = "table-warning";
    }

    if(site.status == "Commissioning"){
        row.className = "table-success";
    }
    
    row.insertCell().innerHTML = `<b>${site.name}</b>${(site.locationDescription != undefined) ? ` ${site.locationDescription}` : ""}`
    addCell(row, site.operator);
    addCell(row, formatFuel(site.fuel));
    addCell(row, site.status);
    addCell(row, formatDate(site.openBy));
    addCell(row, (site.capacityMW || site.predictedCapacityMW || '?') + " MW");
    addCell(row, formatAdditionalCapacityInformation(site));
    
    if (site.fuel === "Battery") {
        addCell(row, "N/A");
    } else if(site.yearlyGenerationGWh === undefined){
        addCell(row, "? GWh");
    } else {
        addCell(row, site.yearlyGenerationGWh + " GWh");
    }

    addCell(row, site.costMillionDollars ? `$${site.costMillionDollars}m` : '');

    row.insertCell().innerHTML = `<a href=${site.link} target='_blank'>↗</a>`
}

function addCell(row, text){
    row.insertCell().appendChild(document.createTextNode(text));
}

function formatDate(date){
    if(date === undefined){
        return "";
    }

    return new Date(date).toLocaleDateString('en-NZ', { year: 'numeric', month: 'long' });
}

function formatAdditionalCapacityInformation(site){
    if(site.capacityMWh){
        return site.capacityMWh + " MWh";
    }

    if(site.capacityMWp){
        return site.capacityMWp + " MWp";
    }

    return "";
}

function sortList(list, sortKey){
    switch (sortKey) {
        case 'name': return list.sort((a, b) => a.name.localeCompare(b.name))
        case 'annualGeneration': return list.sort(sortAnnualGenerationItems)
        case 'type': return list.sort((a, b) => a.fuel.localeCompare(b.fuel))
        case 'operator': return list.sort((a, b) => a.operator.localeCompare(b.operator))
        case 'nameplate': return list.sort(sortCapacity)
        case 'opening': return list.sort(sortOpening)
        case 'status': return list.sort((a, b) => a.status.localeCompare(b.status))
        case 'cost': return list.sort(sortByCost)
        default: return list
    }
}

function sortByCost(a, b){
    if(a.costMillionDollars === undefined){
        return 1;
    } else if(b.costMillionDollars === undefined){
        return -1;
    }

    return b.costMillionDollars - a.costMillionDollars
}

function sortCapacity(a, b){
    if(a.capacityMW === undefined){
        return 1
    } else if(b.capacityMW === undefined){
        return -1
    }

    return b.capacityMW - a.capacityMW
}

function sortOpening(a, b){
    if(a.openBy === undefined){
        return 1
    } else if(b.openBy === undefined){
        return -1
    }

    return new Date(a.openBy) - new Date(b.openBy)
}

function sortAnnualGenerationItems(a, b){
    if(a.yearlyGenerationGWh === undefined){
        return 1
    } else if(b.yearlyGenerationGWh === undefined){
        return -1
    }

    return b.yearlyGenerationGWh - a.yearlyGenerationGWh
}

populatePipelineTable();