// Portrait badges for the family quest board. Caius uses the shared Gas Knight
// artwork and Caris grows an illustrated fox tail every two levels.
import { arcadeAssetPath } from './cc-arcade-core.mjs?v=1.1.1';

const esc = s => String(s).replace(/[^\w-]/g, '');
const label = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function caiusAvatar({ uid = 'c', level = 1, animate = true, title = 'Caius in his transformed Gas Knight form' } = {}) {
  const u = 'cg' + esc(uid);
  const count = Math.min(10, 4 + Math.floor(Math.max(1, Number(level) || 1) / 2));
  const puffs = Array.from({ length: count }, (_, i) => {
    const x = 48 + (i * 47) % 109;
    const y = 165 - (i * 17) % 52;
    const delay = animate ? ` style="animation-delay:-${(i * 0.7).toFixed(1)}s"` : '';
    return `<circle class="${u}-wisp" cx="${x}" cy="${y}" r="${6 + (i % 3) * 3}" fill="url(#${u}-puff)"${delay}/>`;
  }).join('');
  const motion = animate ? `<style>
    @media (prefers-reduced-motion: no-preference) {
      .${u}-wisp { animation: ${u}-rise 6s ease-out infinite; }
      @keyframes ${u}-rise {
        0% { opacity: 0; transform: translateY(12px); }
        40% { opacity: .75; }
        100% { opacity: 0; transform: translateY(-70px); }
      }
    }
  </style>` : '';
  return `<svg class="avatar-svg" viewBox="0 0 200 200" role="img" aria-label="${label(title)}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="${u}-bg" cx="50%" cy="42%" r="65%">
        <stop stop-color="#593691"/><stop offset=".62" stop-color="#281846"/><stop offset="1" stop-color="#0f0a1f"/>
      </radialGradient>
      <radialGradient id="${u}-puff">
        <stop stop-color="#d7b6ff"/><stop offset="1" stop-color="#ab80f9" stop-opacity="0"/>
      </radialGradient>
      <clipPath id="${u}-clip"><circle cx="100" cy="100" r="98"/></clipPath>
    </defs>
    ${motion}
    <g clip-path="url(#${u}-clip)">
      <circle cx="100" cy="100" r="98" fill="url(#${u}-bg)"/>
      ${puffs}
      <image x="4" y="3" width="192" height="192" href="${arcadeAssetPath('caius-form.webp')}" preserveAspectRatio="xMidYMid meet"/>
    </g>
    <circle cx="100" cy="100" r="97" fill="none" stroke="#a78bfa" stroke-width="3" opacity=".8"/>
  </svg>`;
}

/* ======================================================================== */
/*                                  CARIS                                   */
/* ======================================================================== */
function foxTail(u, angle, i, animate) {
  // One fluffy tail pointing up from the pivot (100,150), rotated by `angle`.
  const sway = animate
    ? `<animateTransform attributeName="transform" type="rotate" values="${angle - 4} 100 150; ${angle + 4} 100 150; ${angle - 4} 100 150" dur="${3 + (i % 3) * 0.6}s" begin="${(i * 0.25).toFixed(2)}s" repeatCount="indefinite"/>`
    : '';
  return `<g transform="rotate(${angle} 100 150)">${sway}
      <path d="M100 150 C 86 120, 84 86, 96 54 C 100 44, 106 44, 108 54 C 118 86, 114 120, 100 150 Z" fill="url(#${u}-tail)" stroke="#bfdbfe" stroke-width="1.2"/>
      <path d="M96 60 C 98 40, 108 34, 104 22 C 114 32, 114 46, 108 56 Z" fill="url(#${u}-flame)" filter="url(#${u}-glow)" opacity="0.95"/>
    </g>`;
}

export function carisAvatar({ uid = 'k', level = 1, tails, animate = true, title = 'Caris, the Kitsune user' } = {}) {
  const u = 'kf' + esc(uid);
  const n = Math.max(1, Math.min(9, tails || Math.ceil(Math.max(1, level) / 2)));
  // Fan the tails out behind her, wider as she grows more of them.
  const spread = n === 1 ? 0 : Math.min(150, 26 * (n - 1));
  let tailsSvg = '';
  for (let i = 0; i < n; i++) {
    const angle = n === 1 ? 35 : -spread / 2 + (spread * i) / (n - 1);
    tailsSvg += foxTail(u, angle, i, animate);
  }
  const bob = (dur, dy = -5) => animate
    ? `<animateTransform attributeName="transform" type="translate" values="0 0; 0 ${dy}; 0 0" dur="${dur}s" repeatCount="indefinite"/>` : '';
  // Fox-fire wisps (kitsunebi) circling her.
  const wisps = [[34, 70, 0], [166, 64, 0.8], [26, 140, 1.6], [174, 132, 2.4], [100, 26, 1.2]].map(([x, y, b], i) => `
    <g filter="url(#${u}-glow)">
      <path d="M${x} ${y + 9} c -7 0, -9 -8, -4 -13 c 0 4, 3 5, 4 3 c -1 -5, 2 -9, 5 -11 c 0 5, 6 7, 5 13 c -1 5, -5 8, -10 8 z" fill="url(#${u}-flame)">${animate
        ? `<animateTransform attributeName="transform" type="translate" values="0 0; ${i % 2 ? 3 : -3} -7; 0 0" dur="${2.6 + i * 0.3}s" begin="${b}s" repeatCount="indefinite"/>
           <animate attributeName="opacity" values="0.55;1;0.55" dur="${1.8 + i * 0.2}s" begin="${b}s" repeatCount="indefinite"/>` : ''}</path>
    </g>`).join('');
  return `<svg class="avatar-svg" viewBox="0 0 200 200" role="img" aria-label="${title}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="${u}-bg" cx="50%" cy="40%" r="70%">
      <stop offset="0%" stop-color="#1d4ed8"/>
      <stop offset="55%" stop-color="#172554"/>
      <stop offset="100%" stop-color="#020617"/>
    </radialGradient>
    <linearGradient id="${u}-tail" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="55%" stop-color="#e0f2fe"/>
      <stop offset="100%" stop-color="#7dd3fc"/>
    </linearGradient>
    <linearGradient id="${u}-flame" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#1d4ed8"/>
      <stop offset="45%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#e0f2fe"/>
    </linearGradient>
    <linearGradient id="${u}-hair" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f1f5f9"/>
      <stop offset="100%" stop-color="#bae6fd"/>
    </linearGradient>
    <linearGradient id="${u}-robe" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e40af"/>
      <stop offset="100%" stop-color="#172554"/>
    </linearGradient>
    <radialGradient id="${u}-skin" cx="45%" cy="40%" r="65%">
      <stop offset="0%" stop-color="#fff1e6"/>
      <stop offset="100%" stop-color="#f6cfb4"/>
    </radialGradient>
    <filter id="${u}-glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="${u}-clip"><circle cx="100" cy="100" r="98"/></clipPath>
  </defs>
  <g clip-path="url(#${u}-clip)">
    <rect width="200" height="200" fill="url(#${u}-bg)"/>
    <!-- a pale moon and stars -->
    <circle cx="150" cy="44" r="18" fill="#e0f2fe" opacity="0.18"/>
    <g fill="#e0f2fe" opacity="0.7">
      <circle cx="30" cy="30" r="1.2"/><circle cx="60" cy="18" r="0.9"/><circle cx="178" cy="90" r="1.1"/><circle cx="20" cy="104" r="0.8"/><circle cx="128" cy="16" r="1"/>
    </g>
    ${wisps}
    <!-- the tails, behind her -->
    <g>${bob(5, -3)}${tailsSvg}</g>
    <g>${bob(4.2)}
      <!-- robe with a wave pattern -->
      <path d="M64 196 C 64 158, 72 134, 100 130 C 128 134, 136 158, 136 196 Z" fill="url(#${u}-robe)"/>
      <path d="M84 132 L 100 160 L 116 132" fill="#f8fafc"/>
      <path d="M90 134 L 100 152 L 110 134" fill="#38bdf8"/>
      <path d="M70 176 q 8 -8 16 0 q 8 -8 16 0 q 8 -8 16 0 q 8 -8 16 0" fill="none" stroke="#7dd3fc" stroke-width="2" opacity="0.6"/>
      <rect x="76" y="158" width="48" height="7" rx="3" fill="#f472b6"/>
      <!-- head -->
      <ellipse cx="100" cy="94" rx="33" ry="32" fill="url(#${u}-skin)"/>
      <!-- fox ears -->
      <path d="M70 76 L 64 36 L 92 64 Z" fill="url(#${u}-hair)" stroke="#bfdbfe" stroke-width="1.5"/>
      <path d="M72 70 L 68 46 L 86 63 Z" fill="#f9a8d4"/>
      <path d="M130 76 L 136 36 L 108 64 Z" fill="url(#${u}-hair)" stroke="#bfdbfe" stroke-width="1.5"/>
      <path d="M128 70 L 132 46 L 114 63 Z" fill="#f9a8d4"/>
      <!-- hair: fringe and long sides -->
      <path d="M66 98 C 60 64, 84 56, 100 58 C 118 56, 142 64, 134 98 C 128 84, 122 78, 116 76 C 114 84, 106 84, 104 76 C 100 84, 92 84, 90 76 C 82 78, 72 84, 66 98 Z" fill="url(#${u}-hair)"/>
      <path d="M66 96 C 60 116, 62 136, 70 150 L 76 148 C 70 132, 70 116, 72 100 Z" fill="url(#${u}-hair)"/>
      <path d="M134 96 C 140 116, 138 136, 130 150 L 124 148 C 130 132, 130 116, 128 100 Z" fill="url(#${u}-hair)"/>
      <!-- fox mask on the side of her head -->
      <g transform="rotate(-18 136 72)">
        <path d="M124 64 L 128 52 L 134 62 L 142 62 L 148 52 L 150 66 C 152 80, 144 88, 137 88 C 130 88, 122 80, 124 64 Z" fill="#f8fafc" stroke="#93c5fd" stroke-width="1.2"/>
        <path d="M128 68 q 4 -3 7 0 M139 68 q 4 -3 7 0" stroke="#dc2626" stroke-width="1.6" fill="none" stroke-linecap="round"/>
        <path d="M134 78 q 3 3 6 0" stroke="#dc2626" stroke-width="1.4" fill="none" stroke-linecap="round"/>
        <circle cx="137" cy="74" r="1.6" fill="#1e3a8a"/>
      </g>
      <!-- eyes: big, with blue fox-fire irises -->
      <g>
        <ellipse cx="87" cy="98" rx="7" ry="8" fill="#fff"/>
        <ellipse cx="113" cy="98" rx="7" ry="8" fill="#fff"/>
        <ellipse cx="87.5" cy="99" rx="5" ry="6" fill="#2563eb"/>
        <ellipse cx="113.5" cy="99" rx="5" ry="6" fill="#2563eb"/>
        <ellipse cx="87.5" cy="100" rx="2.2" ry="3.4" fill="#0f172a"/>
        <ellipse cx="113.5" cy="100" rx="2.2" ry="3.4" fill="#0f172a"/>
        <circle cx="85.5" cy="96" r="1.8" fill="#fff"/><circle cx="111.5" cy="96" r="1.8" fill="#fff"/>
        <path d="M79 90 q 8 -5 15 -1 M106 89 q 7 -4 15 1" stroke="#64748b" stroke-width="2" fill="none" stroke-linecap="round"/>
      </g>
      <!-- whisker marks, nose and smile -->
      <path d="M72 106 l 8 1 M72 111 l 8 -1 M128 106 l -8 1 M128 111 l -8 -1" stroke="#f472b6" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/>
      <path d="M98 106 l 2 2 l 2 -2" fill="none" stroke="#be185d" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M93 112 q 7 6 14 0" fill="none" stroke="#be185d" stroke-width="2" stroke-linecap="round"/>
      <ellipse cx="79" cy="110" rx="5" ry="3" fill="#fb7185" opacity="0.35"/>
      <ellipse cx="121" cy="110" rx="5" ry="3" fill="#fb7185" opacity="0.35"/>
      <!-- a fox-fire flame floating over her palm -->
      <path d="M46 150 C 54 146, 62 146, 70 140" stroke="url(#${u}-robe)" stroke-width="11" stroke-linecap="round" fill="none"/>
      <circle cx="46" cy="150" r="6" fill="url(#${u}-skin)"/>
      <g filter="url(#${u}-glow)">
        <path d="M46 142 c -9 0, -12 -10, -5 -17 c 0 5, 4 7, 5 4 c -1 -7, 3 -12, 7 -14 c 0 7, 8 9, 6 17 c -1 6, -6 10, -13 10 z" fill="url(#${u}-flame)">${animate
          ? '<animate attributeName="opacity" values="0.75;1;0.75" dur="1.4s" repeatCount="indefinite"/>' : ''}</path>
      </g>
    </g>
  </g>
  <circle cx="100" cy="100" r="97" fill="none" stroke="#7dd3fc" stroke-width="3" opacity="0.85"/>
</svg>`;
}

export function avatarFor(kid, opts = {}) {
  return kid === 'caris' ? carisAvatar(opts) : caiusAvatar(opts);
}

// A small Robux-style coin (original: a hexagon with "R$"), for amounts.
// Its gradient #coin-g lives once in the page (see COIN_DEFS).
export function coinSvg(size = 18) {
  return `<svg class="coin" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 1.5 L21.1 6.75 V17.25 L12 22.5 L2.9 17.25 V6.75 Z" fill="url(#coin-g)" stroke="#b45309" stroke-width="1.2"/>
    <path d="M12 5 L17.9 8.4 V15.6 L12 19 L6.1 15.6 V8.4 Z" fill="none" stroke="#fff7ed" stroke-width="1" opacity="0.7"/>
    <text x="12" y="15.3" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="8" fill="#78350f">R$</text>
  </svg>`;
}

// The coin's gradient, placed once at the top of the page.
export const COIN_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <defs><linearGradient id="coin-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs>
</svg>`;
