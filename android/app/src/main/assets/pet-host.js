/**
 * `window.petHost` for the pet page in the phone's floating window (web/pet-app.js reads it at load).
 * It runs at document start on the paired computer's origin only, and talks to the app over
 * `CooAndroid`, a message port the app grants that origin alone: a figure pack's sandboxed frame
 * reaches neither. Messages are JSON; the app answers with `shown`, `floor`, `mic-open` and `mic-data`.
 */
(() => {
  const port = window.CooAndroid;
  if (!port || window.petHost) return;
  const listeners = {};
  const on = (t) => (cb) => { (listeners[t] ||= []).push(cb); };
  const post = (m) => port.postMessage(JSON.stringify(m));
  let micSink = null, micWait = null;
  port.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'mic-data') {
      if (!micSink) return;
      const s = atob(m.pcm), pcm = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) pcm[i] = s.charCodeAt(i);
      micSink(pcm.buffer);
    } else if (m.t === 'mic-open') {
      const wait = micWait;
      micWait = null;
      if (!wait) return;
      if (m.ok) { wait.done(m.label); return; }
      const err = new Error(m.detail || 'microphone');
      err.name = m.denied ? 'NotAllowedError' : 'Error';
      wait.fail(err);
    } else {
      for (const cb of listeners[m.t] || []) cb(m.v);
    }
  };
  window.petHost = Object.freeze({
    kind: 'phone',
    // the floating window takes every touch inside it and none outside; it follows `place`
    setInteractive() {},
    focus: () => post({ t: 'focus' }),
    grabFocus: () => post({ t: 'focus' }),
    releaseFocus: () => post({ t: 'blur' }),
    hide: () => post({ t: 'hide' }),
    onShown: on('shown'),
    hideWhenFullscreen() {},
    openDress: () => post({ t: 'dress' }),
    setLanguage: (code) => post({ t: 'language', code: String(code) }),
    onFloor: on('floor'),
    place: (rect) => post({ t: 'place', rect }),
    openMic: (sink) => new Promise((done, fail) => {
      micSink = sink;
      micWait = { done, fail };
      post({ t: 'mic', on: true });
    }),
    closeMic: () => { micSink = null; post({ t: 'mic', on: false }); },
  });
})();
