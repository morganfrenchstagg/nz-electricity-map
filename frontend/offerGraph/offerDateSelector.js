import { formatDate, getCurrentTimeInNZ } from "../utilities/units.js";

const MIN_DATE = '2025-01-01'; // Earliest date with offer data

export class OfferDateSelector {
    constructor(initialDate) {
        this.selectedDate = initialDate || formatDate(getCurrentTimeInNZ());
        this.subscribers = [];
        this.blockSelectionChanges = false;
        this.render();
    }

    disableSelectionChanges(){
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
            callback(this.selectedDate);
        });
    }

    render() {
        let element = document.getElementById("date-selector");
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
        previous.disabled = this.selectedDate === MIN_DATE;

        element.appendChild(previous);

        //////////
        /// Text Box
        //////////
        let textBox = document.createElement("span");
        textBox.id = "date";
        textBox.classList.add("input-group-text");
        textBox.innerHTML = new Date(this.selectedDate).toLocaleDateString('en-NZ', {
            year: "numeric",
            month: "short",
            day: "numeric"
        });

        element.appendChild(textBox);

        //////////
        /// Next Button
        //////////
        let next = document.createElement("button");
        next.classList.add("btn", "btn-secondary");
        next.innerText = "->";
        next.type = "button";
        next.addEventListener("click", () => this.changeDate(+1));
        next.disabled = this.selectedDate === formatDate(getCurrentTimeInNZ());

        element.appendChild(next);

        //////////
        /// Datepicker Itself
        //////////
        new Datepicker('#date', {
            onChange: ((date) => this.datePickerChanged(date)),
            min: (() => new Date(`${MIN_DATE}T00:00:00`))(),
            max: (() => getCurrentTimeInNZ())(),
            openOn: (() => new Date(this.selectedDate))()
        });
    }

    changeDate(modifier) {
        if (this.blockSelectionChanges) {
            console.warn("blockSelectionChanges is true");
            return;
        }

        let currentSelectedDate = new Date(this.selectedDate);
        let modifiedDate = new Date(currentSelectedDate.getTime());
        modifiedDate.setDate(currentSelectedDate.getDate() + modifier);

        if (modifiedDate.getTime() > getCurrentTimeInNZ().getTime()) {
            return;
        }

        if (modifiedDate.getTime() < new Date(MIN_DATE).getTime()) {
            return;
        }

        this.update(formatDate(modifiedDate));
    }

    datePickerChanged(date) {
        if (this.blockSelectionChanges) {
            console.warn("blockSelectionChanges is true");
            return;
        }
        if (date === undefined) return;

        this.update(formatDate(date));
    }

    update(date) {
        if (this.blockSelectionChanges) {
            console.warn("blockSelectionChanges is true");
            return;
        }

        this.selectedDate = date;
        this.render();
        this.notify();
    }

    updateWithoutNotify(date) {
        if (this.blockSelectionChanges) {
            console.warn("blockSelectionChanges is true");
            return;
        }

        this.selectedDate = date;
        this.render();
    }

    getSelectedDate() {
        return this.selectedDate;
    }
}
