// Test stub for student/access-gate.js (tools/homework-browser.mjs): an approved student, or staff.
window.PolymathAccess = { version: 'stub', state: { phase: window.__asStaff ? 'staff' : 'approved', pairs: [{ level: 'P3', subjects: ['math'] }], isAdmin: !!window.__asStaff }, onChange(fn) { fn(this.state); return () => {}; } };
