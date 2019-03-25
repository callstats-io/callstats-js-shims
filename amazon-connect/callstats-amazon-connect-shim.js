/*! callstats Amazon SHIM version = 1.0.2 */

(function (global) {
  var CallstatsAmazonShim = function(callstats) {
    CallstatsAmazonShim.callstats = callstats;
    // pc is available in this functional scope
    var pc = null;
    var confId;
    var SoftphoneErrorTypes;
    var RTCErrorTypes;

    function subscribeToAmazonContactEvents(contact) {
      CallstatsAmazonShim.remoteId = contact.getActiveInitialConnection().getEndpoint().phoneNumber + "";
      CallstatsAmazonShim.callType = contact.getActiveInitialConnection().getType();
      if (!CallstatsAmazonShim.callType) {
        CallstatsAmazonShim.callType = contact.isInbound()?"inbound":"outbound";
      }
      contact.onSession(handleSessionCreated);
    }

    function subscribeToAmazonAgentEvents(agent) {
      agent.onSoftphoneError(handleErrors);
      agent.onMuteToggle(handleOnMuteToggle);
    }

    function handleOnMuteToggle(obj) {
      if (!pc || !confId) {
        return;
      }
      if (obj) {
        if (obj.muted) {
          CallstatsAmazonShim.callstats.sendFabricEvent(pc,
            CallstatsAmazonShim.callstats.fabricEvent.audioMute, confId);
        } else {
          CallstatsAmazonShim.callstats.sendFabricEvent(pc,
            CallstatsAmazonShim.callstats.fabricEvent.audioUnmute, confId);
        }
      }
    }

    function handleErrors(error) {
      if (!error) {
        return;
      }
      var conferenceId = confId;
      if (!conferenceId) {
        conferenceId= localId + ":" + (CallstatsAmazonShim.remoteId || localId);
      }
      if (error.errorType === SoftphoneErrorTypes.MICROPHONE_NOT_SHARED) {
        CallstatsAmazonShim.callstats.reportError(null, conferenceId, CallstatsAmazonShim.callstats.webRTCFunctions.getUserMedia, error);
      } else if (error.errorType === SoftphoneErrorTypes.SIGNALLING_CONNECTION_FAILURE) {
        CallstatsAmazonShim.callstats.reportError(null, conferenceId, CallstatsAmazonShim.callstats.webRTCFunctions.signalingError, error);
      } else if (error.errorType === SoftphoneErrorTypes.SIGNALLING_HANDSHAKE_FAILURE) {
        CallstatsAmazonShim.callstats.reportError(pc, conferenceId, CallstatsAmazonShim.callstats.webRTCFunctions.setLocalDescription, error);
        CallstatsAmazonShim.callstats.sendCallDetails(pc, conferenceId, {callType: CallstatsAmazonShim.callType, role: 'agent'});
      } else if (error.errorType === SoftphoneErrorTypes.ICE_COLLECTION_TIMEOUT) {
        CallstatsAmazonShim.callstats.reportError(pc, conferenceId, CallstatsAmazonShim.callstats.webRTCFunctions.iceConnectionFailure, error);
        CallstatsAmazonShim.callstats.sendCallDetails(pc, conferenceId, {callType: CallstatsAmazonShim.callType, role: 'agent'});
      } else if (error.errorType === SoftphoneErrorTypes.WEBRTC_ERROR) {
        switch(error.endPointUrl) {
          case RTCErrorTypes.SET_REMOTE_DESCRIPTION_FAILURE:
            CallstatsAmazonShim.callstats.reportError(pc, conferenceId, CallstatsAmazonShim.callstats.webRTCFunctions.setRemoteDescription, error);
            CallstatsAmazonShim.callstats.sendCallDetails(pc, conferenceId, {callType: CallstatsAmazonShim.callType, role: 'agent'});
            break;
        }
      }
    }

    function handleSessionCreated(session) {
      confId = CallstatsAmazonShim.localUserID + ":" + CallstatsAmazonShim.remoteId;
      pc = session._pc;
      try {
        CallstatsAmazonShim.callstats.addNewFabric(pc, CallstatsAmazonShim.remoteId, CallstatsAmazonShim.callstats.fabricUsage.multiplex, confId);
      } catch(error) {
        console.log('addNewFabric error ', error);
      }
      CallstatsAmazonShim.callstats.sendCallDetails(pc, confId, {callType: CallstatsAmazonShim.callType, role: 'agent'});
    }

    CallstatsAmazonShim.prototype.initialize = function initialize(connect, appID, appSecret, localUserID, params, csInitCallback, csCallback) {
      CallstatsAmazonShim.callstatsAppID = appID;
      CallstatsAmazonShim.callstatsAppSecret = appSecret;
      CallstatsAmazonShim.localUserID = localUserID;
      CallstatsAmazonShim.csInitCallback = csInitCallback;
      CallstatsAmazonShim.csCallback = csCallback;
      CallstatsAmazonShim.callstats.initialize(appID, appSecret, localUserID, csInitCallback, csCallback, params);
      CallstatsAmazonShim.intialized = true;
      connect.contact(subscribeToAmazonContactEvents);
      connect.agent(subscribeToAmazonAgentEvents);
      SoftphoneErrorTypes = connect.SoftphoneErrorTypes;
      RTCErrorTypes = connect.RTCErrors;
      return CallstatsAmazonShim.callstats;
    };

    CallstatsAmazonShim.prototype.sendUserFeedback = function sendUserFeedback(feedback, callback) {
      if (!confId) {
        console.warn('Cannot send user feedback, no active conference found');
        return;
      }
      CallstatsAmazonShim.callstats.sendUserFeedback(confId, feedback, callback);
    };

    CallstatsAmazonShim.prototype.sendFabricEvent = function sendFabricEvent(feedback, callback) {
      if (!pc || !confId) {
        return;
      }
      CallstatsAmazonShim.callstats.sendFabricEvent(pc, fabricEvent, confId, eventData);
    };

    CallstatsAmazonShim.prototype.sendLogs = function sendLogs(domError) {
      if (!confId) {
        console.warn('Cannot send logs, no active conference found');
        return;
      }
      CallstatsAmazonShim.callstats.reportError(pc, confId,
        CallstatsAmazonShim.callstats.webRTCFunctions.applicationError, domError);
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
