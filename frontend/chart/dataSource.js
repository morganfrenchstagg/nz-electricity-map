const MILISECONDS_IN_SECOND = 1000;

export class DataSource {
    constructor(dataSelection) {
        this.dataSelection = dataSelection;
        this.callbacks = [];
        this.data = null;
    }

    async start(updateIntervalInSeconds = 60) {
        window.setInterval(() => this.update(), updateIntervalInSeconds * MILISECONDS_IN_SECOND); // Update every minute
        await this.update(); // Initial fetch
    }

    getData() {
        return this.data;
    }

    subscribe(callback) {
        this.callbacks.push(callback);
    }

    async update() {
        let response = {};

        // todo - don't update unless you are looking at 'live' data

        if(this.dataSelection){
            response = await fetch("https://api.electricitymap.frenchsta.gg/v1/dispatch/" + this.dataSelection);
        } else {
            response = await fetch("https://api.electricitymap.frenchsta.gg/v1/dispatch/recent");
        }

        const responseJson = await response.json();

        this.data = responseJson;   
        this.callbacks.forEach(callback => callback());
    }
}