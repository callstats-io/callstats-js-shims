var csiogetStats = window.RTCPeerConnection.prototype.getStats;
window.RTCPeerConnection.prototype.csiogetStats = csiogetStats;