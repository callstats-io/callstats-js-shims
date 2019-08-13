var $callData = null;
function isTwilioPC(pcConfig) {
  console.warn('isTwilioPC ', pcConfig);
  if (!pcConfig) {
    return true;
  }
  if (pcConfig && !pcConfig.iceServers) {
    console.warn('isTwilioPC true');
    return true;
  }
  var len = pcConfig.iceServers.length;
  for (var i = 0; i < len; i++) {
    var username = pcConfig.iceServers[i].username;
    if (username && username.includes('pct')) {
      console.warn('isTwilioPC false');
      return false;
    }
  }
  console.warn('isTwilioPC true');
  return true;
}
function pcCallback (err, msg) {
  console.log("Monitoring status: "+ err + " msg: " + msg);
};

function preCallTestResultsCallback(status, results) {
  //Check the status
  if (status == callStats.callStatsAPIReturnStatus.success) {
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

function initPCShim () {
  var origPeerConnection = window.RTCPeerConnection;
  window.RTCPeerConnection = function(pcConfig, pcConstraints) {
    console.warn('creating RTCPeerConnection', pcConfig, pcConstraints);
    if (pcConfig && pcConfig.iceTransportPolicy) {
      pcConfig.iceTransports = pcConfig.iceTransportPolicy;
    }

    var pc = new origPeerConnection(pcConfig, pcConstraints);
    if(isTwilioPC(pcConfig)) {
      if (pcConfig) {
        let attemptToSendFabricData = 0; 
        const maxNoAttempt = 30;
        function attemptingtoSendData() {
          console.warn('attemptingtoSendData attemptingtoSendData ', maxNoAttempt, $callData.task);
          if ($callData.task.defaultFrom && $callData.task.conference) {
            if ($callData.task.conference.conferenceSid) {
              // sending fabric data
              console.warn('****** addNewFabric');
              callStats.addNewFabric(pc, $callData.task.defaultFrom, callStats.fabricUsage.multiplex, $callData.task.conference.conferenceSid, null, pcCallback)
              var callDetails = {
                contactID: $callData.task.conference.conferenceSid,
                callType: 'inbound',
                siteID: 'callstats Twilio Flex',
                role: 'agent'
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