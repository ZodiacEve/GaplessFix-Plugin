// 用假的播放器和 PCM 缓冲测试排程，不需要启动网易云。
const vm = require('node:vm'), fs = require('node:fs'), assert = require('node:assert/strict');
const track = id => ({ resourceType: 'track', resourceId: id, trackId: id, track: {}, fromInfo: {} });
const a = track('1'), b = track('2');
const s = { playing: { curPlaying: a, playId: '', playingVolume: 1, playingSpeed: 1, playingMode: 'playCycle' }, playingList: { curPlayingList: [a, b] } };
const timers = [], nodes = [], events = [];
let nativePlays = 0, trial = false;
const native = Object.fromEntries(['play','pause','resumePlay','stop','seek','setVolume','setPlaybackRate','getPlayedTime','getPlaybackInfo'].map(k => [k, async () => { if (k === 'play') nativePlays++; return {}; }]));
const callbacks = {};
for (const ev of ['End','PlayState','Seek','Volume','PlayProgress']) callbacks['audioplayer.on' + ev] = (...args) => events.push([ev, ...args]);
const bridge = { _Adapter: { registerCallMap: callbacks }, call() {} };
const modules = { 4: { AudioPlayer: native, Bridge: bridge }, 8: { a: { getStore: () => s, getDispatch: () => () => {} } },
  86: { a: async ({ ids }) => ({ code: 200, url: ids, type: 'flac', level: 'lossless', expi: 600, freeTrialInfo: trial ? { start: 0, end: 30 } : null }) },
  176: { a: (mode, list, current) => current.resourceId === '1' ? b : a } };
const req = id => modules[id];
req.m = { 163: function () { return 'setPreloadInfoResult2Native'; }, 86: function () { return 'apiSongEnhancePlayerUrlV1'; }, 176() {} };
class Context {
  constructor() { this.sampleRate = 48000; this.currentTime = 1; this.state = 'suspended'; }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
  async decodeAudioData(id) { const length = id === '1' ? 480003 : 240007; return { length, sampleRate: 48000, numberOfChannels: 2, duration: length / 48000 }; }
  createBufferSource() { const node = { playbackRate: { value: 1 }, connect() {}, disconnect() {}, stop() { this.stopped = true; }, start(time, offset) { this.time = time; this.offset = offset; } }; nodes.push(node); return node; }
}
const window = { webpackJsonp: { } };
window.webpackJsonp = [];
window.webpackJsonp.push = ([ids, definitions]) => Object.values(definitions)[0]({}, {}, req);
const sandbox = { window, AudioContext: Context, navigator: { userAgent: 'synthetic 3.1.41' }, console: { info() {} },
  setInterval: fn => { timers.push(fn); return timers.length; }, clearInterval() {}, setTimeout: fn => { Promise.resolve().then(fn); },
  fetch: async url => ({ ok: true, arrayBuffer: async () => url }) };
vm.runInNewContext(fs.readFileSync(__dirname + '/main.js', 'utf8'), sandbox);
timers[0]();
const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
(async () => {
  const first = await native.play({ songId: '1', soundQuality: 'lossless' });
  s.playing.playId = first.playId; await flush();
  const api = window.GaplessFix;
  assert.equal(api.snapshot().next.gapFrames, 0);
  assert.equal(nodes[1].time, nodes[0].time + 480003 / 48000);
  assert.equal(nodes[0].offset, 0); assert.equal(nodes[1].offset, 0);
  api.context.currentTime = nodes[1].time;
  nodes[0].onended();
  assert.equal(api.snapshot().current.id, '2');
  assert.equal(events.filter(e => e[0] === 'End').length, 1);
  const count = nodes.length;
  s.playing.curPlaying = b;
  const adopted = await native.play({ songId: '2', soundQuality: 'lossless' });
  s.playing.playId = adopted.playId;
  assert.equal(nodes.length, count, 'Adoption must not restart or truncate B');
  await flush();
  await native.pause({ playId: adopted.playId, resumeOrPauseId: 'pause' });
  assert.equal(api.snapshot().current.paused, true); assert.equal(api.snapshot().next, null);
  timers[1](); await flush(); assert.equal(api.snapshot().next, null, 'Paused track must not schedule B');
  await native.resumePlay({ playId: adopted.playId, resumeOrPauseId: 'resume' }); await flush();
  assert.equal(api.snapshot().next.gapFrames, 0);
  await native.seek({ playId: adopted.playId, seekId: 'seek', value: 1 }); await flush();
  assert.equal(api.snapshot().next.gapFrames, 0);
  await native.stop(adopted.playId); assert.equal(api.snapshot().current, null);
  trial = true; s.playing.curPlaying = track('3');
  await native.play({ songId: '3', soundQuality: 'lossless' });
  assert.equal(nativePlays, 1, 'Trial resource must use original player');
  api.dispose();
  console.log('PASS: full PCM boundary, zero overlap/gap, next adoption, pause/resume, seek invalidation, stop, trial fallback.');
})().catch(e => { console.error(e); process.exitCode = 1; });
