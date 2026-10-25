(() => {
  document.documentElement.classList.add('js');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-in'));
  }

  const box = document.getElementById('lightbox');
  const img = box.querySelector('[data-role="lightbox-img"]') || box.querySelector('img');
  const closeBtn = box.querySelector('.lightbox-close');
  const open = (src, alt) => {
    img.src = src;
    img.alt = alt || '放大图片';
    box.hidden = false;
    closeBtn.focus();
  };
  const close = () => {
    box.hidden = true;
    /* keep src for a11y; hide via [hidden] */
  };
  document.querySelectorAll('[data-lightbox]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const src = btn.getAttribute('data-lightbox');
      const alt = btn.querySelector('img')?.alt || '';
      open(src, alt);
    });
  });
  closeBtn.addEventListener('click', close);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !box.hidden) close();
  });
})();
