/*! callstats Amazon Connect Shim version = 1.5.1 */

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
    this.totalSamples = 0;
    this.clippedSamples = 0;
    this.audioLevelStats = [];
    this.start();
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

  getRMSTimeDomainData() {
    var dataArray = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(dataArray);
    let sum = 0;
    for(var i=0; i < dataArray.length; i++) {
      sum = sum + (dataArray[i] * dataArray[i]);
    }; 
  
    sum = sum / dataArray.length;
    var stats = {
      name: 'webAudioRMSValue',
      value: Math.sqrt(sum),
      timestamp: getTimestamp(),
    }
    this.audioLevelStats.push(stats);
    if (this.audioLevelStats.length === 200) {
      this.callback('AudioLevelMetrics', this.audioLevelStats);
      this.audioLevelStats = [];
    }
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
    this.getRMSTimeDomainData();
  }

  stop() {
    if (this.audioLevelStats.length > 0) {
      this.callback('AudioLevelMetrics', this.audioLevelStats);
      this.audioLevelStats = [];
    }
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

var CallstatsAmazonShim = function() {
  var csioPc = null;
  var confId;
  var SoftphoneErrorTypes;
  var RTCErrorTypes;
  var isCallDetailsSent = false;
  var isConferenceSummarySent = false;
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
  let pcCreationTime = 0;
  let ringingTime = 0;
  let pstnTime = 0;
  let isCallForwarded = false;
  var getUserMediaError = {
    message: "SoftphoneError: MICROPHONE NOT SHARED",
  };

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

  // Overwrite get user media
  function overWriteGetUserMedia() {
    if (!(navigator && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function')) {
      return;
    }

    let original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (constraints) {
      return new Promise(function(resolve, reject) {
        original(constraints)
        .then((stream) => {
          resolve(stream);
        })
        .catch((error) => {
          if (error) {
            getUserMediaError.message = error.message;
            getUserMediaError.name = error.name;
          }
          reject(error);
        })
      });     
    };
  }

  function initPCShim () {
    var origPeerConnection = window.RTCPeerConnection;
    
    overWriteGetUserMedia();
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
    if (contact.getActiveInitialConnection()) {
      CallstatsAmazonShim.remoteId = contact.getActiveInitialConnection().getEndpoint().phoneNumber + "";
      callDetails.callType = contact.getActiveInitialConnection().getType();
    }
    callDetails.originalContactID = contact.getOriginalContactId();
    callDetails.contactID = confId;
    if (!confId) {
      confId = CallstatsAmazonShim.localUserID + ":" + CallstatsAmazonShim.remoteId;
    }

    if (!callDetails.callType) {
      callDetails.callType = contact.isInbound()?"inbound":"outbound";
    }

    try {
      const fabricAttributes = {
          remoteEndpointType:   CallstatsAmazonShim.callstats.endpointType.server,
        };
      if (csioPc) {
        CallstatsAmazonShim.callstats.addNewFabric(csioPc, CallstatsAmazonShim.remoteId, CallstatsAmazonShim.callstats.fabricUsage.multiplex,
          confId, fabricAttributes);
      }
    } catch(error) {
      console.log('addNewFabric error ', error);
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
        if (localAudioAnalyser) {
          localAudioAnalyser.stop();
        }
        if (remoteAudioAnalyser) {
          remoteAudioAnalyser.stop();
        }
        if (eventList.length > 0) {
          CallstatsAmazonShim.callstats.sendCustomEvent(null, 
            confId, eventList);
          eventList = [];
        }
      }
      if (!isConferenceSummarySent) {
        var event = {
          type: 'conferenceSummary',
          timestamp: getTimestamp(),
          pstnTime: pstnTime,
          ringingTime: ringingTime,
          contactID: confId,
          isCallForwarded: isCallForwarded,
        }
        CallstatsAmazonShim.callstats.sendCustomEvent(csioPc, confId, [event]);
        CallstatsAmazonShim.callstats.sendFabricEvent(csioPc,
          CallstatsAmazonShim.callstats.fabricEvent.fabricTerminated, confId);
        isConferenceSummarySent = true;
      }
      confId = null;
    });

    contact.onAccepted(function() {
      callDetails.acceptedTimestamp = getTimestamp();
      ringingTime = callDetails.acceptedTimestamp - pcCreationTime;
    });

    contact.onConnected(function() {
      callDetails.connectedTimestamp = getTimestamp();
      if (callDetails.acceptedTimestamp) {
        pstnTime = callDetails.connectedTimestamp - callDetails.acceptedTimestamp;
      }
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
          } else if (arg1 === 'AudioLevelMetrics') {
            sendCustomStats(arg2);
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
      const connection = currentContact.getActiveInitialConnection();
      const thirdPartyConnection = currentContact.getSingleActiveThirdPartyConnection();
      if (connection && thirdPartyConnection) {
        isCallForwarded = true;
      }
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

  function sendCustomStats(stats) {
    CallstatsAmazonShim.callstats.sendCustomStats(null, 
      confId, stats);
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
      CallstatsAmazonShim.callstats.reportError(null, conferenceId, CallstatsAmazonShim.callstats.webRTCFunctions.getUserMedia, getUserMediaError);
    } else if (error.errorType === SoftphoneErrorTypes.SIGNALLING_CONNECTION_FAILURE) {
      CallstatsAmazonShim.callstats.reportError(null, conferenceId, CallstatsAmazonShim.callstats.webRTCFunctions.signalingError, "SoftphoneError: SIGNALLING CONNECTION FAILURE");
    } else if (error.errorType === SoftphoneErrorTypes.SIGNALLING_HANDSHAKE_FAILURE) {
      CallstatsAmazonShim.callstats.reportError(csioPc, conferenceId, CallstatsAmazonShim.callstats.webRTCFunctions.setLocalDescription, "SoftphoneError: SIGNALLING HANDSHAKE FAILURE");
      CallstatsAmazonShim.callstats.sendCallDetails(csioPc, conferenceId, callDetails);
    } else if (error.errorType === SoftphoneErrorTypes.ICE_COLLECTION_TIMEOUT) {
      CallstatsAmazonShim.callstats.reportError(csioPc, conferenceId, CallstatsAmazonShim.callstats.webRTCFunctions.iceConnectionFailure, "SoftphoneError: ICE COLLECTION TIMEOUT");
      CallstatsAmazonShim.callstats.sendCallDetails(csioPc, conferenceId, callDetails);
    } else if (error.errorType === SoftphoneErrorTypes.WEBRTC_ERROR) {
      switch(error.endPointUrl) {
        case RTCErrorTypes.SET_REMOTE_DESCRIPTION_FAILURE:
          CallstatsAmazonShim.callstats.reportError(csioPc, conferenceId, CallstatsAmazonShim.callstats.webRTCFunctions.setRemoteDescription, "SoftphoneError: SET REMOTE DESCRIPTION FAILURE");
          CallstatsAmazonShim.callstats.sendCallDetails(csioPc, conferenceId, callDetails);
          break;
      }
    } else {
      CallstatsAmazonShim.callstats.reportError(csioPc, conferenceId, CallstatsAmazonShim.callstats.webRTCFunctions.signalingError, "SoftphoneError: Other Softphone error" + error.errorType);
      CallstatsAmazonShim.callstats.sendCallDetails(csioPc, conferenceId, callDetails);
    }
  }

  function handleSignallingState(args) {
    if (args.target) {
      csioPc = args.target;
    } else if (args.srcElement) {
      csioPc = args.srcElement;
    } else if (args.currentTarget) {
      csioPc = args.currentTarget;
    }
    
    if (csioPc && csioPc.signalingState === 'closed') {
      return; 
    }

    try {
      const fabricAttributes = {
          remoteEndpointType:   CallstatsAmazonShim.callstats.endpointType.server,
        };
      if (confId) {
        CallstatsAmazonShim.callstats.addNewFabric(csioPc, CallstatsAmazonShim.remoteId, CallstatsAmazonShim.callstats.fabricUsage.multiplex,
          confId, fabricAttributes);
      }
    } catch(error) {
      console.log('addNewFabric error ', error);
    }
  }

  function handleSessionCreated(pc) {
    if (!pc) {
      return;
    }

    isCallDetailsSent = false;
    isConferenceSummarySent = false;
    pcCreationTime = 0;
    ringingTime = 0;
    pstnTime = 0;
    isCallForwarded = false;
    pcCreationTime = getTimestamp();

    pc.addEventListener('signalingstatechange',handleSignallingState, false);
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


var callstats = new window.callstats();
window.CallstatsAmazonShim = new CallstatsAmazonShim();
window.CallstatsAmazonShim.callstats = callstats;