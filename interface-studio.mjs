// Shared by the science and math portals. No student records are written here.
export function isReleased(data) {
  return data?.arcadeUi?.version === 1 && data.arcadeUi.released === true;
}

export function createReleaseController({ subscribe, save, onChange, storage }) {
  let user = null, unsubscribe = null, generation = 0;
  let state = { ready: false, released: false, preview: false, busy: false, error: '' };
  const emit = () => onChange({ ...state, admin: user?.role === 'admin', active: !!user && (user.role === 'admin' ? state.preview : state.ready && state.released) });
  function setUser(next) {
    generation++;
    unsubscribe?.(); unsubscribe = null;
    user = next ? { uid: next.uid, role: next.role } : null;
    state = { ready: false, released: false, preview: false, busy: false, error: '' };
    if (user?.role === 'admin') {
      state.preview = true;
      try { state.preview = storage?.getItem(`preview:${user.uid}`) !== 'current'; } catch (_) {}
    }
    emit();
    if (!user) return;
    const ticket = generation;
    unsubscribe = subscribe((data, metadata = {}) => {
      if (ticket !== generation) return;
      // Never publish optimistically from a cached or unacknowledged write.
      state.ready = !metadata.fromCache && !metadata.hasPendingWrites;
      if (state.ready) { state.released = isReleased(data); state.error = ''; }
      emit();
    }, () => {
      if (ticket !== generation) return;
      state.ready = false;
      state.error = 'Could not check the release setting. Check your connection and reload.';
      emit();
    });
  }
  function preview(enabled) {
    if (user?.role !== 'admin') return false;
    state.preview = !!enabled;
    try { storage?.setItem(`preview:${user.uid}`, enabled ? 'new' : 'current'); } catch (_) {}
    emit(); return true;
  }
  async function release(enabled) {
    if (user?.role !== 'admin' || !state.ready || state.busy || typeof enabled !== 'boolean') return false;
    const ticket = generation, uid = user.uid, expected = state.released;
    state.busy = true; state.error = ''; emit();
    try {
      await save(enabled, uid, expected);
      if (ticket !== generation) return false;
      state.released = enabled; state.ready = true;
      return true;
    } catch (error) {
      if (ticket === generation) state.error = error?.message || 'The release was not saved. Please try again.';
      return false;
    } finally {
      if (ticket === generation) { state.busy = false; emit(); }
    }
  }
  return { setUser, preview, release };
}

export function mountInterfaceStudio({ subject, root, subscribe, save, storage }) {
  const bar = document.createElement('section');
  bar.id = 'arcadeUiBar';
  bar.className = 'arcade-studio-bar';
  bar.hidden = true;
  bar.setAttribute('aria-label', 'Interface preview and release');
  bar.innerHTML = `<div class="arcade-studio-copy"><span class="arcade-eyebrow">INTERFACE STUDIO</span><strong>${subject} · new look</strong><span class="arcade-studio-status" role="status"></span></div><div class="arcade-studio-actions"><button type="button" class="arcade-control" data-preview></button><button type="button" class="arcade-control arcade-control-primary" data-release></button></div><p class="arcade-studio-error" role="alert" hidden></p>`;
  root.prepend(bar);
  const previewButton = bar.querySelector('[data-preview]');
  const releaseButton = bar.querySelector('[data-release]');
  const status = bar.querySelector('[role="status"]');
  const error = bar.querySelector('[role="alert"]');
  const dialog = document.createElement('dialog');
  dialog.className = 'arcade-release-dialog';
  dialog.setAttribute('aria-labelledby', 'arcadeReleaseTitle');
  dialog.innerHTML = `<form method="dialog"><span class="arcade-eyebrow">${subject.toUpperCase()} INTERFACE</span><h2 id="arcadeReleaseTitle"></h2><p data-explanation></p><div class="arcade-studio-actions"><button class="arcade-control" value="cancel">Keep reviewing</button><button class="arcade-control arcade-control-primary" value="confirm" data-confirm></button></div></form>`;
  document.body.append(dialog);
  // Keep the standings near the top; the complete prize rules remain one tap away.
  const prizeBanner = document.querySelector('#page-leaderboard .rpg-prize-banner');
  let prizeDetails = null, previousActive = null;
  if (prizeBanner) {
    prizeDetails = document.createElement('details');
    prizeDetails.className = 'arcade-prize-details';
    prizeDetails.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'Prizes & leaderboard rules';
    prizeBanner.before(prizeDetails);
    prizeDetails.append(summary, prizeBanner);
  }
  let latest, pendingTarget = null;
  const controller = createReleaseController({ subscribe, save, storage, onChange(state) {
    latest = state;
    document.body.classList.toggle('arcade-ui', state.active);
    document.body.dataset.arcadeSubject = subject.toLowerCase();
    if (prizeDetails && previousActive !== state.active) prizeDetails.open = !state.active;
    previousActive = state.active;
    bar.hidden = !state.admin;
    if (!state.admin && dialog.open) dialog.close('cancel');
    previewButton.textContent = state.preview ? 'View current interface' : 'Preview new interface';
    previewButton.setAttribute('aria-pressed', String(state.preview));
    status.textContent = !state.ready ? 'Checking student release…' : state.released ? 'Students have the new interface' : 'Admin preview only · students keep the current interface';
    releaseButton.textContent = state.busy ? 'Saving…' : state.released ? 'Return students to current interface' : 'Release to students';
    releaseButton.disabled = !state.ready || state.busy;
    error.hidden = !state.error;
    error.textContent = state.error;
  }});
  previewButton.addEventListener('click', () => controller.preview(!latest.preview));
  releaseButton.addEventListener('click', () => {
    if (!latest.admin || !latest.ready || latest.busy) return;
    pendingTarget = !latest.released;
    dialog.querySelector('h2').textContent = pendingTarget ? 'Release the new interface?' : 'Restore the current interface?';
    dialog.querySelector('[data-explanation]').textContent = pendingTarget ? `Signed-in ${subject.toLowerCase()} students will receive the new look. Their questions, progress and scores stay the same. You can return to the current interface here at any time.` : `Connected ${subject.toLowerCase()} students will return to the current look. You can continue previewing the new interface as an admin.`;
    dialog.querySelector('[data-confirm]').textContent = pendingTarget ? 'Release to students' : 'Restore current interface';
    dialog.returnValue = '';
    dialog.showModal();
  });
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'confirm' && pendingTarget !== null) controller.release(pendingTarget);
    pendingTarget = null;
  });
  // Calm mode is a device preference; it never changes the centre's release.
  const motion = document.createElement('button');
  motion.type = 'button'; motion.className = 'arcade-motion-control';
  let calm = false;
  try { calm = storage?.getItem('calm') === 'true'; } catch (_) {}
  function setCalm() {
    document.body.classList.toggle('arcade-calm', calm);
    motion.textContent = calm ? 'Motion off' : 'Motion on';
    motion.setAttribute('aria-pressed', String(calm));
    motion.setAttribute('aria-label', 'Reduce interface animation');
  }
  motion.addEventListener('click', () => { calm = !calm; try { storage?.setItem('calm', String(calm)); } catch (_) {} setCalm(); });
  setCalm();
  document.querySelector('.sidebar-nav')?.append(motion);
  // Preserve the apps' own click handlers and role-based navigation visibility.
  for (const item of document.querySelectorAll('.nav-item[data-page]:not(button):not(a)')) {
    if (!item.hasAttribute('tabindex')) item.tabIndex = 0;
    if (!item.hasAttribute('role')) item.setAttribute('role', 'button');
    item.addEventListener('keydown', event => {
      if (event.target === item && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); item.click(); }
    });
  }
  return controller;
}
