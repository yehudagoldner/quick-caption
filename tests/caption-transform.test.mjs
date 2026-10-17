import test from 'node:test';
import assert from 'node:assert/strict';
import { captionAnchor, captionPivot, moveCaption, normalizeCaptionAngle, pinchCaption, rotateCaption, scaleCaption, snapCaptionAngle } from '../src/captionTransform.js';
const values = { positionXPercent: 50, offsetYPercent: 20, rotation: 0, fontSize: 100 };
const bounds = { left: 20, top: 40, width: 500, height: 1000 };
const close = (a, b) => assert.ok(Math.abs(a - b) < .001, `${a} != ${b}`);

test('drag maps pixels to video percentages, snaps to center and bounds movement', () => {
  assert.deepEqual(moveCaption(values, 50, -100, bounds), { positionXPercent: 60, offsetYPercent: 30 });
  assert.deepEqual(moveCaption(values, -2, -295, bounds), { positionXPercent: 50, offsetYPercent: 50 });
  assert.deepEqual(moveCaption(values, -2000, 2000, bounds), { positionXPercent: 0, offsetYPercent: 0 });
});
test('rotation crosses 180 smoothly and offers cardinal and Shift snapping', () => {
  assert.equal(normalizeCaptionAngle(181), -179);
  assert.equal(normalizeCaptionAngle(-181), 179);
  assert.equal(snapCaptionAngle(88), 90);
  assert.equal(snapCaptionAngle(34), 34);
  assert.equal(snapCaptionAngle(34, true), 30);
});
test('rotation handle keeps the visual center fixed while converting the bottom anchor', () => {
  const anchor = captionAnchor(values, bounds), pivot = { x: anchor.x, y: anchor.y - 50 };
  const patch = rotateCaption(values, { x: pivot.x, y: pivot.y - 100 }, { x: pivot.x + 100, y: pivot.y }, pivot, bounds);
  assert.equal(patch.rotation, 90);
  const next = captionAnchor({ ...values, ...patch }, bounds);
  close(next.x, pivot.x - 50); close(next.y, pivot.y);
  assert.deepEqual(rotateCaption(values, { x: 0, y: 0 }, pivot, pivot, bounds), {});
});
test('two fingers transform around their midpoint with translation, rotation and scale together', () => {
  const anchor = captionAnchor(values, bounds);
  const start = [{ x: anchor.x - 50, y: anchor.y }, { x: anchor.x + 50, y: anchor.y }];
  const current = [{ x: anchor.x + 20, y: anchor.y - 110 }, { x: anchor.x + 20, y: anchor.y + 90 }];
  const patch = pinchCaption(values, start, current, bounds);
  assert.equal(patch.fontSize, 200); assert.equal(patch.rotation, 90);
  const next = captionAnchor({ ...values, ...patch }, bounds);
  close(next.x, anchor.x + 20); close(next.y, anchor.y - 10);
});
test('center snapping uses screen pixels, so a small preview still snaps', () => {
  const small = { left: 0, top: 0, width: 200, height: 400 };
  assert.equal(moveCaption(values, 5, 0, small).positionXPercent, 50);
  assert.equal(moveCaption(values, 8, 0, small).positionXPercent, 54);
});
test('corner scaling keeps the visual center fixed, including on a rotated caption', () => {
  for (const rotation of [0, 30]) {
    const start = { ...values, rotation }, pivot = captionPivot(start, bounds, 40);
    const patch = scaleCaption(start, { x: pivot.x + 60, y: pivot.y + 80 }, { x: pivot.x + 120, y: pivot.y + 160 }, pivot, bounds);
    assert.equal(patch.fontSize, 200);
    const next = captionPivot({ ...start, ...patch }, bounds, 80);
    close(next.x, pivot.x); close(next.y, pivot.y);
  }
  assert.deepEqual(scaleCaption(values, { x: 1, y: 1 }, { x: 50, y: 50 }, { x: 0, y: 0 }, bounds), {});
});
test('tiny pinch distances are ignored and extreme sizes stay bounded', () => {
  const tiny = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  assert.deepEqual(pinchCaption(values, tiny, tiny, bounds), {});
  const patch = pinchCaption(values, [{ x: 0, y: 0 }, { x: 20, y: 0 }], [{ x: 0, y: 0 }, { x: 10000, y: 0 }], bounds);
  assert.equal(patch.fontSize, 1000);
});
