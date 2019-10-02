var $callData = null;
function isTwilioPC(pcConfig) {
  if (!pcConfig) {
    return true;
  }
  if (pcConfig && !pcConfig.iceServers) {
    return true;
  }
  var len = pcConfig.iceServers.length;
  for (var i = 0; i < len; i++) {
    var username = pcConfig.iceServers[i].username;
    if (username && username.includes('pct')) {
      return false;
    }
  }
  return true;
}
function pcCallback (err, msg) {
  console.log("Monitoring status: "+ err + " msg: " + msg);
};

function preCallTestResultsCallback(status, results) {
  //Check the status
  if (status === callStats.callStatsAPIReturnStatus.success) {
    //Results
    var connectivity = results.mediaConnectivity;
    var rtt = results.rtt;
    var loss = results.fractionalLoss;
    var throughput = results.throughput;
  }
  else {
    console.log("Pre-call test could not be run");
  }
}

function getTimestamp() {
  if (!window || !window.performance || !window.performance.now) {
    return Date.now();
  }
  if (!window.performance.timing) {
    return Date.now();
  }
  if (!window.performance.timing.navigationStart) {
    return Date.now();
  }
  return window.performance.now() + window.performance.timing.navigationStart;
}

function initPCShim () {
  var origPeerConnection = window.RTCPeerConnection;
  window.RTCPeerConnection = function(pcConfig, pcConstraints) {
    if (pcConfig && pcConfig.iceTransportPolicy) {
      pcConfig.iceTransports = pcConfig.iceTransportPolicy;
    }

    var pc = new origPeerConnection(pcConfig, pcConstraints);
    if(isTwilioPC(pcConfig)) {
      if (pcConfig) {
        let attemptToSendFabricData = 0; 
        const maxNoAttempt = 30;
        function attemptingtoSendData() {
          if ($callData.task.defaultFrom && $callData.task.conference) {
            if ($callData.task.conference.conferenceSid) {
              callStats.addNewFabric(pc, $callData.task.defaultFrom, callStats.fabricUsage.multiplex, $callData.task.conference.conferenceSid, null, pcCallback)
              var callDetails = {
                contactID: $callData.task.conference.conferenceSid,
                callType: 'inbound',
                siteID: 'callstats Twilio Flex',
                role: 'agent',
                connectedTimestamp: getTimestamp(),
                acceptedTimestamp: getTimestamp(),
              }
              callStats.sendCallDetails(pc, $callData.task.conference.conferenceSid, callDetails);
              CallstatsJabraShim.startJabraMonitoring(callDetails.contactID);
              return
            }
          }
          setTimeout(function() {
            attemptToSendFabricData++;
            if (attemptToSendFabricData < maxNoAttempt) {
              attemptingtoSendData();
            }
          }, 1000);
        };
        attemptingtoSendData();
      }
    }
    return pc;
  }
  window.RTCPeerConnection.prototype = origPeerConnection.prototype;
  if (window.RTCPeerConnection.prototype.csiogetStats) {
    window.RTCPeerConnection.prototype.getStats = window.RTCPeerConnection.prototype.csiogetStats;
  }
}

initPCShim(); 
var callStats = new callstats();
window.CallstatsJabraShim.initialize(callStats);
