PexRTC.prototype.event_newPC = function(pc, _uuid, _conf, call_type, cb) {
    var self = this;

    if (callstats) {
        self.onLog("CS: creating object");
        self.callStats = new callstats($, io, jsSHA);

        console.log("CS: Initializing");
        self.callStats.initialize("1234567890", "randomdata=", self.uuid, function(err, msg) {
            console.log("Initializing Status: err="+err+" msg="+msg);
            console.log("CS New PC");
            var usage = self.callStats.fabricUsage.unbundled;
            if (call_type == 'audio_only') {
                usage = self.callStats.fabricUsage.audio;
            } else if (call_type == 'screen') {
                usage = self.callStats.fabricUsage.screen;
            }
            self.callStats.addNewFabric(pc, self.uuid, usage, self.conference, function(err, msg) {console.log("CallStats: Monitoring status: "+ err + " msg: " + msg);});
        });
    }
};

PexRTC.prototype.event_event = function(pc, _conf, ev) {
    var self = this;

    console.log("CS Event: " + ev);
    if (self.callStats && ev in self.callStats.fabricEvent) {
        self.callStats.sendFabricEvent(pc, self.callStats.fabricEvent[ev], self.conference);
    }
};

PexRTC.prototype.event_error = function(pc, _conf, ev, err, sdp) {
    var self = this;

    console.log("CS Error: " + ev);
    if (self.callStats && ev in self.callStats.wrtcFuncNames) {
        self.callStats.reportError(pc, self.conference, self.callStats.wrtcFuncNames[ev], err, sdp);
    }
};
