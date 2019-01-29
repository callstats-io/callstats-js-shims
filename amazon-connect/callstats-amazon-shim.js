/*globals Twilio:false, callstats:false, CallstatsTwilio:false */
/*jshint unused:false*/

var SoftphoneErrorTypes = connect.SoftphoneErrorTypes;

(function (global) {
  var CallstatsAmazonShim = function(callstats) {
    CallstatsAmazonShim.callstats = callstats;

    function subscribeToAmazonContactEvents(contact) {
      console.log('incoming or outgoing ', contact.isInbound());
      CallstatsAmazonShim.remoteId = contact.getActiveInitialConnection().getEndpoint().phoneNumber + "";
      if (contact.getActiveInitialConnection()
          && contact.getActiveInitialConnection().getEndpoint()) {
          console.log("New contact is from " + contact.getActiveInitialConnection().getEndpoint().phoneNumber);
      } else {
          console.log("This is an existing contact for this agent");
      }
      contact.onSession(handleSessionCreated);
    }

    function subscribeToAmazonAgentEvents(agent) {
      agent.onSoftphoneError(handleErrors);
    }

    function handleErrors(error) {
      if (!error) {
        return;
      }
      var confId = localId + ":" + remoteId;
      if (error.errorType === SoftphoneErrorTypes.MICROPHONE_NOT_SHARED) {
        CallstatsAmazonShim.callstats.reportError(null, confId, CallstatsAmazonShim.callstats.webRTCFunctions.getUserMedia, error);
      } else if (error.errorType === SoftphoneErrorTypes.SIGNALLING_CONNECTION_FAILURE) {
        CallstatsAmazonShim.callstats.reportError(null, confId, CallstatsAmazonShim.callstats.webRTCFunctions.signalingError, error);
      } else if (error.errorType === SoftphoneErrorTypes.SIGNALLING_HANDSHAKE_FAILURE) {
        CallstatsAmazonShim.callstats.reportError(pc, confId, CallstatsAmazonShim.callstats.webRTCFunctions.setLocalDescription, error);
      } else if (error.errorType === SoftphoneErrorTypes.ICE_COLLECTION_TIMEOUT) {
        CallstatsAmazonShim.callstats.reportError(pc, confId, CallstatsAmazonShim.callstats.webRTCFunctions.iceConnectionFailure, error);
      }
    }

    function getStats(pc) {
      if (pc) {
        pc.getStats()
        .then(rawStats => {
          console.log("stats result 1", rawStats);
          if (rawStats && rawStats.forEach) {
            results = [];
            rawStats.forEach(function(item) {
              results.push(item);
            });
          }
          console.log("stats result", JSON.stringify(results));
        }).catch(err => {console.log("error "),err});
      }
    }

    function handleSessionCreated(session) {
      console.log('handleSessionCreated handleSessionCreated');
      var confId = CallstatsAmazonShim.localUserID + ":" + CallstatsAmazonShim.remoteId;
      var pc = session._pc;
      try {
        setInterval(function() {
          getStats(pc);
        }, 1000);
        console.log("*************** calling addNewFabric");
        CallstatsAmazonShim.callstats.addNewFabric(pc, CallstatsAmazonShim.remoteId, CallstatsAmazonShim.callstats.fabricUsage.multiplex, confId);
      } catch(error) {
        console.log('addNewFabric error ', error);
      }
    }

    CallstatsAmazonShim.prototype.initialize = function initialize(connect, appID, appSecret, localUserID, params, csInitCallback, csCallback) {
      CallstatsAmazonShim.callstatsAppID = appID;
      CallstatsAmazonShim.callstatsAppSecret = appSecret;
      CallstatsAmazonShim.localUserID = localUserID;
      CallstatsAmazonShim.csInitCallback = csInitCallback;
      CallstatsAmazonShim.csCallback = csCallback;
      console.log("************ initialize");
      CallstatsAmazonShim.callstats.initialize(appID, appSecret, localUserID, csInitCallback, csCallback, params);
      CallstatsAmazonShim.intialized = true;
      connect.contact(subscribeToAmazonContactEvents);
      connect.agent(subscribeToAmazonAgentEvents);
      return CallstatsAmazonShim.callstats;
    };
  };
  if (("function" === typeof define) && (define.amd)) { /* AMD support */
  define('callstats-amazon-client', ['callstats'], function(callstats) {
    global.CallstatsAmazonShim = new CallstatsAmazonShim(callstats);
    return  global.CallstatsAmazonShim;
  });
  } else { /* Browsers and Web Workers*/
    var callstats = new window.callstats();
    global.CallstatsAmazonShim = new CallstatsAmazonShim(callstats);
  }
}(this));
