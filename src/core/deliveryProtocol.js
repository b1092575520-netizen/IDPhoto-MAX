(function () {
  "use strict";
  // Small portable SHA-256 for UXP (which does not expose Node's crypto module).
  var K = [], initial = [];
  for (var n = 2; K.length < 64; n++) {
    var prime = true;
    for (var d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (prime) { if (initial.length < 8) initial.push((Math.sqrt(n) % 1 * 4294967296) | 0); K.push((Math.pow(n, 1 / 3) % 1 * 4294967296) | 0); }
  }
  function utf8(value) {
    var encoded = unescape(encodeURIComponent(value)), bytes = new Uint8Array(encoded.length);
    for (var i = 0; i < bytes.length; i++) bytes[i] = encoded.charCodeAt(i);
    return bytes;
  }
  function r(v, bits) { return v >>> bits | v << (32 - bits); }
  function sha256(input) {
    var bytes = typeof input === "string" ? utf8(input) : new Uint8Array(input);
    var length = Math.ceil((bytes.length + 9) / 64) * 64, data = new Uint8Array(length);
    data.set(bytes); data[bytes.length] = 128;
    var view = new DataView(data.buffer); view.setUint32(length - 8, Math.floor(bytes.length / 536870912)); view.setUint32(length - 4, bytes.length * 8 >>> 0);
    var h = initial.slice(), w = new Int32Array(64);
    for (var offset = 0; offset < length; offset += 64) {
      for (var i = 0; i < 64; i++) {
        if (i < 16) w[i] = view.getInt32(offset + i * 4);
        else { var x = w[i - 15], y = w[i - 2]; w[i] = (w[i - 16] + (r(x, 7) ^ r(x, 18) ^ x >>> 3) + w[i - 7] + (r(y, 17) ^ r(y, 19) ^ y >>> 10)) | 0; }
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], t = h[7];
      for (var j = 0; j < 64; j++) {
        var t1 = (t + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + (e & f ^ ~e & g) + K[j] + w[j]) | 0;
        var t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + (a & b ^ a & c ^ b & c)) | 0;
        t = g; g = f; f = e; e = d + t1 | 0; d = c; c = b; b = a; a = t1 + t2 | 0;
      }
      [a,b,c,d,e,f,g,t].forEach(function (v, k) { h[k] = h[k] + v | 0; });
    }
    return h.map(function (v) { return (v >>> 0).toString(16).padStart(8, "0"); }).join("");
  }
  function id() {
    var data = new Uint8Array(16);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(data);
    else for (var i = 0; i < data.length; i++) data[i] = Math.floor(Math.random() * 256);
    return Array.from(data).map(function (n) { return n.toString(16).padStart(2, "0"); }).join("");
  }
  function confirmedCode(receipt, task) {
    if (!receipt || receipt.version !== 2 || !task.confirmationId || receipt.requestId !== task.confirmationId || receipt.confirmed !== true ||
      !receipt.contextKey || (task.contextKey && task.contextKey !== receipt.contextKey) || (task.deliveryId && task.deliveryId !== receipt.deliveryId) ||
      !["preparing", "ready"].includes(receipt.status) || receipt.taskId !== task.id || receipt.manifestFingerprint !== task.fingerprint || receipt.accepted !== true || !receipt.deliveryId || !/^(?=.*[A-Z])(?=.*[2-9])[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(receipt.code || "")) return "";
    return receipt.code;
  }
  window.IDPhotoDeliveryProtocol = { sha256: sha256, id: id, confirmedCode: confirmedCode };
})();
