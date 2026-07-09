export function createHighchart(title, subtitle, xAxisLabels, seriesData, plotLines, plotBands, tooltipFormatter, onRedraw) {
    Highcharts.chart('generation-chart', {
        chart: {
            type: 'area',
            zoomType: 'x',

            events: {
                redraw: onRedraw
            }
        },

        title: {
            text: title,
            align: 'center'
        },

        subtitle: {
            text: subtitle,
            align: 'center'
        },

        tooltip: {
            shared: true,
            crosshairs: true,
            useHtml: true,
            formatter: tooltipFormatter
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
            categories: xAxisLabels,
            plotLines: plotLines,
            plotBands: plotBands
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

        series: seriesData,

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
    });
}