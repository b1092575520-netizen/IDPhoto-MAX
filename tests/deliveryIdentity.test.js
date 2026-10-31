"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadIdentity() {
  const context = { window: {} };
  vm.createContext(context);
  for (const name of ["sourceEligibilityService", "deliveryIdentity"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/core", name + ".js"), "utf8"), context);
  }
  return { identity: context.window.IDPhotoDeliveryIdentity, source: context.window.IDPhotoSourceEligibilityService };
}

function capture(overrides = {}) {
  return Object.assign({
    serialNumber: "SHOP-0589",
    captureDate: "2026:10:07 12:34:56",
    captureSubsecond: "09",
    originalDocumentId: "ABCDEF0123456789ABCDEF0123456789"
  }, overrides);
}

test("resaving one original keeps the identity despite new filenames, save IDs, pixels and signatures", () => {
  const { identity } = loadIdentity();
  const original = { name: "original.jpg", width: 4000, height: 6000, sourceMetadata: capture({ captureOffsetTime: "Z" }), documentId: "first" };
  const edited = { name: "edited.psd", width: 638, height: 898, sourceMetadata: capture({
    serialNumber: " shop-0589 ", captureDate: "2026-10-07T12:34:56.090Z", captureSubsecond: "0900",
    originalDocumentId: "uuid:abcdef01-2345-6789-abcd-ef0123456789"
  }), documentId: "second", personFingerprint: "unrelated", visualSignature: {} };
  assert.ok(identity.getSourceIdentity(original));
  assert.equal(identity.getSourceIdentity(original), identity.getSourceIdentity(edited));
});

test("capture identity distinguishes cameras and subseconds, without changing when a save ID appears", () => {
  const { identity } = loadIdentity();
  const a = identity.getSourceIdentity(capture());
  const b = identity.getSourceIdentity(capture({ captureSubsecond: "61" }));
  const c = identity.getSourceIdentity(capture({ originalDocumentId: "123456789012345678901234567890ab" }));
  const otherCamera = identity.getSourceIdentity(capture({ serialNumber: "SHOP-0590" }));
  assert.equal(new Set([a, b, c, otherCamera]).size, 3);
  assert.equal(a, c);
});

test("missing, invalid or contradictory strong identity returns empty instead of filename or visual guesses", () => {
  const { identity } = loadIdentity();
  for (const metadata of [
    {}, capture({ serialNumber: "" }), capture({ captureDate: "2026-10-07" }),
    capture({ captureDate: "2026-02-31T12:34:56" }), capture({ captureDate: "2026-10-07T24:00:00" }),
    capture({ captureDate: "2026-10-07T12:00:60" }), capture({ originalDocumentId: "", captureSubsecond: "" }),
    capture({ captureDate: "2026-10-07T12:34:56+15:00" }), capture({ captureDate: "2026-10-07T12:34:56+08:99" }),
    capture({ originalDocumentId: "unknown" }), capture({ originalDocumentId: "00000000000000000000000000000000" }),
    capture({ captureSubsecond: "not-a-number" }), capture({ captureDate: "2026-10-07T12:34:56.61", captureSubsecond: "09" })
  ]) {
    assert.equal(identity.getSourceIdentity({ sourceMetadata: metadata, name: "identical.jpg", personFingerprint: "same" }), "");
  }
});

test("original XMP fields are preferred over changing DocumentID and support the document-info legacy identity", () => {
  const { identity, source } = loadIdentity();
  const raw = `<rdf:Description aux:SerialNumber="SHOP-0589"
    exif:DateTimeOriginal="2026-10-07T12:34:56.09"
    xmpMM:OriginalDocumentID="ABCDEF0123456789ABCDEF0123456789"
    xmpMM:DocumentID="new-save" />`;
  const fromXmp = { sourceMetadata: source.parseXmp(raw), stableSourceId: source.getStableSourceIdFromXmp(raw) };
  const legacy = { sourceMetadata: capture({ originalDocumentId: "" }), stableSourceId: fromXmp.stableSourceId };
  assert.equal(identity.getSourceIdentity(fromXmp), identity.getSourceIdentity(legacy));
  assert.equal(identity.getSourceIdentity(Object.assign({}, fromXmp, {
    stableSourceId: "original-document-id:123456789012345678901234567890ab"
  })), "");
});

test("a verified camera ImageUniqueID remains authoritative and rejects a conflicting document-info identity", () => {
  const { identity } = loadIdentity();
  const imageUniqueId = "123456789012345678901234567890ab";
  const original = { sourceMetadata: capture({ imageUniqueId }) };
  const edited = { sourceMetadata: capture({ imageUniqueId: imageUniqueId.toUpperCase(), originalDocumentId: "" }) };
  assert.equal(identity.getSourceIdentity(original), identity.getSourceIdentity(edited));
  assert.equal(identity.getSourceIdentity(Object.assign({}, original, {
    stableSourceId: "image-unique-id:abcdef0123456789abcdef0123456789"
  })), "");
});

test("same specification and background replace, different sizes or backgrounds have independent keys", () => {
  const { identity } = loadIdentity();
  const original = { widthPx: 638, heightPx: 898, backgroundColor: "white" };
  const key = identity.makeVariantKey(original);
  assert.equal(key, identity.makeVariantKey({ width: 638, height: 898, backgroundColor: "WHITE" }));
  assert.notEqual(key, identity.makeVariantKey({ widthPx: 638, heightPx: 898, backgroundColor: "blue" }));
  assert.notEqual(key, identity.makeVariantKey({ widthPx: 827, heightPx: 1157, backgroundColor: "white" }));
  for (const options of [
    {}, Object.assign({}, original, { widthPx: 0 }), Object.assign({}, original, { widthPx: 638.5 }),
    Object.assign({}, original, { backgroundColor: "unknown" }), Object.assign({}, original, { widthPx: Infinity })
  ]) {
    assert.equal(identity.makeVariantKey(options), "");
  }
});

test("fresh camera capture without strong IDs uses subsecond capture identity and keeps it after a Photoshop save", () => {
  const { identity } = loadIdentity();
  const fresh = capture({ originalDocumentId: "", captureSubsecond: "53", captureOffsetTime: "+08:00" });
  const key = identity.getSourceIdentity(fresh);
  assert.ok(key);
  assert.match(key, /^source-v2:/);
  assert.equal(key, identity.getSourceIdentity({ sourceMetadata: { ...fresh,
    captureDate: "2026-10-07T12:34:56.053+08:00", originalDocumentId: "ABCDEF0123456789ABCDEF0123456789"
  } }));
  assert.notEqual(key, identity.getSourceIdentity({ ...fresh, captureSubsecond: "54" }));
  assert.equal(identity.describeSourceIdentity(fresh).strength, "capture-subsecond");
  assert.equal(identity.describeSourceIdentity({ ...fresh, originalDocumentId: "ABCDEF0123456789ABCDEF0123456789" }).strength, "original-document-id");
});

test("capture fallback requires subsecond, preserves a zero subsecond and rejects actual time conflicts", () => {
  const { identity } = loadIdentity();
  const fresh = capture({ originalDocumentId: "" });
  assert.equal(identity.getSourceIdentity({ ...fresh, captureSubsecond: "" }), "");
  assert.ok(identity.getSourceIdentity({ ...fresh, captureSubsecond: "00" }));
  assert.equal(identity.getSourceIdentity({ ...fresh, captureDate: "2026-10-07T12:34:56.61" }), "");
  assert.notEqual(identity.getSourceIdentity({ ...fresh, captureOffsetTime: "+08:00" }),
    identity.getSourceIdentity({ ...fresh, captureOffsetTime: "+09:00" }));
  assert.equal(identity.getSourceIdentity({ ...fresh, captureDate: "2026-10-07T12:34:56+08:00", captureOffsetTime: "+09:00" }), "");
  assert.equal(identity.getSourceIdentity({ ...fresh, captureOffsetTime: "+08:99" }), "");
});

test("new capture identity recognizes an exact old source-v1 capture and refuses a conflicting strong ID", () => {
  const { identity } = loadIdentity();
  const saved = capture();
  const oldKey = "source-v1:" + JSON.stringify(["SHOP-0589", "2026-10-07T12:34:56.09", "original", saved.originalDocumentId.toLowerCase()]);
  assert.equal(identity.matchesSourceIdentity(oldKey, saved), true);
  assert.equal(identity.matchesSourceIdentity(oldKey, { ...saved, originalDocumentId: "" }), true);
  assert.equal(identity.matchesSourceIdentity(oldKey, { ...saved, originalDocumentId: "123456789012345678901234567890ab" }), false);
  assert.equal(identity.matchesSourceIdentity(oldKey, { ...saved, captureSubsecond: "61" }), false);
});

test("a 本店片 photo is known by its open document, and a camera identity still wins (10-31)", () => {
  const { identity } = loadIdentity();
  const doc = { id: 59, name: "AI修图.jpg", sourceMetadata: {} };
  assert.equal(identity.getSourceIdentity(doc), "", "an unmarked photo without camera data has no identity");
  const marked = Object.assign({}, doc, { shopConfirmed: true });
  const key = identity.getSourceIdentity(marked);
  assert.match(key, /^manual-v1:/);
  assert.equal(identity.getSourceIdentity(Object.assign({}, marked)), key, "laying the same document out again reuses its order");
  assert.equal(identity.matchesSourceIdentity(key, Object.assign({}, marked)), true);
  assert.notEqual(identity.getSourceIdentity(Object.assign({}, marked, { id: 60 })), key, "another document is another customer");
  assert.equal(loadIdentity().identity.getSourceIdentity(marked) === key, false, "document IDs restart with Photoshop, keys do not repeat");
  const camera = Object.assign({}, marked, { sourceMetadata: capture() });
  assert.match(identity.getSourceIdentity(camera), /^source-v2:/);
});
