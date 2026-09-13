// Shared by the science and math portals. The approved interface is permanent.
// This module has no release flag, remote listener or account-data writes.
export function mountInterfaceStudio({ subject, storage }) {
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
  function setUser(user) {
    const active = !!user;
    document.body.classList.toggle('arcade-ui', active);
    document.body.dataset.arcadeSubject = subject.toLowerCase();
    if (prizeDetails && previousActive !== active) prizeDetails.open = !active;
    previousActive = active;
  }
  // Motion remains a device preference, independent of the signed-in account.
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
  return { setUser };
}
