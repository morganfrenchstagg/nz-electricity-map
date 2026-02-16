import { underConstruction } from "../utilities/underConstruction.js";
import { formatFuel } from "../utilities/units.js";

var table = document.getElementById('generation-pipeline-table');

function populatePipelineTable(){
    const fuelMap = new Map();
    const yearMap = new Map();
    
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

    sortList(underConstruction, sortKey).forEach(site => {
        addRowToTable({
            name: site.name,
            locationDescription: site.locationDescription,
            operator: site.operator,
            fuel: site.fuel,
            status: site.status,
            commissioning: site.openBy,
            capacityMW: site.capacityMW || site.predictedCapacityMW,
            capacityAlt: formatAdditionalCapacityInformation(site),
            annualGeneration: site.yearlyGenerationGWh,
            cost: site.costMillionDollars,
            link: site.link,
        });

        fuelMap.set(site.fuel, {
            capacity: (fuelMap.get(site.fuel)?.capacity || 0) + (site.capacityMW || site.predictedCapacityMW || 0), 
            generation: (fuelMap.get(site.fuel)?.generation || 0) + (site.yearlyGenerationGWh || 0),
            cost: (fuelMap.get(site.fuel)?.cost || 0) + (site.costMillionDollars !== undefined ? site.costMillionDollars : 0)
        });

        let year = new Date(site.openBy).getFullYear();
        yearMap.set(year, {
            capacity: (yearMap.get(year)?.capacity || 0) + (site.capacityMW || site.predictedCapacityMW || 0), 
            generation: (yearMap.get(year)?.generation || 0) + (site.yearlyGenerationGWh || 0),
            cost: (yearMap.get(year)?.cost || 0) + (site.costMillionDollars !== undefined ? site.costMillionDollars : 0)
        });
    });

    let totalCapacity = 0;
    let totalGeneration = 0;
    let totalCost = 0;
    yearMap.forEach((value) => {
        totalCapacity += value.capacity;
        totalGeneration += value.generation;
        totalCost += value.cost;
    });
    
    var totalRow = table.insertRow();
    totalRow.style.fontWeight = "bold";
    totalRow.className = "table-info";

    addRowToTable({
        name: "Total",
        operator: "",
        fuel: "",
        status: "",
        commissioning: "",
        capacityMW: totalCapacity,
        capacityAlt: "",
        annualGeneration: totalGeneration,
        cost: totalCost,
    }, totalRow);

    addRowToTable();

    yearMap.forEach((value, year) => {
        if(isNaN(year)) return;
        addRowToTable({
            name: `Total in ${year}`,
            operator: "",
            fuel: "",
            status: "",
            commissioning: "",
            capacityMW: value.capacity,
            annualGeneration: value.generation,
            cost: value.cost,
        });
    });

    addRowToTable();

    fuelMap.forEach((value, fuel) => {
        if(value.capacity == 0) return;
        addRowToTable({
            name: "Total for " +formatFuel(fuel),
            operator: "",
            fuel: "",
            status: "",
            commissioning: "",
            capacityMW: value.capacity,
            capacityAlt: "",
            annualGeneration: value.generation,
            cost: value.cost,
        });
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

function addRowToTable(rowDetails, row){
    var row = row || table.insertRow();

    if(rowDetails?.status == "Under Construction"){
        row.className = "table-warning";
    }

    if(rowDetails?.status == "Commissioning"){
        row.className = "table-success";
    }

    if(rowDetails?.name){
        row.insertCell().innerHTML = `<b>${rowDetails?.name}</b>${(rowDetails?.locationDescription != undefined) ? ` ${rowDetails?.locationDescription}` : ""}`
    } else {
        row.insertCell().innerHTML = "";
    }

    addCell(row, rowDetails?.operator || "");
    addCell(row, rowDetails?.fuel ? formatFuel(rowDetails?.fuel) : "");
    addCell(row, rowDetails?.status || "");
    addCell(row, rowDetails?.commissioning ? formatDate(rowDetails?.commissioning) : "");
    addCell(row, rowDetails?.capacityMW ? rowDetails?.capacityMW.toFixed(1) + " MW" : "");
    addCell(row, rowDetails?.capacityAlt || "");
    addCell(row, rowDetails?.annualGeneration ? rowDetails?.annualGeneration + " GWh" : "");
    
    if(rowDetails?.cost && rowDetails?.cost > 1000){
        addCell(row, `$${(rowDetails?.cost/1000).toFixed(2)}b`);
    } else {
        addCell(row, rowDetails?.cost ? `$${rowDetails?.cost}m` : "");
    }

    if(rowDetails?.link){
        row.insertCell().innerHTML = `<a href=${rowDetails.link} target='_blank'>↗</a>`
    } else {
        row.insertCell().innerHTML = "";
    }
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