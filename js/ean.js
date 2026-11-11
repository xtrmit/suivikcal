/* Lecteur de codes-barres EAN-13 / EAN-8 / UPC-A, sans dépendance.
   Utilisé quand le téléphone n'a pas de détecteur intégré (iPhone / Safari).
   Principe : on lit plusieurs lignes horizontales de l'image, on les transforme en suites de barres
   noires et blanches, puis on reconnaît les chiffres d'après la largeur des barres. La clé de contrôle
   du code-barres valide le résultat. */
(function () {
  'use strict';
  const L = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'].map(s => s.split('').map(Number));
  const G = L.map(p => p.slice().reverse());
  const PARITE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

  /* Chiffre le plus proche pour 4 largeurs (écart total normalisé sur 7 modules). */
  function chiffre(w, tables) {
    const s = w[0] + w[1] + w[2] + w[3]; let best = null;
    for (const t of tables) for (let d = 0; d < 10; d++) {
      const p = t.p[d]; let e = 0;
      for (let k = 0; k < 4; k++) e += Math.abs(w[k] * 7 / s - p[k]);
      if (!best || e < best.e) best = { d, e, t: t.n };
    }
    return best && best.e < 1.6 ? best : null;
  }
  function garde(runs, i, n, unit) { for (let k = 0; k < n; k++) { const r = runs[i + k] / unit; if (r < 0.4 || r > 1.9) return false; } return true; }
  function cle(ds) { /* ds sans le dernier chiffre ; poids 3 / 1 en partant de la droite */
    let s = 0; for (let i = ds.length - 1, k = 0; i >= 0; i--, k++) s += ds[i] * (k % 2 === 0 ? 3 : 1);
    return (10 - s % 10) % 10;
  }

  function ean13(runs, i) {
    if (i + 59 > runs.length) return null;
    let tot = 0; for (let k = 0; k < 59; k++) tot += runs[i + k];
    const unit = tot / 95;
    if (i > 0 && runs[i - 1] < unit * 3) return null;               /* marge blanche avant */
    if (!garde(runs, i, 3, unit) || !garde(runs, i + 27, 5, unit) || !garde(runs, i + 56, 3, unit)) return null;
    const ds = [], par = [];
    for (let j = 0; j < 6; j++) { const c = chiffre(runs.slice(i + 3 + j * 4, i + 7 + j * 4), [{ n: 'L', p: L }, { n: 'G', p: G }]); if (!c) return null; ds.push(c.d); par.push(c.t); }
    for (let j = 0; j < 6; j++) { const c = chiffre(runs.slice(i + 32 + j * 4, i + 36 + j * 4), [{ n: 'R', p: L }]); if (!c) return null; ds.push(c.d); }
    const first = PARITE.indexOf(par.join('')); if (first < 0) return null;
    const all = [first].concat(ds);
    if (cle(all.slice(0, 12)) !== all[12]) return null;
    return all.join('');
  }
  function ean8(runs, i) {
    if (i + 43 > runs.length) return null;
    let tot = 0; for (let k = 0; k < 43; k++) tot += runs[i + k];
    const unit = tot / 67;
    if (i > 0 && runs[i - 1] < unit * 3) return null;
    if (!garde(runs, i, 3, unit) || !garde(runs, i + 19, 5, unit) || !garde(runs, i + 40, 3, unit)) return null;
    const ds = [];
    for (let j = 0; j < 4; j++) { const c = chiffre(runs.slice(i + 3 + j * 4, i + 7 + j * 4), [{ n: 'L', p: L }]); if (!c) return null; ds.push(c.d); }
    for (let j = 0; j < 4; j++) { const c = chiffre(runs.slice(i + 24 + j * 4, i + 28 + j * 4), [{ n: 'R', p: L }]); if (!c) return null; ds.push(c.d); }
    if (cle(ds.slice(0, 7)) !== ds[7]) return null;
    return ds.join('');
  }

  /* Une ligne de luminances -> code lu ou null. */
  function ligne(lum) {
    const n = lum.length, win = Math.max(8, Math.round(n / 40));
    const pre = new Float64Array(n + 1); for (let x = 0; x < n; x++) pre[x + 1] = pre[x] + lum[x];
    let mn = 255, mx = 0; for (let x = 0; x < n; x++) { if (lum[x] < mn) mn = lum[x]; if (lum[x] > mx) mx = lum[x]; }
    if (mx - mn < 40) return null;
    const noir = new Uint8Array(n);
    for (let x = 0; x < n; x++) {
      const a = Math.max(0, x - win), b = Math.min(n, x + win + 1), moy = (pre[b] - pre[a]) / (b - a);
      noir[x] = lum[x] < (moy * 0.6 + (mn + mx) / 2 * 0.4) ? 1 : 0;
    }
    for (const sens of [1, -1]) {
      const runs = [], couleur = [];
      let x0 = sens > 0 ? 0 : n - 1, cur = noir[x0], len = 0;
      for (let k = 0; k < n; k++) { const x = sens > 0 ? k : n - 1 - k; if (noir[x] === cur) len++; else { runs.push(len); couleur.push(cur); cur = noir[x]; len = 1; } }
      runs.push(len); couleur.push(cur);
      for (let i = 0; i < runs.length; i++) {
        if (!couleur[i]) continue;
        const r = ean13(runs, i) || ean8(runs, i); if (r) return r;
      }
    }
    return null;
  }

  /* imageData (RGBA) -> code lu ou null. Lit 15 lignes dans la bande centrale. */
  function image(img) {
    const w = img.width, h = img.height, d = img.data, lum = new Float64Array(w);
    for (let k = 0; k < 15; k++) {
      const y = Math.round(h * (0.3 + 0.4 * k / 14));
      for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; lum[x] = (d[o] * 299 + d[o + 1] * 587 + d[o + 2] * 114) / 1000; }
      const r = ligne(lum); if (r) return r;
    }
    return null;
  }

  /* Lecture en continu depuis une vidéo. Appelle ok(code) quand le même code est lu deux fois. */
  function suivre(video, ok, actif) {
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
    let dernier = '';
    const tick = () => {
      if (!actif()) return;
      const vw = video.videoWidth, vh = video.videoHeight;
      if (vw && vh) {
        const w = Math.min(1280, vw), h = Math.round(vh * w / vw);
        cv.width = w; cv.height = h; ctx.drawImage(video, 0, 0, w, h);
        const r = image(ctx.getImageData(0, 0, w, h));
        if (r) { if (r === dernier) { ok(r); return; } dernier = r; }
      }
      setTimeout(tick, 120);
    };
    tick();
  }

  const api = { ligne, image, suivre };
  if (typeof module !== 'undefined') module.exports = api; else self.SKEan = api;
})();
