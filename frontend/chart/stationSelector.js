export class StationSelector {
    constructor(selectedStation = null) {
        this.generators = [];
        this.render();
        this.subscribers = [];
        this.selectedStation = selectedStation;
    }

    subscribe(callback) {
        this.subscribers.push(callback);
    }

    setGenerators(generators) {
        this.generators = generators;
        this.render();
    }

    render() {
        let element = document.getElementById('power-station-select');
        element.innerHTML = '';

        var defaultOption = document.createElement("option");
        defaultOption.value = "";
        defaultOption.innerHTML = "Select Power Station";
        element.appendChild(defaultOption);

        this.generators.forEach(station => {
            var option = document.createElement("option");
            option.value = station.site;
            option.innerHTML = this.formatGeneratorName(station);
            element.appendChild(option);
        });

        element.addEventListener('change', () => this.onUpdate(element));
    }

    onUpdate(element) {
        this.selectedStation = element.value;
        this.subscribers.forEach(callback => callback(element.value));
    }

    getSelectedStation() {
        return this.selectedStation;
    }

    formatGeneratorName(generator){
        const fuels = Object.values(generator.units).map(unit => unit.fuelCode.substring(0, 4) === "BESS" ? "Battery" : unit.fuel);
        const unitFuels = new Set(fuels);
        return generator.name + " (" + Array.from(unitFuels).join(", ") + ")";
    }
}