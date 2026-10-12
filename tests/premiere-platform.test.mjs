import test from 'node:test';
import assert from 'node:assert/strict';
import {detectPlatform} from '../src/client/utils/premierePlatform.js';

const cases = [
  ['Chrome/Edge Windows client hints', {userAgentData:{platform:'Windows',mobile:false}}, 'windows'],
  ['Chrome Mac client hints', {userAgentData:{platform:'macOS',mobile:false}}, 'mac'],
  ['Windows Firefox fallback', {platform:'Win32',userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}, 'windows'],
  ['Windows UA with hidden platform', {userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}, 'windows'],
  ['Safari Mac fallback', {platform:'MacIntel',userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',maxTouchPoints:0}, 'mac'],
  ['Mac UA with hidden platform', {userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}, 'mac'],
  ['iPad desktop mode', {platform:'MacIntel',userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',maxTouchPoints:5}, 'mobile'],
  ['iPhone', {platform:'iPhone',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'}, 'mobile'],
  ['Android legacy', {platform:'Linux armv8l',userAgent:'Mozilla/5.0 (Linux; Android 15)'}, 'mobile'],
  ['Android hints', {userAgentData:{platform:'Android',mobile:true}}, 'mobile'],
  ['Windows desktop touch screen', {platform:'Win32',userAgentData:{platform:'Windows',mobile:false},maxTouchPoints:10}, 'windows'],
  ['Chrome OS hints', {userAgentData:{platform:'Chrome OS',mobile:false}}, 'unsupported'],
  ['Linux desktop', {platform:'Linux x86_64',userAgent:'Mozilla/5.0 (X11; Linux x86_64)'}, 'unsupported'],
  ['unknown private browser', {}, 'unknown'],
];
for(const [name,browser,expected] of cases)test(`installer selection: ${name}`,()=>assert.equal(detectPlatform(browser),expected));
