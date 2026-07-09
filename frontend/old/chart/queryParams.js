const TIMEFRAME_QUERY_PARAM = "timeframe";
const DATE_QUERY_PARAM = "date";

export class QueryParams {
    constructor(){
        var queryParams = new URLSearchParams(window.location.search)

        this.timeframe = queryParams.get(TIMEFRAME_QUERY_PARAM);
        this.date = queryParams.get(DATE_QUERY_PARAM);
    }

    setRelativeTimeframe(value){
        this.setQueryParam(DATE_QUERY_PARAM, "")
        this.setQueryParam(TIMEFRAME_QUERY_PARAM, value)
    }

    setAbsoluteTimeframe(value){
        this.setQueryParam(DATE_QUERY_PARAM, value)
        this.setQueryParam(TIMEFRAME_QUERY_PARAM, "")
    }

    setQueryParam(param, value) {
        var searchParams = new URLSearchParams(window.location.search);

        if (value === "") {
            searchParams.delete(param);
        } else {
            searchParams.set(param, value);
        }

        var newRelativePathQuery = window.location.pathname + '?' + searchParams.toString();
        history.replaceState(null, '', newRelativePathQuery);
    }
}