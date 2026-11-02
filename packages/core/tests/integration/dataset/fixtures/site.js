// Behaviours keyed off element presence, so every fixture page can load this one script.
(() => {
  const opener = document.getElementById('open-modal');
  if (opener) opener.addEventListener('click', () => document.getElementById('modal').classList.add('open'));

  // Smoothed parallax: eases toward its scroll-linked offset over a few hundred ms, then stops.
  const parallax = document.querySelector('.parallax');
  if (parallax) {
    let y = 0, running = false;
    const step = () => {
      const target = window.scrollY * 0.3;
      y += (target - y) * 0.12;
      if (Math.abs(target - y) < 0.5) { y = target; running = false; } else requestAnimationFrame(step);
      parallax.style.transform = `translateY(${y.toFixed(1)}px)`;
    };
    window.addEventListener('scroll', () => { if (!running) { running = true; requestAnimationFrame(step); } }, { passive: true });
  }

  // Start a junk animation once its element (or a sentinel) is in view, so it gets its own scroll-step episode.
  const startWhenSeen = (watched, target, threshold) => {
    if (!watched || !target) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      target.classList.add('go');
      io.disconnect();
    }, { threshold });
    io.observe(watched);
  };
  startWhenSeen(document.querySelector('.offscreen-zone'), document.querySelector('.offscreen-box'), 0);
  const video = document.querySelector('.promo-video');
  startWhenSeen(video, video, 1);

  const endless = document.querySelector('.endless');
  if (endless) {
    let angle = 0;
    const spin = () => { angle = (angle + 3) % 360; endless.style.transform = `rotate(${angle}deg)`; requestAnimationFrame(spin); };
    requestAnimationFrame(spin);
  }
})();
