// Test stub for student/access-gate.js (tools/mindmap-browser.mjs): an approved P4 Science student, or staff.
window.PolymathAccess = { version: 'stub', state: { phase: window.__asStaff ? 'staff' : 'approved', pairs: [{ level: 'P4', subjects: ['science'] }], isAdmin: !!window.__asStaff }, onChange(fn) { fn(this.state); return () => {}; } };
