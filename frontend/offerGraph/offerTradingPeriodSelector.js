import { formatDate, getCurrentTimeInNZ } from "../utilities/units.js";

const MAX_TP = 48;

export class OfferTradingPeriodSelector {
    constructor(initalTradingPeriod) {
        this.selectedTradingPeriod = +initalTradingPeriod || 1;
        this.subscribers = [];
        this.blockSelectionChanges = false;
        this.render();
    }

    disableSelectionChanges() {
        this.blockSelectionChanges = true;
    }

    enableSelectionChanges() {
        this.blockSelectionChanges = false;
    }

    subscribe(callback) {
        this.subscribers.push(callback);
    }

    notify() {
        this.subscribers.forEach((callback) => {
            callback(this.selectedTradingPeriod);
        });
    }

    render() {
        let element = document.getElementById("trading-period-selector");
        if (!element) return;

        element.innerHTML = "";
        this.renderDatePicker(element);
    }

    renderDatePicker(element) {
        //////////
        /// Previous Button
        //////////
        let previous = document.createElement("button");
        previous.classList.add("btn", "btn-secondary");
        previous.innerText = "<-";
        previous.type = "button";
        previous.addEventListener("click", () => this.changeDate(-1));
        previous.disabled = this.selectedTradingPeriod === 1;

        element.appendChild(previous);

        //////////
        /// Text Box
        //////////
        let textBox = document.createElement("span");
        textBox.id = "date";
        textBox.classList.add("input-group-text");
        const periodStart = (this.selectedTradingPeriod - 1) * 30;
        const hours = Math.floor(periodStart / 60);
        const minutes = periodStart % 60;
        const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        textBox.innerHTML = `Trading Period: ${this.selectedTradingPeriod} (${timeStr})`

        element.appendChild(textBox);

        //////////
        /// Next Button
        //////////
        let next = document.createElement("button");
        next.classList.add("btn", "btn-secondary");
        next.innerText = "->";
        next.type = "button";
        next.addEventListener("click", () => this.changeDate(+1));
        next.disabled = this.selectedTradingPeriod == MAX_TP;

        element.appendChild(next);
    }

    changeDate(modifier) {
        this.update(this.selectedTradingPeriod += modifier);
    }

    datePickerChanged(date) {
        if (this.blockSelectionChanges) {
            console.warn("blockSelectionChanges is true");
            return;
        }
        if (date === undefined) return;

        this.update(formatDate(date));
    }

    update(tradingPeriod) {
        if (this.blockSelectionChanges) {
            console.warn("blockSelectionChanges is true");
            return;
        }

        this.selectedTradingPeriod = tradingPeriod;
        this.render();
        this.notify();
    }
}