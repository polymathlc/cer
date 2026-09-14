// The explorer keeps the original paper-doll landmarks used by every item.
// Each fragment owns its definitions so avatars can also render outside the portal.
(function (root) {
  'use strict';
  var sequence = 0;
  var ink = '#182638';
  function paint(part, colors) {
    var prefix = 'rpg-hero-' + part + '-' + (++sequence) + '-';
    var defs = '<defs>', fills = {};
    Object.keys(colors).forEach(function (key) {
      var id = prefix + key, stops = colors[key];
      fills[key] = 'url(#' + id + ')';
      defs += '<linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' + stops.map(function (color, i) {
        return '<stop offset="' + (i / (stops.length - 1) * 100) + '%" stop-color="' + color + '"/>';
      }).join('') + '</linearGradient>';
    });
    return { defs: defs + '</defs>', fill: fills };
  }
  function lower() {
    var p = paint('lower', {
      cloth: ['#527184', '#263e55', '#142538'],
      coat: ['#385a70', '#172d44', '#101e33'],
      leather: ['#83624c', '#493c35', '#282831'],
      boot: ['#3c4654', '#202a37', '#121b29'],
      gold: ['#fff0b0', '#dcb86c', '#92733e'],
      gem: ['#b3fff0', '#3bd2c4', '#197c94']
    }), f = p.fill;
    return p.defs + `<g data-hero-part="lower" stroke="${ink}" stroke-linejoin="round" stroke-linecap="round">
      <path d="M84 151 L97 153 L96 187 Q91 193 83 188 Z" fill="${f.cloth}" stroke-width="1.6"/>
      <path d="M103 153 L116 151 L117 188 Q109 193 104 187 Z" fill="${f.cloth}" stroke-width="1.6"/>
      <path d="M87 162 L88 181 M113 162 L112 181" fill="none" stroke="#7296a1" stroke-width="1.1" opacity=".65"/>
      <path d="M83 169 L96 169 L96 180 L84 182 Z M104 169 L117 169 L116 182 L104 180 Z" fill="${f.leather}" stroke-width="1.1"/>
      <path d="M86 171 L93 171 L93 177 L87 179 Z M107 171 L114 171 L113 179 L107 177 Z" fill="${f.cloth}" stroke="#ae986c" stroke-width=".8"/>
      <path d="M88 173 L92 173 M108 173 L112 173" stroke="#93c3c3" stroke-width=".9"/>
      <path d="M82 181 L97 180 L98 198 Q101 201 99 210 Q97 215 81 213 Q77 212 78 207 L81 200 Z" fill="${f.boot}" stroke-width="1.8"/>
      <path d="M103 180 L118 181 L119 200 L122 207 Q123 212 119 213 Q103 215 101 210 Q99 201 102 198 Z" fill="${f.boot}" stroke-width="1.8"/>
      <path d="M79 207 Q89 210 99 206 L99 211 Q91 215 80 212 Z M101 206 Q111 210 121 207 L120 212 Q109 215 101 211 Z" fill="#101b28" stroke-width="1.2"/>
      <path d="M82 201 Q88 197 95 201 M105 201 Q112 197 118 201" fill="none" stroke="#7c8b99" stroke-width="1.2" opacity=".7"/>
      <path d="M81 184 Q89 187 98 183 L98 190 Q89 194 81 190 Z M102 183 Q111 187 119 184 L119 190 Q111 194 102 190 Z" fill="${f.leather}" stroke-width="1.2"/>
      <rect x="85" y="185" width="7" height="6" rx="1" fill="${f.gold}" stroke-width=".9"/>
      <rect x="108" y="185" width="7" height="6" rx="1" fill="${f.gold}" stroke-width=".9"/>
      <path d="M87 187 H90 V189 H87 Z M110 187 H113 V189 H110 Z" fill="#354152" stroke="none"/>
      <path d="M88 193 L94 195 M88 196 L94 193 M106 193 L112 196 M106 195 L112 193" fill="none" stroke="#b49a73" stroke-width=".9"/>
      <path d="M81 210 Q89 212 96 210 M104 210 Q112 212 119 210" fill="none" stroke="#bd9d62" stroke-width=".8" stroke-dasharray="1.5 2"/>
      <path d="M81 115 Q100 107 119 115 L122 141 L120 157 L121 165 L109 170 L100 162 L91 170 L79 165 L80 157 L78 141 Z" fill="${f.coat}" stroke-width="1.8"/>
      <path d="M86 118 L98 115 L98 161 L90 166 L85 160 Z M102 115 L114 118 L115 160 L110 166 L102 161 Z" fill="${f.cloth}" stroke-width=".8"/>
      <path d="M100 118 V160 M82 156 L84 163 L90 165 M118 156 L116 163 L110 165" fill="none" stroke="#c6a967" stroke-width="1.1"/>
      <path d="M83 127 L87 153 M117 127 L113 153 M88 162 L92 160 M112 162 L108 160" fill="none" stroke="#81a5a9" stroke-width=".75" stroke-dasharray="1 2.2"/>
      <path d="M83 116 L111 153 L117 150 L90 113 Z" fill="${f.leather}" stroke-width="1"/>
      <path d="M87 118 L113 151" stroke="#c4ab7c" fill="none" stroke-width=".7" stroke-dasharray="1.3 2"/>
      <path d="M108 138 L114 134 L119 141 L113 145 Z" fill="${f.gold}" stroke-width="1"/>
      <path d="M110 138 L113 136 L116 140 L113 142 Z" fill="#384859" stroke="none"/>
      <path d="M79 149 Q100 156 121 149 L120 156 Q100 163 80 156 Z" fill="${f.leather}" stroke-width="1.3"/>
      <path d="M81 151 Q100 157 119 151" fill="none" stroke="#b7a070" stroke-width=".8" stroke-dasharray="1.2 2"/>
      <rect x="94" y="151" width="12" height="9" rx="2" fill="${f.gold}" stroke-width="1.2"/>
      <rect x="97" y="153" width="6" height="5" rx=".8" fill="#263b4b" stroke="none"/>
      <path d="M98 155.5 H105" stroke="#ffe4a0" stroke-width="1.3"/>
      <path d="M111 155 L118 154 L119 162 Q115 165 111 162 Z" fill="${f.leather}" stroke-width="1"/>
      <path d="M112 156 L117 156 L117 159 L112 160 Z" fill="#a18458" stroke-width=".6"/>
      <circle cx="115" cy="158" r=".9" fill="#ffe5a1" stroke="none"/>
      <path d="M89 112 L100 119 L111 112 L109 124 L100 121 L91 124 Z" fill="${f.coat}" stroke-width="1.1"/>
      <path d="M91 115 L100 120 L109 115" fill="none" stroke="#d5b76e" stroke-width="1.2"/>
      <path d="M100 117 L103 121 L100 126 L97 121 Z" fill="${f.gem}" stroke="#e4c780" stroke-width="1"/>
      <path d="M100 119 L101 121 L100 123 L99 121 Z" fill="#dffff7" stroke="none"/>
    </g>`;
  }
  function hand(cx, cy, skin, shadow) {
    return `<g transform="translate(${cx},${cy})">
      <circle cx="0" cy="0" r="8" fill="${skin}" stroke="${ink}" stroke-width="1.5"/>
      <path d="M-6 0 Q-6 6 -1 7 Q5 8 7 3 Q4 5 2 3 Q-1 6 -4 2 Z" fill="${shadow}" opacity=".46"/>
      <path d="M-3 1 Q-1 -1 1 1 M1 2 Q3 0 5 2 M-4 4 Q0 6 4 4" fill="none" stroke="#b77e60" stroke-width=".9" stroke-linecap="round"/>
      <path d="M-5 -2 Q-3 -6 1 -5" fill="none" stroke="#fff0d7" stroke-width="1.3" stroke-linecap="round" opacity=".85"/>
    </g>`;
  }
  function arms() {
    var p = paint('arms', {
      sleeve: ['#54778a', '#263f57', '#14263b'],
      leather: ['#9b7857', '#534332', '#34353d'],
      gold: ['#ffedac', '#d3ad60', '#856c41'],
      skin: ['#ffefd4', '#f9cca6', '#d79873']
    }), f = p.fill;
    return p.defs + `<g data-hero-part="arms" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round">
      <path d="M81 117 Q70 120 67 130 L57 148 L64 153 Q73 138 86 127 Z" fill="${f.sleeve}" stroke-width="1.7"/>
      <path d="M119 117 Q130 120 133 130 L143 148 L136 153 Q127 138 114 127 Z" fill="${f.sleeve}" stroke-width="1.7"/>
      <path d="M79 119 Q72 122 71 129 M121 119 Q128 122 129 129" fill="none" stroke="#96b9c0" stroke-width="1.3" opacity=".8"/>
      <path d="M68 130 L73 134 L68 139 L63 136 Z M132 130 L127 134 L132 139 L137 136 Z" fill="#182e43" stroke="#849a97" stroke-width=".8"/>
      <path d="M71 124 L80 126 M120 126 L129 124" stroke="#d5b879" stroke-width="1.4"/>
      <path d="M67 133 L61 144 M133 133 L139 144" fill="none" stroke="#a9b797" stroke-width=".7" stroke-dasharray="1 2"/>
      <path d="M62 139 L70 144 L65 154 L55 149 Z M138 139 L130 144 L135 154 L145 149 Z" fill="${f.leather}" stroke-width="1.1"/>
      <path d="M60 144 L67 148 M133 148 L140 144" stroke="#d9be82" stroke-width="1.2"/>
      <path d="M58 147 L65 151 M135 151 L142 147" stroke="#c1a16a" stroke-width=".8"/>
      <path d="M63 142 L66 144 L64 147 L61 145 Z M137 142 L139 145 L136 147 L134 144 Z" fill="${f.gold}" stroke-width=".7"/>
      ${hand(58, 158, f.skin, '#d79b7a')}
      ${hand(142, 158, f.skin, '#d79b7a')}
    </g>`;
  }
  function grip() {
    var p = paint('grip', { skin: ['#ffefd4', '#f9cca6', '#d79873'] });
    return p.defs + '<g data-hero-part="grip">' + hand(0, 0, p.fill.skin, '#d79b7a') + '</g>';
  }
  function head(gender) {
    var female = gender === 'female';
    var p = paint('head', {
      skin: ['#fff0d6', '#fbd6b1', '#e8a582'],
      neck: ['#edb894', '#ce8c68'],
      hair: ['#b6804f', '#70472f', '#362735'],
      hairDark: ['#76503b', '#44303a', '#242538'],
      iris: ['#73b9b8', '#376777', '#163446'],
      gold: ['#ffe9a1', '#cdaa62', '#8b693c']
    }), f = p.fill;
    var back = female ? `
      <path d="M127 62 Q145 63 149 78 Q154 94 147 108 Q144 116 137 122 Q141 108 135 101 Q126 89 127 62 Z" fill="${f.hairDark}" stroke-width="1.5"/>
      <path d="M138 76 Q148 88 141 103 M143 90 Q149 103 140 115" fill="none" stroke="#b17b4a" stroke-width="1.5" opacity=".75"/>
      <path d="M64 69 Q59 90 65 107 L72 113 Q67 96 74 80 Z M135 68 Q141 92 134 109 L128 114 Q133 95 126 80 Z" fill="${f.hairDark}" stroke-width="1.3"/>
      <path d="M135 70 L142 76 L140 81 L132 75 Z" fill="${f.gold}" stroke-width="1"/>
      <path d="M137 73 L139 77" stroke="#fff3bf" stroke-width="1.2"/>` : `
      <path d="M65 63 Q58 72 64 86 L71 89 L72 62 Z M130 62 L129 88 L136 84 Q143 70 135 61 Z" fill="${f.hairDark}" stroke-width="1.4"/>`;
    var fringe = female ? `
      <path d="M64 80 Q57 57 72 45 Q88 32 106 37 Q127 35 136 54 Q140 65 136 81 L130 70 Q126 63 126 55 Q116 70 102 72 L108 64 Q93 72 82 64 L74 57 Q70 68 69 78 Z" fill="${f.hair}" stroke-width="1.7"/>
      <path d="M69 58 Q77 42 97 41 M79 55 Q91 43 105 44 M94 59 Q112 54 122 44 M110 61 Q120 56 126 49 M130 55 Q135 65 133 70" fill="none" stroke="#d4a267" stroke-width="1.5" opacity=".72"/>
      <path d="M82 49 Q96 38 110 41 M75 58 Q79 63 85 64 M112 40 Q125 43 128 54" fill="none" stroke="#573d31" stroke-width="1.15" opacity=".7"/>` : `
      <path d="M64 80 Q59 65 63 56 L59 53 L69 49 L68 43 L80 43 Q94 31 111 37 L124 36 L123 42 Q142 48 139 69 L134 80 L128 66 L128 56 Q115 68 99 69 L105 61 Q91 69 79 62 L71 58 L69 78 Z" fill="${f.hair}" stroke-width="1.7"/>
      <path d="M70 53 Q82 43 100 41 M79 54 Q96 43 113 42 M92 59 Q110 54 122 45 M111 59 Q122 55 129 50 M132 56 Q136 63 134 70" fill="none" stroke="#d0a065" stroke-width="1.6" opacity=".72"/>
      <path d="M78 48 Q91 36 107 39 M92 65 Q106 62 113 54 M120 42 Q131 45 134 53" fill="none" stroke="#553a32" stroke-width="1.15" opacity=".7"/>`;
    return p.defs + `<g data-hero-part="head" data-gender="${female ? 'female' : 'male'}" stroke="${ink}" stroke-linejoin="round" stroke-linecap="round">
      <rect x="92" y="100" width="16" height="19" rx="7" fill="${f.neck}" stroke-width="1.2"/>
      <path d="M94 110 Q100 114 106 110" fill="none" stroke="#ac745d" stroke-width="1" opacity=".65"/>
      ${back}
      <ellipse cx="66" cy="88" rx="6" ry="7.5" fill="${f.skin}" stroke-width="1.5"/>
      <ellipse cx="134" cy="88" rx="6" ry="7.5" fill="${f.skin}" stroke-width="1.5"/>
      <path d="M64 85 Q69 84 68 90 M136 85 Q131 84 132 90" fill="none" stroke="#c98b71" stroke-width="1.2"/>
      <circle cx="100" cy="78" r="34" fill="${f.skin}" stroke-width="1.8"/>
      <path d="M69 84 Q72 105 91 110 Q115 117 129 97 Q117 107 99 106 Q79 104 69 84 Z" fill="#dc9d7c" opacity=".23" stroke="none"/>
      <path d="M74 79 Q76 70 85 68" fill="none" stroke="#fff0d5" stroke-width="3" opacity=".55"/>
      <ellipse cx="79" cy="94" rx="6.3" ry="3.1" fill="#e69782" stroke="none" opacity=".38"/>
      <ellipse cx="121" cy="94" rx="6.3" ry="3.1" fill="#e69782" stroke="none" opacity=".38"/>
      <path d="M80 75 Q86 71 92 74 M108 74 Q114 71 120 75" fill="none" stroke="#704a36" stroke-width="${female ? '1.6' : '2'}"/>
      <path d="M80 84 Q83 77 88 78 Q94 79 95 85 Q89 92 82 87 Z M105 85 Q106 79 112 78 Q117 77 120 84 L118 87 Q111 92 105 85 Z" fill="#fff8e8" stroke="#704b3d" stroke-width="1.25"/>
      <ellipse cx="88" cy="84" rx="4.6" ry="5.4" fill="${f.iris}" stroke="none"/>
      <ellipse cx="112" cy="84" rx="4.6" ry="5.4" fill="${f.iris}" stroke="none"/>
      <ellipse cx="88" cy="84" rx="2.5" ry="3.5" fill="#182733" stroke="none"/>
      <ellipse cx="112" cy="84" rx="2.5" ry="3.5" fill="#182733" stroke="none"/>
      <circle cx="86.5" cy="81.6" r="1.7" fill="#fff" stroke="none"/>
      <circle cx="110.5" cy="81.6" r="1.7" fill="#fff" stroke="none"/>
      <circle cx="89.5" cy="86.7" r=".8" fill="#abebe4" stroke="none"/>
      <circle cx="113.5" cy="86.7" r=".8" fill="#abebe4" stroke="none"/>
      <path d="M80 83 Q85 76 92 80 M108 80 Q115 76 120 83" fill="none" stroke="#3e302e" stroke-width="1.6"/>
      ${female ? '<path d="M81 81 L78 79 M119 81 L122 79" fill="none" stroke="#3e302e" stroke-width="1.3"/>' : ''}
      <path d="M99 87 L97 92 Q100 94 103 92" fill="none" stroke="#bf846a" stroke-width="1.15"/>
      <path d="M99 88 L99 90" stroke="#fff0d8" stroke-width="1.4"/>
      <path d="M92 97 Q100 101 108 96 Q105 104 99 103 Q95 102 92 97 Z" fill="#aa675e" stroke="#805549" stroke-width=".85"/>
      <path d="M94 98 Q100 100 106 97 L105 99 Q100 101 95 99 Z" fill="#fff0de" stroke="none"/>
      <path d="M97 105 Q101 107 105 104" fill="none" stroke="#fff0d3" stroke-width="1.3" opacity=".8"/>
      ${fringe}
    </g>`;
  }
  root.RpgHeroSvg = Object.freeze({ lower: lower, arms: arms, head: head, grip: grip });
})(globalThis);
