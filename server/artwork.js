'use strict';
/**
 * Generates the storefront's product artwork as self-contained SVG files —
 * an editorial, duotone "print" look. Every product gets a dedicated
 * illustration (PRODUCT_ART); unknown SKUs fall back to abstract compositions.
 * Deterministic, no external images or font downloads at runtime.
 */
const PALETTES = {
  audio: { paper: '#F3EAD9', ink: '#211A1B', accent: '#E0512E' },
  workspace: { paper: '#EDEFE3', ink: '#232D24', accent: '#7D8F5F' },
  home: { paper: '#F6EFE2', ink: '#2A2320', accent: '#C9883B' },
  carry: { paper: '#ECEDE8', ink: '#1F242E', accent: '#5E7796' },
  fitness: { paper: '#F2E9DE', ink: '#26221F', accent: '#A65B44' },
};
const DEFAULT_PALETTE = PALETTES.home;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAIN = `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.06 0"/></filter>`;

/* ═══════════════════════════════════════════════════════════════
   Per-product illustrations — duotone editorial prints.
   Each fn(palette, rnd) returns SVG shapes on an 800x1000 canvas.
   ═══════════════════════════════════════════════════════════════ */
const PRODUCT_ART = {
  /* ── AUDIO ── */
  'AUR-HALO': p => `
      <path d="M 258 560 A 142 142 0 0 1 542 560" fill="none" stroke="${p.ink}" stroke-width="28" stroke-linecap="round"/>
      <rect x="220" y="530" width="80" height="128" rx="32" fill="${p.ink}"/>
      <rect x="500" y="530" width="80" height="128" rx="32" fill="${p.ink}"/>
      <rect x="246" y="556" width="28" height="76" rx="14" fill="${p.accent}"/>
      <rect x="526" y="556" width="28" height="76" rx="14" fill="${p.accent}"/>
      <circle cx="400" cy="404" r="14" fill="${p.accent}"/>
      <line x1="150" y1="820" x2="650" y2="820" stroke="${p.ink}" stroke-width="3"/>`,
  'AUR-PEBL': p => `
      <rect x="240" y="360" width="320" height="360" rx="150" fill="${p.ink}"/>
      ${[440, 490, 540].map(y => `<line x1="300" y1="${y}" x2="500" y2="${y}" stroke="${p.paper}" stroke-opacity="0.32" stroke-width="9" stroke-linecap="round"/>`).join('')}
      <circle cx="400" cy="640" r="26" fill="${p.accent}"/>
      <line x1="200" y1="820" x2="600" y2="820" stroke="${p.ink}" stroke-width="3"/>`,
  'AUR-CADN': p => `
      <circle cx="330" cy="400" r="38" fill="${p.accent}"/>
      <rect x="312" y="428" width="36" height="70" rx="18" fill="${p.ink}"/>
      <circle cx="470" cy="400" r="38" fill="${p.accent}"/>
      <rect x="452" y="428" width="36" height="70" rx="18" fill="${p.ink}"/>
      <rect x="260" y="540" width="280" height="190" rx="70" fill="${p.ink}"/>
      <line x1="290" y1="596" x2="510" y2="596" stroke="${p.paper}" stroke-opacity="0.32" stroke-width="6"/>
      <circle cx="400" cy="668" r="10" fill="${p.accent}"/>
      <line x1="220" y1="820" x2="580" y2="820" stroke="${p.ink}" stroke-width="3"/>`,
  'AUR-TURN': p => `
      <rect x="170" y="540" width="460" height="190" rx="18" fill="${p.ink}"/>
      <circle cx="330" cy="635" r="92" fill="${p.paper}"/>
      <circle cx="330" cy="635" r="60" fill="none" stroke="${p.ink}" stroke-width="5"/>
      <circle cx="330" cy="635" r="9" fill="${p.accent}"/>
      <circle cx="560" cy="586" r="20" fill="${p.accent}"/>
      <line x1="560" y1="586" x2="462" y2="690" stroke="${p.accent}" stroke-width="11" stroke-linecap="round"/>
      <rect x="200" y="730" width="34" height="22" fill="${p.ink}"/>
      <rect x="566" y="730" width="34" height="22" fill="${p.ink}"/>
      <line x1="150" y1="820" x2="650" y2="820" stroke="${p.ink}" stroke-width="3"/>`,
  'AUR-MON': p => `
      <rect x="280" y="350" width="240" height="400" rx="16" fill="${p.ink}"/>
      <circle cx="400" cy="620" r="74" fill="none" stroke="${p.paper}" stroke-opacity="0.5" stroke-width="9"/>
      <circle cx="400" cy="620" r="20" fill="${p.accent}"/>
      <circle cx="400" cy="448" r="34" fill="none" stroke="${p.paper}" stroke-opacity="0.5" stroke-width="7"/>
      <rect x="330" y="516" width="140" height="8" rx="4" fill="${p.paper}" fill-opacity="0.25"/>
      <line x1="230" y1="820" x2="570" y2="820" stroke="${p.ink}" stroke-width="3"/>`,

  /* ── WORKSPACE ── */
  'KAN-SLAT': p => {
    let keys = '';
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 12; col++) {
        const x = 214 + col * 31.5, y = 586 + row * 30;
        const isEsc = row === 0 && col === 0;
        keys += `<rect x="${x}" y="${y}" width="26" height="24" rx="5" fill="${isEsc ? p.accent : p.paper}" fill-opacity="${isEsc ? 1 : 0.82}"/>`;
      }
    }
    return `<rect x="190" y="556" width="420" height="160" rx="18" fill="${p.ink}"/>${keys}
      <rect x="214" y="706" width="120" height="24" rx="5" fill="${p.paper}" fill-opacity="0.82"/>
      <rect x="466" y="706" width="120" height="24" rx="5" fill="${p.paper}" fill-opacity="0.82"/>
      <line x1="150" y1="820" x2="650" y2="820" stroke="${p.ink}" stroke-width="3"/>`;
  },
  'KAN-ALDR': p => `
      <path d="M 400 820 C 400 610 300 585 345 480" fill="none" stroke="${p.ink}" stroke-width="18" stroke-linecap="round"/>
      <path d="M 345 480 A 74 74 0 0 1 493 480 Z" fill="${p.ink}"/>
      <path d="M 368 500 L 470 500 L 505 690 L 333 690 Z" fill="${p.accent}" fill-opacity="0.2"/>
      <ellipse cx="400" cy="826" rx="110" ry="16" fill="${p.ink}"/>
      <circle cx="352" cy="540" r="11" fill="${p.accent}"/>
      <line x1="220" y1="856" x2="580" y2="856" stroke="${p.ink}" stroke-width="3"/>`,
  'KAN-FLDN': p => `
      <rect x="266" y="440" width="290" height="72" rx="10" fill="${p.ink}"/>
      <rect x="256" y="518" width="310" height="72" rx="10" fill="${p.ink}" fill-opacity="0.88"/>
      <rect x="246" y="596" width="330" height="72" rx="10" fill="${p.ink}" fill-opacity="0.76"/>
      <line x1="540" y1="440" x2="540" y2="668" stroke="${p.accent}" stroke-width="12"/>
      <rect x="470" y="424" width="18" height="34" rx="6" fill="${p.accent}"/>
      <line x1="200" y1="740" x2="620" y2="740" stroke="${p.ink}" stroke-width="3"/>`,
  'KAN-MRDO': p => `
      <path d="M 230 590 L 570 590 L 545 760 L 255 760 Z" fill="${p.ink}"/>
      <line x1="352" y1="590" x2="344" y2="760" stroke="${p.paper}" stroke-opacity="0.35" stroke-width="7"/>
      <line x1="458" y1="590" x2="462" y2="760" stroke="${p.paper}" stroke-opacity="0.35" stroke-width="7"/>
      <rect x="272" y="548" width="60" height="14" rx="7" fill="${p.accent}"/>
      <rect x="286" y="560" width="60" height="14" rx="7" fill="${p.ink}"/>
      <circle cx="410" cy="560" r="22" fill="${p.accent}"/>
      <line x1="180" y1="810" x2="620" y2="810" stroke="${p.ink}" stroke-width="3"/>`,
  'KAN-PEN': p => `
      <g transform="rotate(-35 400 600)">
        <rect x="352" y="380" width="96" height="300" rx="46" fill="${p.ink}"/>
        <rect x="366" y="330" width="68" height="66" rx="30" fill="${p.ink}" fill-opacity="0.85"/>
        <path d="M 366 680 L 434 680 L 412 760 L 388 760 Z" fill="${p.accent}"/>
        <circle cx="400" cy="726" r="8" fill="${p.paper}"/>
        <line x1="376" y1="420" x2="376" y2="620" stroke="${p.paper}" stroke-opacity="0.3" stroke-width="7"/>
      </g>
      <line x1="200" y1="856" x2="600" y2="856" stroke="${p.ink}" stroke-width="3"/>`,
  'KAN-PAD': p => `
      <rect x="170" y="540" width="460" height="250" rx="22" fill="${p.ink}"/>
      <rect x="192" y="562" width="416" height="206" rx="14" fill="none" stroke="${p.paper}" stroke-opacity="0.4" stroke-width="4" stroke-dasharray="10 9"/>
      <g transform="rotate(-24 400 660)">
        <rect x="330" y="640" width="150" height="26" rx="13" fill="${p.accent}"/>
        <path d="M 480 640 L 512 653 L 480 666 Z" fill="${p.paper}"/>
      </g>
      <line x1="140" y1="850" x2="660" y2="850" stroke="${p.ink}" stroke-width="3"/>`,
  'KAN-RISE': p => `
      <rect x="286" y="400" width="228" height="160" rx="12" fill="none" stroke="${p.ink}" stroke-width="15"/>
      <rect x="384" y="560" width="32" height="40" fill="${p.ink}"/>
      <rect x="330" y="600" width="140" height="20" rx="8" fill="${p.ink}"/>
      <rect x="190" y="636" width="420" height="38" rx="12" fill="${p.ink}"/>
      <rect x="226" y="674" width="26" height="86" fill="${p.ink}"/>
      <rect x="548" y="674" width="26" height="86" fill="${p.ink}"/>
      <circle cx="486" cy="428" r="11" fill="${p.accent}"/>
      <line x1="150" y1="800" x2="650" y2="800" stroke="${p.ink}" stroke-width="3"/>`,

  /* ── HOME ── */
  'NOR-EMBR': p => `
      <path d="M 300 470 L 500 470 L 486 780 L 314 780 Z" fill="${p.ink}"/>
      <ellipse cx="400" cy="470" rx="100" ry="22" fill="${p.ink}"/>
      <ellipse cx="400" cy="474" rx="78" ry="15" fill="${p.paper}" fill-opacity="0.18"/>
      <path d="M 502 540 C 585 545 585 680 498 688" fill="none" stroke="${p.ink}" stroke-width="26"/>
      <path d="M 356 400 C 348 372 368 356 360 328" fill="none" stroke="${p.accent}" stroke-width="7" stroke-linecap="round" stroke-opacity="0.75"/>
      <path d="M 430 408 C 422 380 442 364 434 336" fill="none" stroke="${p.accent}" stroke-width="7" stroke-linecap="round" stroke-opacity="0.55"/>
      <line x1="230" y1="830" x2="570" y2="830" stroke="${p.ink}" stroke-width="3"/>`,
  'NOR-DUNE': p => `
      <rect x="238" y="560" width="324" height="66" rx="20" fill="${p.ink}"/>
      <rect x="252" y="634" width="296" height="66" rx="20" fill="${p.ink}" fill-opacity="0.85"/>
      <rect x="266" y="708" width="268" height="66" rx="20" fill="${p.ink}" fill-opacity="0.7"/>
      ${[280, 320, 360, 400, 440, 480, 520].map(x => `<line x1="${x}" y1="786" x2="${x}" y2="812" stroke="${p.ink}" stroke-width="6" stroke-opacity="0.8"/>`).join('')}
      <rect x="238" y="560" width="324" height="66" rx="20" fill="none" stroke="${p.accent}" stroke-width="6"/>
      <line x1="200" y1="856" x2="600" y2="856" stroke="${p.ink}" stroke-width="3"/>`,
  'NOR-TERR': p => `
      ${[-46, -23, 0, 23, 46].map((a, i) => `<line x1="400" y1="756" x2="${400 + a * 2.1}" y2="${470 - Math.abs(a) * 0.6}" stroke="${p.ink}" stroke-width="7" stroke-linecap="round" stroke-opacity="${i === 2 ? 1 : 0.75}"/>`).join('')}
      <circle cx="400" cy="466" r="9" fill="${p.accent}"/>
      <path d="M 402 420 C 372 370 432 340 406 282" fill="none" stroke="${p.accent}" stroke-width="6" stroke-linecap="round" stroke-opacity="0.6"/>
      <ellipse cx="400" cy="770" rx="120" ry="26" fill="${p.ink}"/>
      <line x1="240" y1="846" x2="560" y2="846" stroke="${p.ink}" stroke-width="3"/>`,
  'LUM-LUMN': p => `
      <circle cx="400" cy="520" r="185" fill="${p.accent}" fill-opacity="0.16"/>
      <path d="M 262 560 A 138 138 0 0 1 538 560 Z" fill="${p.ink}"/>
      <rect x="386" y="560" width="28" height="182" fill="${p.ink}"/>
      <rect x="308" y="742" width="184" height="26" rx="13" fill="${p.ink}"/>
      <line x1="530" y1="556" x2="530" y2="636" stroke="${p.accent}" stroke-width="6"/>
      <circle cx="530" cy="648" r="12" fill="${p.accent}"/>
      <line x1="240" y1="830" x2="560" y2="830" stroke="${p.ink}" stroke-width="3"/>`,
  'LUM-CAND': p => `
      <rect x="296" y="540" width="208" height="250" rx="28" fill="${p.ink}"/>
      <line x1="316" y1="600" x2="484" y2="600" stroke="${p.paper}" stroke-opacity="0.3" stroke-width="6"/>
      <rect x="352" y="668" width="96" height="58" rx="8" fill="${p.paper}" fill-opacity="0.14"/>
      <circle cx="400" cy="700" r="10" fill="${p.accent}"/>
      <line x1="400" y1="516" x2="400" y2="538" stroke="${p.paper}" stroke-width="6"/>
      <path d="M 400 452 C 428 486 424 512 400 522 C 376 512 372 486 400 452 Z" fill="${p.accent}"/>
      <line x1="250" y1="850" x2="550" y2="850" stroke="${p.ink}" stroke-width="3"/>`,
  'LUM-CARA': p => `
      <path d="M 330 440 L 438 440 C 470 540 480 620 448 700 C 430 740 402 756 384 756 C 366 756 338 740 320 700 C 288 620 298 540 330 440 Z" fill="${p.ink}"/>
      <path d="M 356 440 L 412 440 L 404 404 L 364 404 Z" fill="${p.ink}" fill-opacity="0.8"/>
      <path d="M 330 560 L 438 560" stroke="${p.paper}" stroke-opacity="0.3" stroke-width="6"/>
      <path d="M 540 620 L 620 620 L 608 740 L 552 740 Z" fill="none" stroke="${p.ink}" stroke-width="11"/>
      <line x1="552" y1="668" x2="608" y2="668" stroke="${p.accent}" stroke-width="8" stroke-opacity="0.8"/>
      <line x1="250" y1="800" x2="650" y2="800" stroke="${p.ink}" stroke-width="3"/>`,

  /* ── CARRY ── */
  'FER-VOYA': p => `
      <rect x="272" y="430" width="256" height="340" rx="64" fill="${p.ink}"/>
      <path d="M 272 512 C 272 452 330 430 400 430 C 470 430 528 452 528 512 L 528 560 L 272 560 Z" fill="${p.ink}" fill-opacity="0.92"/>
      <rect x="380" y="546" width="40" height="52" rx="8" fill="${p.accent}"/>
      <rect x="320" y="640" width="160" height="110" rx="18" fill="none" stroke="${p.paper}" stroke-opacity="0.35" stroke-width="7"/>
      <path d="M 330 442 C 310 400 322 372 348 352" fill="none" stroke="${p.ink}" stroke-width="14" stroke-linecap="round"/>
      <path d="M 470 442 C 490 400 478 372 452 352" fill="none" stroke="${p.ink}" stroke-width="14" stroke-linecap="round"/>
      <line x1="220" y1="830" x2="580" y2="830" stroke="${p.ink}" stroke-width="3"/>`,
  'FER-CARD': p => `
      <rect x="308" y="500" width="130" height="86" rx="10" fill="${p.accent}"/>
      <rect x="262" y="556" width="276" height="160" rx="22" fill="${p.ink}"/>
      <line x1="262" y1="612" x2="538" y2="612" stroke="${p.paper}" stroke-opacity="0.3" stroke-width="5" stroke-dasharray="8 8"/>
      <rect x="292" y="648" width="90" height="30" rx="8" fill="${p.paper}" fill-opacity="0.2"/>
      <line x1="220" y1="800" x2="580" y2="800" stroke="${p.ink}" stroke-width="3"/>`,
  'FER-WEEK': p => `
      <rect x="180" y="550" width="440" height="190" rx="92" fill="${p.ink}"/>
      <line x1="220" y1="592" x2="580" y2="592" stroke="${p.paper}" stroke-opacity="0.35" stroke-width="6" stroke-dasharray="12 10"/>
      <path d="M 300 566 C 300 496 340 470 366 470" fill="none" stroke="${p.ink}" stroke-width="17" stroke-linecap="round"/>
      <path d="M 500 566 C 500 496 460 470 434 470" fill="none" stroke="${p.ink}" stroke-width="17" stroke-linecap="round"/>
      <rect x="466" y="640" width="70" height="44" rx="9" fill="${p.accent}"/>
      <line x1="160" y1="810" x2="640" y2="810" stroke="${p.ink}" stroke-width="3"/>`,
  'FER-PASS': p => `
      <rect x="272" y="510" width="256" height="190" rx="16" fill="${p.ink}"/>
      <circle cx="446" cy="606" r="46" fill="none" stroke="${p.accent}" stroke-width="8"/>
      <line x1="400" y1="606" x2="492" y2="606" stroke="${p.accent}" stroke-width="6"/>
      <ellipse cx="446" cy="606" rx="20" ry="46" fill="none" stroke="${p.accent}" stroke-width="5"/>
      <line x1="296" y1="556" x2="392" y2="556" stroke="${p.paper}" stroke-opacity="0.4" stroke-width="9" stroke-linecap="round"/>
      <line x1="296" y1="648" x2="368" y2="648" stroke="${p.paper}" stroke-opacity="0.4" stroke-width="9" stroke-linecap="round"/>
      <line x1="230" y1="790" x2="570" y2="790" stroke="${p.ink}" stroke-width="3"/>`,

  /* ── EVERYDAY CARRY / TESSA ── */
  'TES-ATLS': p => `
      <rect x="316" y="470" width="168" height="330" rx="46" fill="${p.ink}"/>
      <path d="M 336 470 C 344 424 372 408 384 404 L 384 380 L 416 380 L 416 404 C 428 408 456 424 464 470 Z" fill="${p.ink}"/>
      <rect x="368" y="338" width="64" height="46" rx="10" fill="${p.accent}"/>
      <line x1="352" y1="520" x2="352" y2="740" stroke="${p.paper}" stroke-opacity="0.28" stroke-width="12" stroke-linecap="round"/>
      <line x1="270" y1="850" x2="530" y2="850" stroke="${p.ink}" stroke-width="3"/>`,
  'TES-KEY': p => `
      <circle cx="400" cy="520" r="74" fill="none" stroke="${p.ink}" stroke-width="18"/>
      ${[[300, 640, -18], [400, 668, 0], [498, 638, 16]].map(([x, y, rot]) => `
        <g transform="rotate(${rot} ${x} ${y})">
          <circle cx="${x}" cy="${y - 26}" r="20" fill="none" stroke="${p.ink}" stroke-width="11"/>
          <rect x="${x - 7}" y="${y - 10}" width="14" height="96" rx="6" fill="${p.ink}"/>
          <rect x="${x + 7}" y="${y + 52}" width="26" height="12" rx="5" fill="${p.accent}"/>
        </g>`).join('')}
      <line x1="250" y1="830" x2="550" y2="830" stroke="${p.ink}" stroke-width="3"/>`,

  /* ── FITNESS ── */
  'KAN-BALN': p => `
      <rect x="240" y="560" width="320" height="160" rx="80" fill="${p.ink}"/>
      <circle cx="322" cy="640" r="44" fill="none" stroke="${p.paper}" stroke-opacity="0.45" stroke-width="10"/>
      <circle cx="322" cy="640" r="16" fill="${p.paper}" fill-opacity="0.45"/>
      <rect x="356" y="546" width="44" height="188" rx="10" fill="${p.accent}"/>
      <line x1="200" y1="810" x2="600" y2="810" stroke="${p.ink}" stroke-width="3"/>`,
  'LUM-TMPO': p => `
      <rect x="252" y="588" width="296" height="30" rx="15" fill="${p.ink}"/>
      <rect x="196" y="512" width="80" height="180" rx="18" fill="${p.ink}"/>
      <rect x="524" y="512" width="80" height="180" rx="18" fill="${p.ink}"/>
      <rect x="276" y="524" width="18" height="156" rx="9" fill="${p.accent}"/>
      <rect x="506" y="524" width="18" height="156" rx="9" fill="${p.accent}"/>
      <line x1="180" y1="780" x2="620" y2="780" stroke="${p.ink}" stroke-width="3"/>`,
  'LUM-ROPE': p => `
      <ellipse cx="400" cy="640" rx="185" ry="112" fill="none" stroke="${p.ink}" stroke-width="15"/>
      <ellipse cx="400" cy="640" rx="120" ry="64" fill="none" stroke="${p.ink}" stroke-width="12" stroke-opacity="0.55"/>
      <g transform="rotate(24 258 508)"><rect x="222" y="484" width="72" height="26" rx="13" fill="${p.accent}"/></g>
      <g transform="rotate(-24 542 508)"><rect x="506" y="484" width="72" height="26" rx="13" fill="${p.accent}"/></g>
      <line x1="220" y1="850" x2="580" y2="850" stroke="${p.ink}" stroke-width="3"/>`,
  'LUM-ROLL': p => `
      <rect x="252" y="530" width="296" height="210" rx="70" fill="${p.ink}"/>
      ${[300, 348, 396, 444, 492].map(x => `<line x1="${x}" y1="560" x2="${x - 18}" y2="710" stroke="${p.paper}" stroke-opacity="0.28" stroke-width="8" stroke-linecap="round"/>`).join('')}
      <ellipse cx="252" cy="635" rx="26" ry="70" fill="none" stroke="${p.paper}" stroke-opacity="0.35" stroke-width="8"/>
      <line x1="210" y1="830" x2="590" y2="830" stroke="${p.ink}" stroke-width="3"/>`,
};

/* Generic abstract compositions (fallback for SKUs without dedicated art). */
function compositions(rnd, p) {
  const { ink, accent } = p;
  return [
    () => `
      <circle cx="530" cy="360" r="230" fill="none" stroke="${accent}" stroke-width="34"/>
      <circle cx="530" cy="360" r="130" fill="none" stroke="${ink}" stroke-width="10"/>
      <circle cx="530" cy="360" r="46" fill="${ink}"/>
      <circle cx="235" cy="740" r="88" fill="${accent}"/>
      <line x1="110" y1="880" x2="690" y2="880" stroke="${ink}" stroke-width="3"/>`,
    () => `
      <path d="M 190 880 L 190 470 A 210 210 0 0 1 610 470 L 610 880" fill="none" stroke="${ink}" stroke-width="38"/>
      <circle cx="400" cy="330" r="92" fill="${accent}"/>
      <line x1="120" y1="880" x2="680" y2="880" stroke="${ink}" stroke-width="4"/>
      <circle cx="640" cy="180" r="${14 + rnd() * 10}" fill="${ink}"/>`,
    () => {
      const widths = [420, 300, 500, 220, 380].sort(() => rnd() - 0.5);
      return widths.map((w, i) =>
        `<rect x="${590 - w}" y="${260 + i * 108}" width="${w}" height="66" fill="${i % 2 ? accent : ink}"/>`
      ).join('') + `<line x1="120" y1="850" x2="680" y2="850" stroke="${ink}" stroke-width="3"/>`;
    },
    () => `
      <circle cx="440" cy="440" r="185" fill="${accent}"/>
      <ellipse cx="440" cy="440" rx="300" ry="105" fill="none" stroke="${ink}" stroke-width="12" transform="rotate(-18 440 440)"/>
      <circle cx="700" cy="350" r="26" fill="${ink}"/>
      <line x1="140" y1="800" x2="620" y2="800" stroke="${ink}" stroke-width="3"/>`,
    () => `
      <path d="M 90 90 L 710 90 L 90 780 Z" fill="${ink}"/>
      <circle cx="520" cy="620" r="${100 + rnd() * 30}" fill="${accent}"/>
      <line x1="240" y1="880" x2="700" y2="880" stroke="${ink}" stroke-width="3"/>`,
    () => {
      let out = '';
      const gx = 150, gy = 230, step = 118;
      const ringI = 6 + Math.floor(rnd() * 6);
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 4; c++) {
          const idx = r * 4 + c;
          out += idx === ringI
            ? `<circle cx="${gx + c * step}" cy="${gy + r * step}" r="30" fill="none" stroke="${accent}" stroke-width="14"/>`
            : `<circle cx="${gx + c * step}" cy="${gy + r * step}" r="12" fill="${ink}"/>`;
        }
      }
      return out + `<line x1="150" y1="850" x2="640" y2="850" stroke="${ink}" stroke-width="3"/>`;
    },
  ];
}

/** SVG string for a product card (800x1000, editorial duotone print). */
function makeProductSvg(name, baseSku, catKey) {
  const p = PALETTES[catKey] || DEFAULT_PALETTE;
  const seed = hashSeed(baseSku || name);
  const rnd = mulberry32(seed);
  const art = PRODUCT_ART[baseSku];
  const draw = art
    ? () => art(p, rnd)
    : compositions(rnd, p)[seed % 6];
  const letter = esc((name || 'M').trim().charAt(0).toUpperCase());
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
  <defs>${GRAIN}</defs>
  <rect width="800" height="1000" fill="${p.paper}"/>
  <rect x="60" y="60" width="680" height="880" fill="none" stroke="${p.ink}" stroke-opacity="0.28" stroke-width="2"/>
  <text x="96" y="300" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="420" fill="${p.ink}" fill-opacity="0.07">${letter}</text>
  ${draw()}
  <text x="98" y="902" font-family="Georgia, serif" font-size="26" letter-spacing="6" fill="${p.ink}" fill-opacity="0.65">${esc(baseSku || '')}</text>
  <rect width="800" height="1000" filter="url(#grain)"/>
</svg>`;
}

/** SVG string for a category tile (1200x700). */
function makeCategorySvg(name) {
  const keys = Object.keys(PALETTES);
  const p = PALETTES[keys[hashSeed(name) % keys.length]];
  const rnd = mulberry32(hashSeed(name));
  const draw = compositions(rnd, p)[(hashSeed(name) >>> 3) % 6];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700">
  <defs>${GRAIN}</defs>
  <rect width="1200" height="700" fill="${p.paper}"/>
  <g transform="translate(240 -60) scale(1.15)">${draw()}</g>
  <rect width="1200" height="700" filter="url(#grain)"/>
</svg>`;
}

module.exports = { makeProductSvg, makeCategorySvg };
