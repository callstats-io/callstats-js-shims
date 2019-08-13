/*! callstats Jabra SHIM version = 1.0.0 */

(function (global) {
  var CallstatsJabraShim = function() {
    let isTxSpeechStarted = false;
    let isRxSpeechStarted = false;
    let isCrossTalkStarted = false;
    let eventList = [];

    function sendJabraActiveState(txSpeech, rxSpeech) {
      if (txSpeech === undefined && rxSpeech === undefined) {
        return;
      }

      if (!isTxSpeechStarted && txSpeech) {
        isTxSpeechStarted = true;
      } else if (txSpeech === false && isTxSpeechStarted) {
        isTxSpeechStarted = false;
        if (!isCrossTalkStarted) {
          sendCustomEvent('agentSpeakingStop');
        }
      }

      if (!isRxSpeechStarted && rxSpeech) {
        isRxSpeechStarted = true;
      } else if (rxSpeech === false && isRxSpeechStarted) {
        isRxSpeechStarted = false;
        if (!isCrossTalkStarted) {
          sendCustomEvent('contactSpeakingStop');
        }
      }

      if (isTxSpeechStarted && isRxSpeechStarted) {
        isCrossTalkStarted = true;
      } else if (isCrossTalkStarted && (isTxSpeechStarted || isRxSpeechStarted)) {
        isCrossTalkStarted = false;
        sendCustomEvent('crossTalkStop');
      }

      if (isCrossTalkStarted) {
        sendCustomEvent('crossTalkStart');
      } else if (isTxSpeechStarted) {
        sendCustomEvent('agentSpeakingStart');
      } else if (isRxSpeechStarted) {
        sendCustomEvent('contactSpeakingStart');
      }
    }

    function sendCustomStats(noiseDb, exposureDb) {
      if (!CallstatsJabraShim.conferenceID) {
        return;
      }
      let stats = [];
      if (noiseDb) {
        let noiseDbStats = {
          name: 'noiseDb',
          value: noiseDb,
        }
        stats.push(noiseDbStats)
      }

      if (exposureDb) {
        let exposureDbStats = {
          name: 'exposureDb',
          value: exposureDb,
        }
        stats.push(exposureDbStats)
      }
      if (stats.length > 0) {
        CallstatsJabraShim.callstats.sendCustomStats(null, 
          CallstatsJabraShim.conferenceID, stats);
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

    function sendCustomEvent(eventType) {
      if (!CallstatsJabraShim.conferenceID) {
        return;
      }
      let event = {
        type: eventType,
        timestamp: getTimestamp(),
      }

      eventList.push(event);
      if (eventList.length === 40) {
        CallstatsJabraShim.callstats.sendCustomEvent(null, 
          CallstatsJabraShim.conferenceID, eventList);
        
        eventList = [];
      }
    }

    function initJabraEventListeners() {
      jabra.addEventListener("device attached", () => {
        console.log("CallstatsJabraShim: device attached");
      });

      jabra.addEventListener("mute", (event) => {
        sendCustomEvent('mute');
      });

      jabra.addEventListener("unmute", (event) => {
        sendCustomEvent('unmute');
      });

      jabra.addEventListener("devlog", (event) => {
        let noiseDb = undefined;
        let txLevelEvent = event.data["TX Acoustic Logging Level"];
        if (txLevelEvent !== undefined) {
          noiseDb = parseInt(txLevelEvent);
        }

        let exposureDb = undefined;
        let rxLevelEvent = event.data["RX Acoustic Logging Level"];
        if (rxLevelEvent !== undefined) {
          exposureDb = parseInt(rxLevelEvent);
        }
        sendCustomStats(noiseDb, exposureDb);

        let volState = event.data["ID"];
        if (volState === "VOLUP TAP") {
          sendCustomEvent('volumeUp');
        } else if (volState === "VOLDOWN TAP") {
          sendCustomEvent('volumeDown');
        }

        let muteState = event.data["Mute State"];
        if (muteState === "TRUE") {
          sendCustomEvent('mute');
        } else if (muteState === "FALSE") {
          sendCustomEvent('unmute');
        }
        
        let boomArmEvent = event.data["Boom Position Guidance OK"];
        if (boomArmEvent === "TRUE") {
          sendCustomEvent('boomArmPositionOk');
        } else if (boomArmEvent === "FALSE") {
          sendCustomEvent('boomArmPositionNotOk');
        }

        let txSpeech = undefined;
        let txSpeechEvent = event.data["Speech_Analysis_TX"];
        if (txSpeechEvent !== undefined) {
            txSpeech = (txSpeechEvent.toString().toLowerCase() === "true");
        }

        let rxSpeech = undefined;
        let rxSpeechEvent = event.data["Speech_Analysis_RX"];
        if (rxSpeechEvent !== undefined) {
            rxSpeech = (rxSpeechEvent.toString().toLowerCase() === "true");
        }

        sendJabraActiveState(txSpeech, rxSpeech);
      });
    }

    function initJabraLib() {
      // Jabra library init with full installation check, focus setup and diagnostics of common problems:
      jabra.init().then(() => jabra.getInstallInfo()).then((installInfo) => {
        console.log("CallstatsJabraShim: Jabra library initialized");
        if (installInfo.installationOk) {
          console.log("CallstatsJabraShim: Jabra Installation check succeded");
        } else {
          console.error("CallstatsJabraShim: Browser SDK Installation incomplete. Please (re)install");
        }
      }).catch((err) => {
          if (err.name === "CommandError" && err.errmessage === "Unknown cmd" && err.command === "getinstallinfo" ) {
            console.log("CallstatsJabraShim: Your browser SDK installation is incomplete, out of date or corrupted. Please (re)install");
          } else if (err.name === "NotFoundError") {
            console.log("CallstatsJabraShim: Input device not accessible/found");
          } else {
            console.log(err.name + ": " + err.message);
          }
      });
    }

    CallstatsJabraShim.prototype.initialize = function initialize(callstats, params) {
      if (!callstats) {
        console.error('CallstatsJabraShim: Cannot initialize/Invalid Arguments');
        return;
      }
      CallstatsJabraShim.callstats = callstats;
      initJabraLib();
    }

    CallstatsJabraShim.prototype.startJabraMonitoring = function startJabraMonitoring(conferenceID) {
      if (!conferenceID) {
        console.error('CallstatsJabraShim: Cannot startJabraMonitoring/Invalid Arguments');
        return;
      }
      eventList = [];
      CallstatsJabraShim.conferenceID = conferenceID;
      initJabraEventListeners();
    }

    CallstatsJabraShim.prototype.stopJabraMonitoring = function stopJabraMonitoring() {
      if (eventList.length > 0) {
        CallstatsJabraShim.callstats.sendCustomEvent(null, 
          CallstatsJabraShim.conferenceID, eventList);
        
        eventList = [];
      }
      CallstatsJabraShim.conferenceID = null;
      isTxSpeechStarted = false;
      isRxSpeechStarted = false;
      isCrossTalkStarted = false; 
    }
  };

  if (("function" === typeof define) && (define.amd)) { /* AMD support */
  define('callstats-jabra-client', function() {
    global.CallstatsJabraShim = new CallstatsJabraShim();
    return  global.CallstatsJabraShim;
  });
  } else { /* Browsers and Web Workers*/
    global.CallstatsJabraShim = new CallstatsJabraShim();
  }
}(this));
