/** Time-series interval enumeration. */
export var Interval;
(function (Interval) {
    Interval[Interval["Last5m"] = 0] = "Last5m";
    Interval[Interval["Last15m"] = 1] = "Last15m";
    Interval[Interval["Last30m"] = 2] = "Last30m";
    Interval[Interval["Last60m"] = 3] = "Last60m";
    Interval[Interval["Last180m"] = 4] = "Last180m";
})(Interval || (Interval = {}));
