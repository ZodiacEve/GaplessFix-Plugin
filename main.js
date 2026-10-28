/* GaplessFix 1.0.0 | MIT License */
(() => {
  'use strict';
  if (window.GaplessFix) return;
  const log = [];
  const report = (event, data = {}) => {
    const entry = { at: new Date().toISOString(), event, ...data };
    log.push(entry); if (log.length > 120) log.shift();
    console.info('[GaplessFix]', event, data);
  };
  const api = window.GaplessFix = { version: '1.0.0', state: 'waiting', log };
  let retry;
  function initialize() {
    try {
      let req;
      const key = 'gapless_fix_runtime';
      if (!Array.isArray(window.webpackJsonp)) return false;
      window.webpackJsonp.push([[key], { [key]: (m, e, r) => { req = r; } }, [[key]]]);
      if (!req?.m[163] || !req.m[86] || !req.m[176]) return false;
      // 3.1.41 的模块编号，客户端升级后需要重新确认。
      if (!req.m[163].toString().includes('setPreloadInfoResult2Native') ||
          !req.m[86].toString().includes('apiSongEnhancePlayerUrlV1')) {
        api.state = 'unsupported-client'; return true;
      }
      const helper = req(8).a, native = req(4).AudioPlayer, bridge = req(4).Bridge;
      if (!helper.getStore()?.playing || !bridge._Adapter?.registerCallMap) return false;
      const getState = () => helper.getStore();
      const dispatch = (type, payload) => helper.getDispatch()({ type, payload });
      const original = {}, originalsOwned = {};
      let ctx, gain, active = null, queued = null, generation = 0, preparation = 0;
      let loading = null, lastWanted = '', disposed = false, rate = 1;
      const records = new Map(), cache = new Map();
      const emit = (event, ...args) => {
        const callbacks = bridge._Adapter.registerCallMap['audioplayer.on' + event];
        for (const cb of Array.isArray(callbacks) ? callbacks.slice() : callbacks ? [callbacks] : []) {
          try { cb(...args); } catch (e) { report('event-error', { eventName: event, message: String(e) }); }
        }
      };
      function context() {
        if (!ctx) {
          ctx = new AudioContext({ latencyHint: 'playback' });
          gain = ctx.createGain(); gain.connect(ctx.destination);
          gain.gain.value = getState().playing.playingVolume;
          api.context = ctx;
        }
        return ctx;
      }
      const trackId = t => String(t?.trackId || t?.resourceId || '');
      const eligible = t => t?.resourceType === 'track' && /^\d+$/.test(trackId(t)) && !t.track?.noCopyrightRcmd?.mvInfo;
      function nextTrack(current) {
        const s = getState(), mode = s.playing.playingMode, list = s.playingList?.curPlayingList;
        if (!Array.isArray(list) || !current) return null;
        if (mode === 'playOneCycle') return current;
        if (!['playCycle', 'playOrder', 'playRandom'].includes(mode)) return null;
        const item = list.find(t => t.resourceId === current.resourceId);
        if (!item) return null;
        if (mode === 'playOrder' && item.displayOrder === Math.max(...list.map(t => t.displayOrder))) return null;
        return req(176).a(mode, list, item, 1);
      }
      function assertGranted(r) {
        if (r?.code !== 200 || !r.url || r.freeTrialInfo ||
            (r.freeTrialPrivilege?.resConsumable && r.freeTrialPrivilege?.userConsumable)) {
          throw Error('Full playback grant unavailable; retain native player');
        }
      }
      async function decode(track, quality) {
        const id = trackId(track), key = id + ':' + quality;
        const existing = cache.get(key);
        if (existing && Date.now() < existing.validUntil) return existing.promise;
        const item = { validUntil: Date.now() + 300000 };
        item.promise = (async () => {
          // 本地 NCM 也使用账号的在线播放接口，不读取加密文件。
          const r = await req(86).a({ ids: id, soundQuality: quality, trialMode: track.fromInfo?.trialMode });
          assertGranted(r);
          if (!['flac', 'mp3', 'm4a', 'aac', 'wav'].includes(String(r.type).toLowerCase())) throw Error('Unsupported stream format: ' + r.type);
          const response = await fetch(r.url);
          if (!response.ok) throw Error('Audio fetch HTTP ' + response.status);
          const bytes = await response.arrayBuffer();
          const buffer = await context().decodeAudioData(bytes);
          if (!buffer.length) throw Error('Empty decoded stream');
          item.validUntil = Date.now() + Math.min(300000, Math.max(1000, (r.expi || 300) * 1000));
          report('decoded', { id, quality, grantedLevel: r.level, frames: buffer.length, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, duration: buffer.duration });
          return { id, track, quality, buffer, type: r.type, validUntil: item.validUntil };
        })().catch(e => { cache.delete(key); throw e; });
        cache.set(key, item);
        // 缓存优先保留当前曲和下一曲。
        for (const k of cache.keys()) if (cache.size > 2 && k !== key && k !== active?.cacheKey) cache.delete(k);
        return item.promise;
      }
      function position(record = active) {
        if (!record) return 0;
        if (record.ended) return record.duration;
        return Math.min(record.duration, Math.max(0, record.offset + (record.paused ? 0 : (ctx.currentTime - record.start) * record.rate)));
      }
      function silenceSource(record) {
        if (!record?.source) return;
        record.source.onended = null;
        try { record.source.stop(); } catch (_) {}
        record.source.disconnect(); record.source = null;
      }
      function cancelQueued() {
        preparation++; silenceSource(queued); queued = null; lastWanted = '';
      }
      function clearPlayback() {
        generation++; loading = null; cancelQueued(); silenceSource(active); active = null;
      }
      function remember(record) {
        records.set(record.playId, record);
        while (records.size > 4) records.delete(records.keys().next().value);
      }
      function makeRecord(data, playId) {
        return { ...data, duration: data.buffer.duration, cacheKey: data.id + ':' + data.quality,
          playId, offset: 0, start: 0, end: 0, rate, paused: false, ended: false, source: null, adopted: false };
      }
      function schedule(record, when, offset = 0) {
        const source = ctx.createBufferSource();
        source.buffer = record.buffer; source.playbackRate.value = rate;
        source.connect(gain);
        Object.assign(record, { source, start: when, offset, rate, paused: false, ended: false,
          end: when + (record.buffer.length / record.buffer.sampleRate - offset) / rate });
        source.onended = () => ended(record);
        source.start(when, offset);
      }
      function ended(record) {
        if (active !== record || record.paused || disposed) return;
        record.ended = true; record.source?.disconnect(); record.source = null;
        const successor = queued;
        queued = null; preparation++; lastWanted = '';
        if (successor) {
          active = successor; remember(successor);
          report('boundary', { from: record.id, to: successor.id, endA: record.end, startB: successor.start,
            scheduledGapFrames: Math.round((successor.start - record.end) * ctx.sampleRate),
            framesA: record.buffer.length, framesB: successor.buffer.length, sampleRate: ctx.sampleRate, crossfade: false });
        } else {
          active = null;
          report('boundary-not-ready', { from: record.id });
        }
        emit('End', record.playId, { code: 0, playedTime: record.duration, playedAudioTime: record.duration });
        // 曲终上报还会读取这条记录，只释放 PCM 引用。
        record.buffer = null;
      }
      async function prepareNext() {
        if (!active || !active.adopted || active.ended || active.paused || disposed) return;
        const current = active, next = nextTrack(current.track);
        const wanted = eligible(next) ? trackId(next) + ':' + current.quality : '';
        if (wanted === lastWanted) return;
        cancelQueued(); lastWanted = wanted;
        if (!wanted) return;
        const ticket = preparation;
        try {
          const data = await decode(next, current.quality);
          if (disposed || ticket !== preparation || active !== current || current.ended || current.paused) return;
          if (current.end <= ctx.currentTime + .05 || data.validUntil < Date.now() + (current.end - ctx.currentTime) * 1000) {
            lastWanted = ''; return;
          }
          queued = makeRecord(data, data.id + '_gapless_' + Date.now().toString(36));
          // 用音频时钟衔接，不能等 onended 再启动下一首。
          schedule(queued, current.end);
          report('scheduled', { from: current.id, to: data.id, endA: current.end, startB: queued.start, gapFrames: 0 });
        } catch (e) { report('preload-unavailable', { id: trackId(next), message: String(e) }); }
      }
      const patch = (name, fn) => {
        originalsOwned[name] = Object.prototype.hasOwnProperty.call(native, name);
        original[name] = native[name]; native[name] = fn;
      };
      const result = r => ({ code: 0, playId: r.playId, resPlayId: r.playId, duration: r.duration,
        sampleRate: r.buffer?.sampleRate || ctx.sampleRate, openWholeCached: true, preloadWholeCached: true });
      patch('play', async function (info) {
        const track = getState().playing.curPlaying, id = String(info.songId), quality = info.soundQuality || info.level || 'lossless';
        if (active && !active.adopted && active.id === id && !active.ended) {
          active.adopted = true; active.track = track;
          const answer = result(active);
          report('adopted', { id, playId: active.playId, position: position() });
          setTimeout(() => prepareNext(), 0);
          return answer;
        }
        clearPlayback();
        if (!eligible(track) || trackId(track) !== id || info.freeTrialInfo ||
            (info.freeTrialPrivilege?.resConsumable && info.freeTrialPrivilege?.userConsumable)) {
          api.state = 'native-fallback'; return original.play.call(native, info);
        }
        const ticket = generation;
        loading = { ticket, paused: false };
        try {
          const data = await decode(track, quality);
          if (ticket !== generation || disposed) throw Error('Load cancelled');
          // 从原生播放切过来时，先停掉原来的声音。
          const oldId = getState().playing.playId;
          if (oldId && !records.has(oldId)) await original.stop.call(native, oldId);
          const audio = context();
          await audio.resume();
          if (audio.state !== 'running') throw Error('Audio context did not start');
          if (ticket !== generation) throw Error('Load cancelled');
          rate = Number(getState().playing.playingSpeed) || 1;
          active = makeRecord(data, id + '_gapless_' + Date.now().toString(36));
          active.adopted = true; remember(active);
          schedule(active, audio.currentTime + .08);
          const pausedDuringLoad = loading?.paused;
          loading = null; api.state = 'pcm';
          if (pausedDuringLoad) { active.offset = 0; silenceSource(active); active.paused = true; }
          const answer = result(active);
          report('playing', { id, playId: active.playId, engine: 'WebAudio', quality });
          setTimeout(() => prepareNext(), 0);
          return answer;
        } catch (e) {
          if (ticket !== generation || disposed) throw { code: -2, playId: 'cancelled', resPlayId: '' };
          loading = null; api.state = 'native-fallback';
          report('native-fallback', { id, message: String(e) });
          return original.play.call(native, info);
        }
      });
      patch('pause', async function (arg) {
        if (loading) { loading.paused = true; return true; }
        if (!active || active.playId !== arg.playId) return original.pause.call(native, arg);
        active.offset = position(); active.paused = true;
        silenceSource(active); cancelQueued();
        emit('PlayState', active.playId, arg.resumeOrPauseId, 2); return true;
      });
      patch('resumePlay', async function (arg) {
        if (!active || active.playId !== arg.playId) return original.resumePlay.call(native, arg);
        if (active.paused) { await ctx.resume(); schedule(active, ctx.currentTime + .04, active.offset); prepareNext(); }
        emit('PlayState', active.playId, arg.resumeOrPauseId, 1); return true;
      });
      patch('stop', async function (id) {
        if (loading || active && (active.playId === id || !id)) {
          const old = active; if (old) old.offset = position(old);
          clearPlayback(); if (old) emit('End', old.playId, { code: -2, playedTime: old.offset });
          return true;
        }
        if (records.has(id)) return true;
        return original.stop.call(native, id);
      });
      patch('seek', async function (arg) {
        if (!active || active.playId !== arg.playId) return original.seek.call(native, arg);
        const offset = Math.min(active.duration, Math.max(0, Number(arg.value) || 0)), paused = active.paused;
        silenceSource(active); cancelQueued(); active.offset = offset;
        if (!paused) schedule(active, ctx.currentTime + .03, offset);
        const answer = { playId: active.playId, seekId: arg.seekId, code: 0, position: offset };
        emit('Seek', active.playId, arg.seekId, 0, offset); prepareNext(); return answer;
      });
      patch('setVolume', async function (value) {
        if (gain) gain.gain.value = Math.max(0, Math.min(1, Number(value)));
        if (active) { emit('Volume', active.playId, '', 0, value); return true; }
        return original.setVolume.call(native, value);
      });
      patch('setPlaybackRate', async function (value) {
        const nextRate = Number(value);
        if (!active) return original.setPlaybackRate.call(native, value);
        if (Number.isFinite(nextRate) && nextRate > 0 && nextRate !== rate) {
          const offset = position(), paused = active.paused;
          silenceSource(active); cancelQueued(); rate = nextRate; active.offset = offset;
          if (!paused) schedule(active, ctx.currentTime + .03, offset);
          prepareNext();
        }
        return true;
      });
      patch('getPlayedTime', async function (arg) {
        const r = records.get(arg.playId);
        return r ? { result: true, playedTime: position(r), playedAudioTime: position(r) } : original.getPlayedTime.call(native, arg);
      });
      patch('getPlaybackInfo', async function (arg) {
        const r = records.get(arg.playId);
        return r ? { wholeCached: true, preloadWholeCached: true, playedPercent: position(r) / r.duration,
          janks: [], sourceAudioFormat: r.type, deviceAudioFormat: 'PCM', playAudioFormat: 'PCM' } : original.getPlaybackInfo.call(native, arg);
      });
      // 部分音量操作直接调用 Bridge。
      const bridgeCall = bridge.call;
      bridge.call = function (name, ...args) {
        if (active && name === 'audioplayer.setVolume') return native.setVolume(args[2]);
        return bridgeCall.call(this, name, ...args);
      };
      const interval = setInterval(() => {
        if (!active || disposed) return;
        if (active.adopted && getState().playing.playId === active.playId) {
          emit('PlayProgress', active.playId, position(), 100, false);
          if (!active.paused) prepareNext();
        }
      }, 200);
      api.snapshot = () => ({ state: api.state, contextState: ctx?.state, sampleRate: ctx?.sampleRate,
        current: active && { id: active.id, playId: active.playId, duration: active.duration, position: position(), paused: active.paused, adopted: active.adopted },
        next: queued && { id: queued.id, start: queued.start, endOfCurrent: active?.end, gapFrames: Math.round((queued.start - active.end) * ctx.sampleRate) },
        log: log.slice(-12) });
      api.dispose = () => {
        disposed = true; clearInterval(interval); clearPlayback(); cache.clear(); records.clear();
        for (const name of Object.keys(original)) { if (originalsOwned[name]) native[name] = original[name]; else delete native[name]; }
        bridge.call = bridgeCall; ctx?.close(); api.state = 'unloaded';
      };
      api.state = 'ready'; report('installed', { client: navigator.userAgent, nativeEffects: 'not applied by PCM renderer' });
      return true;
    } catch (e) { report('initialization-error', { message: String(e) }); return false; }
  }
  let tries = 0;
  retry = setInterval(() => { if (initialize() || ++tries > 120) clearInterval(retry); }, 500);
})();
