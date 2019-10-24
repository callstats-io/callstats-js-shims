/*! callstats Amazon SHIM version = 1.2.1 */

(function (global) {
  class VoiceActivityDetection {
    constructor(stream, callback) {  
      this.AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new this.AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.1;
      this.fftBins = new Float32Array(this.analyser.frequencyBinCount);
      this.mediaStreamSource = this.audioContext.createMediaStreamSource(stream);
      this.mediaStreamSource.connect(this.analyser);

      this.audioProcessor = this.audioContext.createScriptProcessor(512);
      this.audioProcessor.connect(this.audioContext.destination);
      this.audioProcessor.onaudioprocess = this.handleAudioProcess.bind(this);
      
      this.isSpeaking = false;
      this.maxVolumeHistory = [];
      for (var i=0; i < 10; i++) {
        this.maxVolumeHistory.push(0);
      }
      this.threshold = -50;
      this.interval = 50;
      this.callback = callback;
      this.isClipping = false;
      this.start();
      this.totalSamples = 0;
      this.clippedSamples = 0;
    }

    handleAudioProcess(audioEvent) {
      const leftAudioBuffer = audioEvent.inputBuffer.getChannelData(0);
      const rightAudioBuffer = audioEvent.inputBuffer.getChannelData(1);
      const leftClip = this.checkClipping(leftAudioBuffer);
      const rightClip = this.checkClipping(rightAudioBuffer);
      if ((leftClip || rightClip) && !this.isClipping) {
        this.isClipping = true;
        this.callback('ClippingStart');
      } else if (!leftClip && !rightClip && this.isClipping) {
        this.isClipping = false;
        this.callback('ClippingStop', {totalSamples: this.totalSamples, clippedSamples: this.clippedSamples});
        this.totalSamples = 0;
        this.clippedSamples = 0;
      }
    }

    checkClipping(audioBuffer) {
      var clippingSamples = 0;

      for (var i = 0; i < audioBuffer.length; i++) {
        var absValue = Math.abs(audioBuffer[i]);
        if (absValue >= 1.0) {
          clippingSamples++;
        }
      }
      this.totalSamples += audioBuffer.length;
      if (clippingSamples > 0) {
        this.clippedSamples += clippingSamples;
        return true;
      } else {
        return false;
      }
    }

    getMaxVolume () {
      var maxVolume = -Infinity;
      this.analyser.getFloatFrequencyData(this.fftBins);
    
      for(var i=4; i < this.fftBins.length; i++) {
        if (this.fftBins[i] > maxVolume && this.fftBins[i] < 0) {
          maxVolume = this.fftBins[i];
        }
      };    
      return maxVolume;
    }

    start() {
      var self = this;
      if (self.timer) {
        return;
      }
      self.timer = setInterval(function() {
        self.detect();
      }, self.interval);
    }

    detect() {
      var maxVolume = this.getMaxVolume();
      var totalMaxVolume = 0;
      if (maxVolume > this.threshold && !this.speaking) {
        for (var i = this.maxVolumeHistory.length - 3; i < this.maxVolumeHistory.length; i++) {
          totalMaxVolume += this.maxVolumeHistory[i];
        }
        if (totalMaxVolume >= 2) {
          this.isSpeaking = true;
          this.callback('SpeakingStart');
        }
      } else if (maxVolume < this.threshold && this.isSpeaking) {
        for (var i = 0; i < this.maxVolumeHistory.length; i++) {
          totalMaxVolume += this.maxVolumeHistory[i];
        }
        if (totalMaxVolume == 0) {
          this.isSpeaking = false;
          this.callback('SpeakingStop');
        }
      }
      this.maxVolumeHistory.shift();
      this.maxVolumeHistory.push(0 + (maxVolume > this.threshold));
    }

    stop() {
      clearInterval(this.timer);
      if (this.isSpeaking) {
        this.isSpeaking = false;
        this.callback('SpeakingStop');
      }
      this.analyser.disconnect();
      this.mediaStreamSource.disconnect();
      this.audioProcessor.disconnect();
    }
  };

  var CallstatsAmazonShim = function(callstats) {
    CallstatsAmazonShim.callstats = callstats;
    var csioPc = null;
    var confId;
    var SoftphoneErrorTypes;
    var RTCErrorTypes;
    var isCallDetailsSent = false;
    var callState = null;
    var collectJabraStats = false;
    var enableVoiceActivityDetection = true;
    var callDetails = {
      role: "agent",
    }
    var localAudioAnalyser, remoteAudioAnalyser;

    var agentSpeakingStarted = false;
    var contactSpeakingStarted = false;
    var crossTalkStarted = false;
    
    var agentSpeakingState = false; 
    var contactSpeakingState = false;

    var prevSpeakingState = null;
    let eventList = [];

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
      callDetails.originalContactID = contact.getOriginalContactId();
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
      if (collectJabraStats) {
        CallstatsJabraShim.startJabraMonitoring(confId);
      }
      contact.onEnded(function() {
        if (!isCallDetailsSent) {
          CallstatsAmazonShim.callstats.sendCallDetails(csioPc, confId, callDetails);
          isCallDetailsSent = true;
        }
        if (collectJabraStats) {
          CallstatsJabraShim.stopJabraMonitoring();
        }
        if (enableVoiceActivityDetection) {
          localAudioAnalyser.stop();
          remoteAudioAnalyser.stop();
          if (eventList.length > 0) {
            CallstatsAmazonShim.callstats.sendCustomEvent(null, 
              confId, eventList);
            eventList = [];
          }
        }
      });

      contact.onAccepted(function() {
        callDetails.acceptedTimestamp = getTimestamp();
      });

      contact.onConnected(function() {
        callDetails.connectedTimestamp = getTimestamp();
        const attributes1 = contact.getAttributes();
        if (attributes1 && attributes1.AgentLocation) {
          callDetails.siteID = attributes1.AgentLocation.value;
        }
        CallstatsAmazonShim.callstats.sendCallDetails(csioPc, confId, callDetails);
        isCallDetailsSent = true;
        callState = null;
        if (!enableVoiceActivityDetection) {
          return;
        }

        var localStream = csioPc.getLocalStreams();
        var remoteStream = csioPc.getRemoteStreams();

        if (localStream && localStream[0]) {
          localAudioAnalyser = new VoiceActivityDetection(localStream[0], function(arg1, arg2) {
            if (arg1 === 'SpeakingStart') {
              agentSpeakingState = true;
            } else if (arg1 === 'SpeakingStop') {
              agentSpeakingState = false;
            } else if (arg1 === 'ClippingStart') {
              sendCustomEvent('clippingStart');
            } else if (arg1 === 'ClippingStop') {
              sendCustomEvent('clippingStop', arg1);
            }
            handleSpeakingState();
          });
        }
        
        if (remoteStream && remoteStream[0]) {
          remoteAudioAnalyser = new VoiceActivityDetection(remoteStream[0], function(arg1) {
            if (arg1 === 'SpeakingStart') {
              contactSpeakingState = true;
            } else if (arg1 === 'SpeakingStop') {
              contactSpeakingState = false;
            }
            handleSpeakingState();
          });
        }
      });

      contact.onRefresh(currentContact => {
        // check the current hold state and pause or resume fabric based on current hold state
        const currentStatus = connection ? connection.getStatus() : null;
        if (!currentStatus || !currentStatus.type) {
          return;
        }
        const currentCallState = currentStatus.type;
        if (currentCallState === 'hold' && callState !== 'hold') {
          callState = 'hold';
          CallstatsAmazonShim.callstats.sendFabricEvent(csioPc,
            CallstatsAmazonShim.callstats.fabricEvent.fabricHold, confId);
        } else if(currentCallState === 'connected' && callState === 'hold') {
          callState = 'connected';
          CallstatsAmazonShim.callstats.sendFabricEvent(csioPc,
            CallstatsAmazonShim.callstats.fabricEvent.fabricResume, confId);
        }
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

    function sendCustomEvent(eventType, eventData) {
      if (prevSpeakingState === eventType) {
        return;
      }
      prevSpeakingState = eventType;
      var event = {
        type: eventType,
        timestamp: getTimestamp(),
        source: 'CSIOAlgorithm',
      }

      if (eventType === 'clippingStop' && eventData) {
        event.totalSamples = eventData.totalSamples;
        event.clippedSamples = eventData.clippedSamples;
      }

      eventList.push(event);
      if (eventList.length === 40) {
        CallstatsAmazonShim.callstats.sendCustomEvent(null, confId, eventList);
        eventList = [];
      }
    }

    function handleSpeakingState() {
      if (!agentSpeakingStarted && agentSpeakingState) {
        agentSpeakingStarted = true;
      } else if (agentSpeakingState === false && agentSpeakingStarted) {
        agentSpeakingStarted = false;
        if (!crossTalkStarted) {
          sendCustomEvent('agentSpeakingStop');
        }
      }

      if (!contactSpeakingStarted && contactSpeakingState) {
        contactSpeakingStarted = true;
      } else if (contactSpeakingState === false && contactSpeakingStarted) {
        contactSpeakingStarted = false;
        if (!crossTalkStarted) {
          sendCustomEvent('contactSpeakingStop');
        }
      }

      if (contactSpeakingStarted && agentSpeakingStarted) {
        crossTalkStarted = true;
      } else if (crossTalkStarted && (contactSpeakingStarted || agentSpeakingStarted)) {
        crossTalkStarted = false;
        sendCustomEvent('crossTalkStop');
      }

      if (crossTalkStarted) {
        sendCustomEvent('crossTalkStart');
      } else if (agentSpeakingStarted) {
        sendCustomEvent('agentSpeakingStart');
      } else if (contactSpeakingStarted) {
        sendCustomEvent('contactSpeakingStart');
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

    CallstatsAmazonShim.prototype.initialize = function initialize(connect, appID, appSecret, localUserID, params, csInitCallback, csCallback) {
      CallstatsAmazonShim.callstatsAppID = appID;
      CallstatsAmazonShim.callstatsAppSecret = appSecret;
      CallstatsAmazonShim.localUserID = localUserID;
      CallstatsAmazonShim.csInitCallback = csInitCallback;
      CallstatsAmazonShim.csCallback = csCallback;
      CallstatsAmazonShim.callstats.initialize(appID, appSecret, localUserID, csInitCallback, csCallback, params);
      CallstatsAmazonShim.intialized = true;

      initPCShim();

      if (params && params.enableJabraCollection) {
        collectJabraStats = true;
        CallstatsJabraShim.initialize(CallstatsAmazonShim.callstats);
      }

      if (params && params.enableVoiceActivityDetection === false) {
        enableVoiceActivityDetection = false;
      }

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
        console.warn('Cannot send fabricEvent, no active conference found');
        return;
      }
      CallstatsAmazonShim.callstats.sendFabricEvent(csioPc, fabricEvent, confId, eventData);
    };

    CallstatsAmazonShim.prototype.sendCustomEvent = function sendCustomEvent(eventList) {
      if (!confId) {
        console.warn('Cannot send customEvent, no active conference found');
        return;
      }
      CallstatsAmazonShim.callstats.sendCustomEvent(null, confId, eventList);
    }

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

    // workaround to get peer connection -> remote stream
    CallstatsAmazonShim.prototype.getPeerConnection = function getPeerConnection() {
      if (!csioPc || !confId) {
        console.warn('Cannot get peer connection. no active conference found');
        return;
      }
      return csioPc;
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
