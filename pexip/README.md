Contributed with Alan Ford <alan-at-pexip.com>:

For developers using [PexRTC](https://docs.pexip.com/api_client/api_pexrtc.htm) to build their own WebRTC applications, three new event callbacks were created which can be used to call out to the [callstats.io API](/api). These callbacks are:

`PexRTC.event_newPC = function(pc, uuid, conf, call_type)`, where:
  + `pc`:  PeerConnection object
  + `uuid`:  unique identifier of this call
  + `conf`:  conference name
  + `call_type`:  internal call type, may be ‘screen’ for screensharing, ‘audio_only’ for audio only.

`PexRTC.event_event = function(pc, conf, ev)`, where:
  + `pc`:  PeerConnection object
  + `conf`:  conference name
  + `ev`:  event; audioMute/audioUnmute/videoPause/videoResume/fabricTerminated

`PexRTC.event_error = function(pc, conf, ev, err, sdp)`, where:
  + `pc`:  PeerConnection object
  + `conf`: conference name
  + `ev`: the function in question
  + `err`: error from function
  + `sdp`:  sdp in question, if relevant



> The zip file contains an edited `settings.js`, which adds a `scripts` block (if you’re already using customisations, you can just add this `scripts` block to your existing customisations), and a `csio.js` file which is imported to make the above calls to the callstats.io API. This will need to be edited to make use of your personal identifiers in the `callStats.initialize` call.