/**
 * Coo's sticker set: twelve looping animations of the default Coo (mint palette, no accessories), drawn
 * with Coo's own `figure()` (../coo/coo.js) and the kit's faces (../kit/body.js), with particles in the
 * kit's line style and a caption in the font the person picks.
 *
 * Sticker space is 256×256 units, the size of Coo's logo space. A sticker's `frame(t, text)` returns the
 * SVG markup of its scene at time t (seconds, looping every `dur`) and where its caption `text` goes;
 * `renderFrame` draws both into a canvas and adds the white die-cut outline that lets a one-bit-alpha GIF
 * sit on any chat background. Particles never fade (GIF has no partial alpha): they grow in and shrink out.
 */
import { figure, COO_CSS, skinCss, defaultSkin } from '../coo/coo.js';
import { FACES, HIPS, LEG_W, DROP, heartD } from '../kit/body.js';
import { flatten, encodeGif } from './gif.js';

const f = n => Math.round(n * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const bump = k => Math.sin(Math.PI * clamp(k, 0, 1));
const TAU = Math.PI * 2;
const frac = x => x - Math.floor(x);
/** Grows in over the first `a` of a particle's life, shrinks out over the last `b`. */
const life = (k, a = .2, b = .3) => smooth(k / a) * smooth((1 - k) / b);
// a fixed pseudo-random per index, so a loop draws the same particles every time round
const hash = i => frac(Math.sin(i * 127.1 + 311.7) * 43758.5453);

export const C = {
  ink: '#1B1626', mint: '#00A870', heart: '#F0567A', blush: '#FF8FA8', tear: '#5AAEF0', anger: '#E5484D',
  lemon: '#D9B300', rose: '#DB3F76', purple: '#8B3DF0', nav: '#1F6FE0', holo: '#1AA3D9', dust: '#A39DB0', fox: '#DD3526',
};
const SKIN = defaultSkin();
const FOOT_Y = 256 - LEG_W / 2;

/* ---------- Coo ---------- */
/**
 * Coo in sticker space. `x, y`: where the point between the soles lands; `s`: scale (1 = logo size);
 * `rot` about the soles, or about the body's centre with `spin`; `sq` squash (+ flatter, − taller);
 * `flip` faces left. `face` names a kit face, `fc` overrides its fields. `feet`: the two feet in logo
 * units, else standing; `low` sinks the body (29 = seated). `look` shifts the eyes.
 */
function coo(o) {
  const { x = 128, y = 256, s = .6, rot = 0, sq = 0, flip = false, t = 0, spin = null } = o;
  const fc = { ...FACES[o.face || 'neutral'].f(t, o.faceP), ...(o.fc || {}) };
  const low = o.low || 0;
  const feet = o.feet || HIPS.map(h => [h[0], FOOT_Y]);
  const legs = feet.map((ft, i) => [HIPS[i][0], HIPS[i][1] + low, ft[0], ft[1]]);
  const kx = s * (1 + sq * .7) * (flip ? -1 : 1), ky = s * (1 - sq);
  const frame = { look: o.look || [0, 0], legs, low, t, blink: o.blink || 0, eyeClose: 0, acc: SKIN, swing: o.swing || 0 };
  // the white plate fills the ring so the face reads on a dark chat background too
  const plate = `<circle cx="128" cy="${f(128 + low)}" r="84" fill="#fff"/>`;
  const tf = spin
    ? `translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${kx.toFixed(4)} ${ky.toFixed(4)}) translate(-128 -${spin})`
    : `translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${kx.toFixed(4)} ${ky.toFixed(4)}) translate(-128 -256)`;
  return `<g transform="${tf}">${plate}${figure(fc, frame)}</g>`;
}
/** Feet for a step cycle: `ph` the phase, each foot half a turn apart. */
const stepFeet = (ph, stride, lift) => HIPS.map((h, i) => {
  const p = ph + i * Math.PI;
  return [h[0] + stride * Math.sin(p), FOOT_Y - lift * Math.max(0, Math.cos(p))];
});
const airFeet = (spread = 9) => HIPS.map((h, i) => [h[0] + (i ? spread : -spread), h[1] + 33]);
const sitFeet = () => HIPS.map(h => [h[0] + 26, FOOT_Y]);
/** A blink at loop phase `at` lasting `d` of the loop. */
const blinkAt = (k, at, d = .06) => (k > at && k < at + d ? Math.sin(Math.PI * (k - at) / d) : 0);

/* ---------- particles (the kit's line style: round caps, no fills thinner than a stroke) ---------- */
const P = {
  heart: (x, y, sc, color = C.heart, w = 5, rot = 0) =>
    `<path fill="none" stroke="${color}" stroke-width="${f(w / sc)}" stroke-linejoin="round" transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(sc * 100) / 100})" d="${heartD(0, 0, 1)}"/>`,
  heartFill: (x, y, sc, color = C.heart, rot = 0) =>
    `<path fill="${color}" transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(sc * 100) / 100})" d="${heartD(0, 0, 1)}"/>`,
  // the four-point glint of the kit's sparkle face, its arms tapered by drawing two lengths
  glint: (x, y, r, color = C.lemon, w = 4.5, rot = 0) => r < .3 ? '' :
    `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})" stroke="${color}" stroke-width="${f(w)}" stroke-linecap="round"><path d="M0 ${f(-r)}V${f(r)}M${f(-r)} 0H${f(r)}"/></g>`,
  star: (x, y, r, color = C.lemon, w = 4, rot = 0) => {
    if (r < .5) return '';
    let d = '';
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .48 : r;
      d += (i ? 'L' : 'M') + f(rr * Math.cos(a)) + ' ' + f(rr * Math.sin(a));
    }
    return `<path transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})" fill="${color}" stroke="${color}" stroke-width="${f(w)}" stroke-linejoin="round" d="${d}Z"/>`;
  },
  ring: (x, y, r, color = C.mint, w = 4) => r < .5 ? '' : `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="none" stroke="${color}" stroke-width="${f(w)}"/>`,
  dot: (x, y, r, color = C.mint) => r < .3 ? '' : `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${color}"/>`,
  drop: (x, y, sc, rot = 0, color = C.tear) => sc < .05 ? '' : `<path fill="${color}" transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(sc * 100) / 100})" d="${DROP}"/>`,
  z: (x, y, sc, color = C.mint) => sc < .05 ? '' :
    `<path fill="none" stroke="${color}" stroke-width="${f(3 / sc)}" stroke-linecap="round" stroke-linejoin="round" transform="translate(${f(x)} ${f(y)}) scale(${f(sc * 100) / 100})" d="M-6 -7H6L-6 7H6"/>`,
  note: (x, y, sc, color = C.mint, rot = 0) => sc < .05 ? '' :
    `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(sc * 100) / 100})" fill="none" stroke="${color}" stroke-linecap="round"><path stroke-width="2.6" d="M3 4V-9L9 -6"/><circle stroke-width="3.8" cx="0" cy="4.5" r="1.9"/></g>`,
  line: (x1, y1, x2, y2, color = C.ink, w = 5) => `<path stroke="${color}" stroke-width="${f(w)}" stroke-linecap="round" d="M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}"/>`,
  // a crescent: the lit side of a disc with a second disc taken out
  moon: (x, y, r, color = C.lemon) =>
    `<path fill="${color}" stroke="${color}" stroke-width="3" stroke-linejoin="round" transform="translate(${f(x)} ${f(y)}) rotate(-20)" d="M0 ${f(-r)}A${f(r)} ${f(r)} 0 1 0 0 ${f(r)}A${f(r * .78)} ${f(r * .78)} 0 1 1 0 ${f(-r)}Z"/>`,
  // the kit's anger mark, four corners of a cross
  anger: (x, y, sc, color = C.anger) => sc < .05 ? '' :
    `<g transform="translate(${f(x)} ${f(y)}) scale(${f(sc * 100) / 100})" fill="none" stroke="${color}" stroke-width="${f(7 / Math.max(sc, .6))}" stroke-linecap="round"><path d="M-13 -4Q-4 -4 -4 -13M4 -13Q4 -4 13 -4M13 4Q4 4 4 13M-4 13Q-4 4 -13 4"/></g>`,
  question: (x, y, sc, color = C.mint, rot = 0) => sc < .05 ? '' :
    `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(sc * 100) / 100})"><path fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" d="M-10 -12Q-10 -24 0 -24Q11 -24 11 -13Q11 -5 0 -1V5"/><circle fill="${color}" cx="0" cy="18" r="5.5"/></g>`,
  swirl: (x, y, r, a0, color = C.purple, w = 4) => {
    let d = '';
    for (let i = 0; i <= 24; i++) {
      const a = a0 + i / 24 * Math.PI * 1.6, rr = r * (.35 + .65 * i / 24);
      d += (i ? 'L' : 'M') + f(x + rr * Math.cos(a)) + ' ' + f(y + rr * Math.sin(a));
    }
    return `<path fill="none" stroke="${color}" stroke-width="${f(w)}" stroke-linecap="round" d="${d}"/>`;
  },
  // a rounded confetti bit: a short thick stroke
  bit: (x, y, len, rot, color, w = 5) => len < .5 ? '' :
    `<path transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})" stroke="${color}" stroke-width="${f(w)}" stroke-linecap="round" d="M${f(-len / 2)} 0H${f(len / 2)}"/>`,
};
const CONFETTI = [C.mint, C.lemon, C.heart, C.nav, C.purple, C.holo];

/** Whether a caption can stand one character under another: CJK characters and the marks that go with them. */
const upright = (text) => /^[p{Script=Han}p{Script=Hiragana}p{Script=Katakana}p{Script=Hangul}ー~～…!?！？]+$/u.test(text);

/* ---------- the stickers ---------- */
// caption: { str, x, y, size, color, rot, scale, fit (the widest it may be, or tallest when vertical),
// each(i) → { dx, dy, rot, s } } in sticker units
export const STICKERS = [
  {
    id: 'hi', dur: 1.6,
    frame(t, text) {
      const k = t / this.dur, w = Math.sin(k * TAU * 2);
      // a skip: one foot then the other tucks up, the body leans over the foot it stands on
      const side = w > 0 ? 1 : 0, up = Math.abs(w);
      const feet = HIPS.map((h, i) => i === side ? [h[0] + (i ? 12 : -12), FOOT_Y - 22 * up] : [h[0], FOOT_Y]);
      const bob = up;
      let s = coo({ x: 160, y: 246 - 10 * bob, s: .62, rot: -8 * w, face: blinkAt(k, .7) ? 'happy' : 'wink', feet, t, sq: -.04 * bob });
      for (let i = 0; i < 3; i++) {
        const a = frac(k * 2 + i / 3), p = life(a, .3, .4);
        s += P.glint(212 + 18 * Math.cos(i * 2.1), 70 - 30 * a + 14 * Math.sin(i * 1.7), 10 * p, i === 1 ? C.mint : C.lemon, 5, 45 * a);
      }
      return { svg: s, caption: { str: text, fit: 124, x: 70, y: 92, size: 74, color: C.mint, rot: -10 + 5 * w, each: i => ({ dy: -6 * bump(frac(k * 2 - i * .15) * 2) }) } };
    },
  },
  {
    id: 'love', dur: 1.2,
    frame(t, text) {
      const k = t / this.dur;
      // a heartbeat: two beats a loop, lub then dub
      const beat = Math.exp(-((k % .5) * 26)) * (1 - .3 * (k >= .5));
      let s = '';
      // a ring of hearts blooms out on each beat
      for (let i = 0; i < 6; i++) {
        const a = frac(k * 2), r = 70 + 46 * smooth(a), ang = -Math.PI / 2 + (i - 2.5) * .5;
        s += P.heart(128 + r * Math.cos(ang), 128 + r * Math.sin(ang) * .9, .7 * life(a, .15, .45) * (i % 2 ? .8 : 1.1), i % 3 === 1 ? C.rose : C.heart, 5, (i - 2.5) * 12);
      }
      for (let i = 0; i < 5; i++) {
        const a = frac(k + i / 5), x = 40 + hash(i) * 176;
        s += P.heartFill(x + 8 * Math.sin(a * TAU + i), 190 - 150 * a, .42 * life(a, .2, .3), i % 2 ? C.blush : C.heart);
      }
      s += coo({ x: 128, y: 190, s: .55 * (1 + .07 * beat), sq: .06 * beat, face: 'love', t, look: [0, 2] });
      return { svg: s, caption: { str: text, fit: 220, x: 128, y: 224, size: 56, color: C.heart, scale: 1 + .12 * beat } };
    },
  },
  {
    id: 'yay', dur: 1.4,
    frame(t, text) {
      const k = t / this.dur;
      // crouch, leap, land, settle
      const air = clamp((k - .14) / .58, 0, 1), h = 54 * 4 * air * (1 - air);
      const inAir = k > .14 && k < .72;
      const sq = k < .14 ? .2 * bump(k / .14 * .9) : inAir ? -.1 * bump(air) : .26 * Math.exp(-(k - .72) * 14) * Math.cos((k - .72) * 30);
      let s = '';
      // confetti bursts at the top of the leap
      const bk = clamp((k - .36) / .6, 0, 1);
      if (bk > 0 && bk < 1) for (let i = 0; i < 14; i++) {
        const ang = i / 14 * TAU + hash(i) * .4, sp = 70 + 50 * hash(i + 9);
        const d = sp * (1 - Math.pow(1 - bk, 2.2));
        s += P.bit(128 + d * Math.cos(ang), 130 - h * .3 + d * Math.sin(ang) + 40 * bk * bk, 12 * life(bk, .1, .35), ang * 57 + 300 * bk, CONFETTI[i % CONFETTI.length], 5.5);
      }
      // dust rings where the feet land
      const dk = clamp((k - .72) / .26, 0, 1);
      if (dk > 0 && dk < 1) for (const sgn of [-1, 1]) for (let j = 0; j < 2; j++) {
        s += P.ring(128 + sgn * (40 + 36 * dk + j * 14), 240 - 10 * dk - j * 6, (4 + 7 * dk) * life(dk, .1, .5) * (j ? .7 : 1), C.dust, 3.5);
      }
      s += coo({ x: 128, y: 244 - h, s: .5, sq, face: inAir ? 'excited' : 'happy', feet: inAir ? airFeet(11) : undefined, t, rot: inAir ? 4 * Math.sin(air * TAU) : 0 });
      const pop = 1 + .16 * Math.exp(-Math.max(0, k - .72) * 12) * (k > .72);
      return { svg: s, caption: { str: text, fit: 216, x: 128, y: 40, size: 56, color: C.lemon, scale: pop, rot: -3 + 6 * Math.sin(k * TAU), each: i => ({ dy: -8 * bump(clamp((k - .2 - i * .06) / .3, 0, 1)) }) } };
    },
  },
  {
    id: 'peek', dur: 2.2,
    frame(t, text) {
      const k = t / this.dur;
      // rises from the bottom edge, looks left, then right, then ducks back
      const up = smooth(k / .16) * (1 - smooth((k - .86) / .12));
      const lx = k < .3 ? 0 : k < .55 ? -9 : k < .8 ? 6 : 0;
      const lookK = smooth((k - .3) / .06) * (1 - smooth((k - .8) / .06));
      const look = [lerp(0, lx, k < .55 ? lookK : 1), -2];
      const q = clamp((k - .42) / .4, 0, 1);
      let s = coo({ x: 160, y: 256 + 150 - 92 * up, s: .9, rot: -10 + 4 * Math.sin(k * TAU * 2) * up, flip: true, face: 'neutral', look, t, blink: blinkAt(k, .62), fc: { gap: [44, 44] } });
      s += P.question(56, 132 - 6 * Math.sin(q * TAU), 1.1 * life(q, .15, .25) * up, C.mint, -12);
      return { svg: s, caption: { str: text, fit: 136, x: 80, y: 56, size: 60, color: C.mint, rot: -8, scale: .9 + .1 * up, each: i => ({ dy: -5 * Math.sin(k * TAU * 2 - i * .8) }) } };
    },
  },
  {
    id: 'night', dur: 2.4,
    frame(t, text) {
      const k = t / this.dur, br = Math.sin(k * TAU);
      let s = P.moon(196, 58, 30);
      for (let i = 0; i < 4; i++) {
        const tw = .5 + .5 * Math.sin(k * TAU * 2 + i * 1.9);
        const pos = [[150, 36], [236, 104], [178, 112], [228, 26]][i];
        s += P.glint(pos[0], pos[1], (4 + 5 * tw) * (i % 2 ? .8 : 1), i === 2 ? C.mint : C.lemon, 4);
      }
      // z's drift up and right toward the moon
      for (let i = 0; i < 3; i++) {
        const a = frac(k + i / 3), p = life(a, .2, .25);
        s += P.z(88 + 64 * a + 6 * Math.sin(a * 9), 128 - 70 * a, (.9 + 1.1 * a) * p, C.mint);
      }
      s += coo({ x: 78, y: 246, s: .58, rot: 5 + 2 * br, sq: .03 * br, face: 'sleep', feet: sitFeet(), low: 29, t: t * 1.6 });
      return { svg: s, caption: { str: text, fit: 104, x: 200, y: 216, size: 50, color: C.nav, rot: 6, each: i => ({ dy: 4 * Math.sin(k * TAU - i * 1.2) }) } };
    },
  },
  {
    id: 'cry', dur: 1.2,
    frame(t, text) {
      const k = t / this.dur, sob = Math.abs(Math.sin(k * TAU * 2));
      let s = '';
      // a fountain of tears from each eye
      for (let side = 0; side < 2; side++) for (let i = 0; i < 4; i++) {
        const a = frac(k * 2 + i / 4), sgn = side ? 1 : -1;
        const x0 = side ? 166 : 98, y0 = 132;
        const x = x0 + sgn * (18 + 58 * a), y = y0 - 84 * a + 176 * a * a;
        s += P.drop(x, y, 1.5 * life(a, .1, .2), sgn * (20 + 80 * a));
      }
      s += coo({ x: 128 + 1.6 * Math.sin(k * TAU * 12), y: 292, s: .92, sq: .04 * sob, face: 'cry', t, fc: { streams: true } });
      return { svg: s, caption: { str: text, fit: 128, x: 70, y: 232, size: 56, color: C.tear, rot: -6, each: i => ({ dy: 3 * Math.sin(k * TAU * 4 + i * 2), rot: 6 * Math.sin(k * TAU * 2 + i * 1.5) }) } };
    },
  },
  {
    id: 'hmph', dur: 1.0,
    frame(t, text) {
      const k = t / this.dur;
      // stomps: the feet take turns, twice a loop
      const ph = k * TAU * 2, feet = stepFeet(ph, 4, 18);
      const stomp = Math.pow(Math.abs(Math.cos(ph)), 6);
      let s = '';
      for (let i = 0; i < 3; i++) {
        const a = frac(k * 2 + i / 3), x = 182 + 14 * i - 6 + 10 * a, y = 74 - 50 * a;
        const r = 9 * life(a, .2, .4);
        s += P.ring(x, y, r, C.dust, 4) + P.ring(x + r * .9, y + r * .5, r * .7, C.dust, 4);
      }
      for (const sgn of [-1, 1]) {
        const dk = frac(k * 2);
        s += P.ring(150 + sgn * (40 + 24 * dk), 238 - 6 * dk, 6 * life(dk, .05, .6), C.dust, 3.5);
      }
      s += coo({ x: 150, y: 248, s: .6, rot: -7, sq: .06 * stomp, face: 'angry', feet, t: t * 1.3, fc: { anger: false } });
      s += P.anger(208, 96, 1.1 + .15 * Math.sin(k * TAU * 4));
      const sh = Math.sin(k * TAU * 9);
      return { svg: s, caption: { str: text, fit: 116, x: 64, y: 78, size: 76, color: C.anger, rot: -8 + 3 * sh, scale: 1 + .05 * stomp } };
    },
  },
  {
    id: 'dizzy', dur: 2.0,
    frame(t, text) {
      const k = t / this.dur;
      let s = '';
      for (let i = 0; i < 2; i++) s += P.swirl(128, 116, 104 - i * 10, k * TAU * 2 + i * Math.PI, [C.purple, C.holo][i], 4.5);
      // stars round the head, the near ones bigger
      const stars = [];
      for (let i = 0; i < 3; i++) {
        const a = k * TAU * 2 + i * TAU / 3, sn = Math.sin(a);
        stars.push({ z: sn, d: P.star(128 + 78 * Math.cos(a), 40 + 14 * sn, sn < 0 ? 7 : 11, C.lemon, 3, a * 40) });
      }
      s += stars.filter(x => x.z < 0).map(x => x.d).join('');
      s += coo({ x: 128, y: 120 + 8 * Math.sin(k * TAU * 2), s: .5, rot: 360 * k, spin: 128, face: 'dizzy', feet: airFeet(14), t, fc: { orbit: false } });
      s += stars.filter(x => x.z >= 0).map(x => x.d).join('');
      return { svg: s, caption: { str: text, fit: 220, x: 128, y: 234, size: 54, color: C.purple, each: i => ({ rot: 12 * Math.sin(k * TAU * 2 + i * 1.7), dy: 4 * Math.cos(k * TAU * 2 + i) }) } };
    },
  },
  {
    id: 'thanks', dur: 1.8,
    frame(t, text) {
      const k = t / this.dur;
      const bow = smooth((k - .08) / .2) * (1 - smooth((k - .55) / .14));
      const upK = clamp((k - .62) / .34, 0, 1);
      const face = bow > .35 ? 'bowing' : 'happy';
      let s = '';
      // when Coo straightens up, hearts and glints pop out on both sides
      if (upK > 0 && upK < 1) for (let i = 0; i < 6; i++) {
        const sgn = i % 2 ? 1 : -1, j = Math.floor(i / 2), a = clamp(upK * 1.2 - j * .12, 0, 1);
        const x = 128 + sgn * (64 + 22 * j + 14 * a), y = 150 - 40 * j - 22 * a;
        s += j === 1 ? P.glint(x, y, 9 * life(a, .2, .35), C.lemon, 5) : P.heart(x, y, .55 * life(a, .2, .35), j ? C.rose : C.heart, 5, sgn * 15);
      }
      s += coo({ x: 128, y: 240, s: .6, rot: 24 * bow, face, t, sq: -.05 * bump(upK * 1.4) });
      return { svg: s, caption: { str: text, fit: 220, x: 128, y: 50, size: 56, color: C.mint, rot: 3 * bow, scale: 1 + .1 * bump(upK * 1.5), each: i => ({ dy: 6 * bow * (i % 2 ? 1 : -.4) }) } };
    },
  },
  {
    id: 'dash', dur: 1.2,
    frame(t, text) {
      const k = t / this.dur, ph = k * TAU * 4;
      const span = 340, x0 = -44 + span * k;
      let s = '';
      for (const x of [x0, x0 - span]) {
        if (x < -90 || x > 350) continue;
        // speed lines and dust trail behind
        for (let i = 0; i < 3; i++) {
          const a = frac(k * 4 + i / 3), len = 44 * life(a, .15, .5);
          const yy = [146, 176, 206][i];
          s += P.line(x - 72 - 30 * a, yy, x - 72 - 30 * a - len, yy, i === 1 ? C.mint : C.dust, 6);
        }
        for (let i = 0; i < 4; i++) {
          const a = frac(k * 4 + i / 4);
          s += P.ring(x - 22 - 40 * a, 236 - 14 * a, 7 * life(a, .05, .6), C.dust, 3.5);
        }
        s += coo({ x, y: 238 - 6 * Math.abs(Math.sin(ph)), s: .54, rot: 12, face: 'run', feet: stepFeet(ph, 16, 18), t, swing: -10 });
      }
      return { svg: s, caption: { str: text, fit: 220, x: 128, y: 54, size: 62, color: C.fox, rot: -6, each: i => ({ dx: 1.5 * Math.sin(k * TAU * 8 + i), dy: -4 * Math.abs(Math.sin(ph / 2 + i * .7)) }) } };
    },
  },
  {
    id: 'shy', dur: 2.0,
    frame(t, text) {
      const k = t / this.dur, sw = Math.sin(k * TAU);
      // the far foot taps its toe
      const tap = Math.abs(Math.sin(k * TAU * 2));
      const feet = [[HIPS[0][0] + 6, FOOT_Y], [HIPS[1][0] + 18, FOOT_Y - 12 * tap]];
      let s = '';
      for (let i = 0; i < 3; i++) {
        const a = frac(k * 1.5 + i / 3);
        s += P.heart(206 + 18 * Math.sin(a * 5 + i), 146 - 74 * a, .5 * life(a, .2, .3), i === 1 ? C.rose : C.heart, 5, 10 * Math.sin(a * 6));
      }
      s += coo({ x: 156, y: 248, s: .6, rot: 6 * sw, face: 'shy', feet, t, swing: 10 * sw });
      // the caption runs down the left edge, one character under the other
      const each = i => ({ dx: 4 * Math.sin(k * TAU + i * 1.4), rot: 8 * Math.sin(k * TAU + i * 1.4) });
      return { svg: s, caption: upright(text)
        ? { str: text, x: 52, y: 100, size: 62, color: C.heart, vertical: true, fit: 176, each }
        : { str: text, x: 74, y: 56, size: 56, color: C.heart, rot: -8, fit: 132, each } };
    },
  },
  {
    id: 'think', dur: 2.0,
    frame(t, text) {
      const k = t / this.dur, tilt = Math.sin(k * TAU);
      let s = '';
      // a thought bubble grows from three rings and holds the caption
      const g = smooth(k / .3) * (1 - smooth((k - .88) / .1));
      s += P.ring(110, 116, 5 * smooth(k / .1), C.mint, 4.5) + P.ring(126, 100, 8 * smooth((k - .07) / .1), C.mint, 4.5);
      const bub = 64 * g;
      if (bub > 1) {
        let d = '';
        const n = 9;
        for (let i = 0; i <= n; i++) {
          const a = i / n * TAU, rx = bub * 1.08, ry = bub * .68;
          const px = 166 + rx * Math.cos(a), py = 68 + ry * Math.sin(a);
          if (!i) d = `M${f(px)} ${f(py)}`;
          else {
            const am = (i - .5) / n * TAU, qx = 166 + rx * 1.18 * Math.cos(am), qy = 68 + ry * 1.26 * Math.sin(am);
            d += `Q${f(qx)} ${f(qy)} ${f(px)} ${f(py)}`;
          }
        }
        s += `<path d="${d}Z" fill="#fff" stroke="${C.mint}" stroke-width="5" stroke-linejoin="round"/>`;
      }
      s += coo({ x: 82, y: 246, s: .56, rot: 7 * tilt, face: 'thinking', t, look: [3 + 2 * tilt, -4], fc: { think: false }, blink: blinkAt(k, .5) });
      const dots = Math.floor(frac(k * 2) * 4);
      return { svg: s, caption: g > .5 ? { str: text + '.'.repeat(dots), fit: 124, x: 166, y: 68, size: 38 * g, color: C.mint, align: 'left', anchor: 126 } : null };
    },
  },
];

/* ---------- rendering ---------- */
const STYLE = `<style>${COO_CSS}${skinCss(SKIN)}</style>`;
const svgDoc = body => `<svg xmlns="http://www.w3.org/2000/svg" data-theme="light" width="256" height="256" viewBox="0 0 256 256">${STYLE}${body}</svg>`;

function loadSvg(markup) {
  return new Promise((ok, bad) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => bad(new Error('svg frame failed to load'));
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  });
}

function drawCaption(ctx, cap, U, font) {
  ctx.save();
  // the picked font first; characters it lacks come from the system's
  ctx.font = `${cap.size * U}px "${font}", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const chars = [...cap.str];
  const widths = chars.map(ch => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0);
  ctx.translate(cap.x * U, cap.y * U);
  ctx.rotate((cap.rot || 0) * Math.PI / 180);
  const long = cap.vertical ? chars.length * cap.size * U : total;
  const sc = (cap.scale ?? 1) * (cap.fit ? Math.min(1, cap.fit * U / long) : 1);
  ctx.scale(sc, sc);
  let pen = cap.vertical ? -(chars.length - 1) * cap.size * U * .5 : cap.align === 'left' ? (cap.anchor - cap.x) * U : -total / 2;
  chars.forEach((ch, i) => {
    const e = cap.each ? cap.each(i) : {};
    ctx.save();
    if (cap.vertical) ctx.translate((e.dx || 0) * U, pen + (e.dy || 0) * U);
    else ctx.translate(pen + widths[i] / 2 + (e.dx || 0) * U, (e.dy || 0) * U);
    ctx.rotate((e.rot || 0) * Math.PI / 180);
    if (e.s) ctx.scale(e.s, e.s);
    ctx.lineWidth = cap.size * U * .14;
    ctx.strokeStyle = C.ink;
    ctx.textAlign = 'center';
    ctx.strokeText(ch, 0, 0);
    ctx.fillStyle = cap.color;
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    pen += cap.vertical ? cap.size * U * 1.0 : widths[i];
  });
  ctx.restore();
}

/** Lays a white outline `r` pixels wide under whatever `src` holds. */
function outline(src, r) {
  const W = src.width, H = src.height;
  const o = new OffscreenCanvas(W, H), c = o.getContext('2d');
  const N = 28;
  for (const rr of [r, r * .5]) for (let i = 0; i < N; i++) {
    const a = i / N * TAU;
    c.drawImage(src, rr * Math.cos(a), rr * Math.sin(a));
  }
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = '#fff';
  c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = 'source-over';
  c.drawImage(src, 0, 0);
  return o;
}

/**
 * One frame at `size` pixels: the scene drawn at twice the size, outlined, then scaled down. `text` is the
 * caption, `font` a font family the page has (a loaded FontFace or an installed font).
 * Returns the canvas (RGBA with soft edges; `flatten` makes it GIF-ready).
 */
export async function renderFrame(sticker, t, { text, font, size = 240 }) {
  const big = size * 2, U = big / 256;
  const { svg, caption } = sticker.frame(t, text);
  const im = await loadSvg(svgDoc(svg));
  const layer = new OffscreenCanvas(big, big), ctx = layer.getContext('2d');
  ctx.drawImage(im, 0, 0, big, big);
  if (caption) drawCaption(ctx, caption, U, font);
  const done = outline(layer, 4.5 * U * 256 / 240);
  const out = new OffscreenCanvas(size, size), oc = out.getContext('2d');
  oc.imageSmoothingQuality = 'high';
  oc.drawImage(done, 0, 0, size, size);
  return out;
}

/** The whole loop as GIF bytes; `opts` as for `renderFrame`. */
export async function renderGif(sticker, opts) {
  const { size = 240 } = opts, fps = 20;
  const n = Math.round(sticker.dur * fps), frames = [];
  for (let i = 0; i < n; i++) {
    const cv = await renderFrame(sticker, i / fps, opts);
    frames.push(flatten(cv.getContext('2d').getImageData(0, 0, size, size).data));
  }
  return encodeGif(size, size, frames, frames.map(() => Math.round(100 / fps)));
}
