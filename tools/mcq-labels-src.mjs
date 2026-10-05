// 🔤 The MCQ LABELS helpers, cut out of app.js for the harnesses that rebuild
// sections of it in a sandbox. Any harness whose code under test now draws an
// option label (a prompt, a renderer, a game row) needs them, and pasting the
// block into each harness by hand is how one of them drifts.
//   norm:    include `_normMcqChoice` (leave it out when the harness stubs it)
//   display: include `_mcqLab` / `_mcqLabOf` (the marking store's display labels)
export function mcqLabelSrc(src, { norm = true, display = true } = {}) {
  const cut = (from, to) => {
    const a = src.indexOf(from);
    if (a < 0) throw new Error('mcq labels: "' + from + '" not found in app.js');
    const b = src.indexOf(to, a + from.length);
    if (b < 0) throw new Error('mcq labels: end marker not found after "' + from + '"');
    return src.slice(a, b);
  };
  let out = norm
    ? cut('function _normMcqChoice(raw) {', '\nfunction normalizeCategoryValue')
    : cut('const MCQ_LABEL_STYLES', '\nfunction normalizeCategoryValue');
  if (display) out += '\n' + cut('function _mcqLab(o)', '/* "2) A is smaller"');
  return '\n' + out + '\n';
}
