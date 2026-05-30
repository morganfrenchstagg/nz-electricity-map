import { createHighchart } from '../graph/graphChart.js';

const DIV_ID = 'generation-chart';

export class Chart {
    constructor(tooltipFormatter) {
        this.xAxisLabels = [];
        this.series = [];
        this.plotLines = [];
        this.plotBands = [];
        this.title = "Electricity Generation Mix";
        this.subtitle = "";
        this.formatTooltip = tooltipFormatter;
    }

    updateSeries(xAxisLabels, series) {
        this.xAxisLabels = xAxisLabels;
        this.series = series;
        this.render();
    }

    onRedraw(event) {
        console.log('Chart redrawn');
    }

    render() {
        Highcharts.chart(DIV_ID, {
            chart: {
                type: 'area',
                zoomType: 'x',

                events: {
                    redraw: this.onRedraw.bind(this)
                }
            },

            title: {
                text: this.title,
                align: 'center'
            },

            subtitle: {
                text: this.subtitle,
                align: 'center'
            },

            tooltip: {
                shared: true,
                crosshairs: true,
                useHtml: true,
                formatter: this.formatTooltip
            },

            credits: {
                enabled: false
            },

            yAxis: {
                title: {
                    text: 'Generation (MW)'
                },
                startOnTick: false,
                endOnTick: false,
            },

            xAxis: {
                categories: this.xAxisLabels,
                plotLines: this.plotLines,
                plotBands: this.plotBands
            },

            legend: {
                layout: 'vertical',
                align: 'right',
                verticalAlign: 'middle'
            },

            plotOptions: {
                series: {
                    label: {
                        connectorAllowed: true
                    },
                    pointStart: 0,
                    marker: {
                        enabled: false
                    },
                    animation: false
                },
                area: {
                    stacking: 'normal'
                }
            },

            series: this.series,

            responsive: {
                rules: [{
                    condition: {
                        maxWidth: 900
                    },
                    chartOptions: {
                        legend: {
                            layout: 'horizontal',
                            verticalAlign: 'bottom',
                        }
                    }
                },
                {
                    condition: {
                        maxWidth: 400
                    },
                    chartOptions: {
                        legend: {
                            enabled: false
                        }
                    }
                }]
            }
        }
        );
    }
}