/*! callstats Amazon SHIM version = 1.1.5 */

(function (global) {
  var CallstatsAmazonShim = function(callstats) {
    CallstatsAmazonShim.callstats = callstats;
    var csioPc = null;
    var confId;
    var SoftphoneErrorTypes;
    var RTCErrorTypes;
    var isCallDetailsSent = false;
    var callDetails = {
      role: "agent",
    }

    function isAmazonPC(pcConfig) {
      if (!pcConfig.iceServers) {
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

    function initPCShim () {
      var origPeerConnection = window.RTCPeerConnection;
      window.RTCPeerConnection = function(pcConfig, pcConstraints) {
        if (pcConfig && pcConfig.iceTransportPolicy) {
          pcConfig.iceTransports = pcConfig.iceTransportPolicy;
        }

        var pc = new origPeerConnection(pcConfig, pcConstraints);
        if(isAmazonPC(pcConfig)) {
          handleSessionCreated(pc);
        }
        return pc;
      }
      window.RTCPeerConnection.prototype = origPeerConnection.prototype;
      if (window.RTCPeerConnection.prototype.csiogetStats) {
        window.RTCPeerConnection.prototype.getStats = window.RTCPeerConnection.prototype.csiogetStats;
      }
    }

    function subscribeToAmazonContactEvents(contact) {
      confId = contact.getContactId();
      CallstatsAmazonShim.remoteId = contact.getActiveInitialConnection().getEndpoint().phoneNumber + "";
      callDetails.contactID = confId;
      callDetails.callType = contact.getActiveInitialConnection().getType();
      if (!confId) {
        confId = CallstatsAmazonShim.localUserID + ":" + CallstatsAmazonShim.remoteId;
      }
      if (!callDetails.callType) {
        callDetails.callType = contact.isInbound()?"inbound":"outbound";
      }
      const contactQueueInfo = contact.getQueue();
      if (contactQueueInfo) {
        callDetails.contactQueue = contactQueueInfo.name;
        callDetails.contactQueueID = contactQueueInfo.queueARN;
      }
      contact.onEnded(function() {
        if (!isCallDetailsSent) {
          CallstatsAmazonShim.callstats.sendCallDetails(csioPc, confId, callDetails);
          isCallDetailsSent = true;
        }
      });

      contact.onAccepted(function() {
        callDetails.acceptedTimeStamp = getTimeStamp();
      });

      contact.onConnected(function() {
        callDetails.connectedTimeStamp = getTimeStamp();
        const attributes1 = contact.getAttributes();
        if (attributes1.AgentLocation) {
          callDetails.siteID = attributes1.AgentLocation.value;
        }
        CallstatsAmazonShim.callstats.sendCallDetails(csioPc, confId, callDetails);
        isCallDetailsSent = true;
      });
    }

    function subscribeToAmazonAgentEvents(agent) {
      agent.onSoftphoneError(handleErrors);
      agent.onMuteToggle(handleOnMuteToggle);
      const routingProfileInfo = agent.getRoutingProfile();
      if (!routingProfileInfo) return;
      callDetails.routingProfile = routingProfileInfo.name;
      callDetails.routingProfileID = routingProfileInfo.routingProfileId;
    }

    function handleOnMuteToggle(obj) {
      if (!csioPc || !confId) {
        return;
      }
      if (obj) {
        if (obj.muted) {
          CallstatsAmazonShim.callstats.sendFabricEvent(csioPc,
            CallstatsAmazonShim.callstats.fabricEvent.audioMute, confId);
        } else {
          CallstatsAmazonShim.callstats.sendFabricEvent(csioPc,
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
        conferenceId= CallstatsAmazonShim.localUserID + ":" + (CallstatsAmazonShim.remoteId || CallstatsAmazonShim.localUserID);
      }
      if (error.errorType === SoftphoneErrorTypes.MICROPHONE_NOT_SHARED) {
        CallstatsAmazonShim.callstats.reportError(null, conferenceId, CallstatsAmazonShim.callstats.webRTCFunctions.getUserMedia, error);
      } else if (error.errorType === SoftphoneErrorTypes.SIGNALLING_CONNECTION_FAILURE) {
        CallstatsAmazonShim.callstats.reportError(null, conferenceId, CallstatsAmazonShim.callstats.webRTCFunctions.signalingError, error);
      } else if (error.errorType === SoftphoneErrorTypes.SIGNALLING_HANDSHAKE_FAILURE) {
        CallstatsAmazonShim.callstats.reportError(csioPc, conferenceId, CallstatsAmazonShim.callstats.webRTCFunctions.setLocalDescription, error);
        CallstatsAmazonShim.callstats.sendCallDetails(csioPc, conferenceId, callDetails);
      } else if (error.errorType === SoftphoneErrorTypes.ICE_COLLECTION_TIMEOUT) {
        CallstatsAmazonShim.callstats.reportError(csioPc, conferenceId, CallstatsAmazonShim.callstats.webRTCFunctions.iceConnectionFailure, error);
        CallstatsAmazonShim.callstats.sendCallDetails(csioPc, conferenceId, callDetails);
      } else if (error.errorType === SoftphoneErrorTypes.WEBRTC_ERROR) {
        switch(error.endPointUrl) {
          case RTCErrorTypes.SET_REMOTE_DESCRIPTION_FAILURE:
            CallstatsAmazonShim.callstats.reportError(csioPc, conferenceId, CallstatsAmazonShim.callstats.webRTCFunctions.setRemoteDescription, error);
            CallstatsAmazonShim.callstats.sendCallDetails(csioPc, conferenceId, callDetails);
            break;
        }
      }
    }

    function handleSessionCreated(pc) {
      if (!pc) {
        return;
      }
      csioPc = pc;
      isCallDetailsSent = false;
      const fabricAttributes = {
        remoteEndpointType:   CallstatsAmazonShim.callstats.endpointType.server,
      };
      try {
        CallstatsAmazonShim.callstats.addNewFabric(csioPc, CallstatsAmazonShim.remoteId, CallstatsAmazonShim.callstats.fabricUsage.multiplex,
          confId, fabricAttributes);
      } catch(error) {
        console.log('addNewFabric error ', error);
      }
    }

    function getTimeStamp() {
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

    CallstatsAmazonShim.prototype.initialize = function initialize(connect, appID, appSecret, localUserID, params, csInitCallback, csCallback) {
      CallstatsAmazonShim.callstatsAppID = appID;
      CallstatsAmazonShim.callstatsAppSecret = appSecret;
      CallstatsAmazonShim.localUserID = localUserID;
      CallstatsAmazonShim.csInitCallback = csInitCallback;
      CallstatsAmazonShim.csCallback = csCallback;
      CallstatsAmazonShim.callstats.initialize(appID, appSecret, localUserID, csInitCallback, csCallback, params);
      CallstatsAmazonShim.intialized = true;

      initPCShim();
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

    CallstatsAmazonShim.prototype.sendFabricEvent = function sendFabricEvent(fabricEvent, eventData) {
      if (!csioPc || !confId) {
        return;
      }
      CallstatsAmazonShim.callstats.sendFabricEvent(csioPc, fabricEvent, confId, eventData);
    };

    CallstatsAmazonShim.prototype.sendLogs = function sendLogs(domError) {
      if (!confId) {
        console.warn('Cannot send logs, no active conference found');
        return;
      }
      CallstatsAmazonShim.callstats.reportError(csioPc, confId,
        CallstatsAmazonShim.callstats.webRTCFunctions.applicationError, domError);
    };

    CallstatsAmazonShim.prototype.makePrecallTest = function makePrecallTest(precallTestResultsCallback) {
      if (!precallTestResultsCallback) {
        console.warn('Cannot start precalltest, Invalid arguments');
        return;
      }

      if (typeof precallTestResultsCallback !== 'function') {
        console.warn('Cannot start precalltest, Invalid arguments');
        return;
      }
      CallstatsAmazonShim.callstats.on("preCallTestResults", precallTestResultsCallback);
      CallstatsAmazonShim.callstats.makePrecallTest();
    }
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
