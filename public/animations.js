/* ══════════════════════════════════════════════════════════
   ANIMATIONS.JS — Smooth animation utilities inspired by Framer Motion
══════════════════════════════════════════════════════════ */

// ── Easing functions ─────────────────────────────────────
const easings = {
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeInBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  easeOutBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeOutElastic: (t) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0
      ? 0
      : t === 1
      ? 1
      : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  }
};

// ── Animate element properties ─────────────────────────────
function animateValue(element, prop, from, to, duration = 300, easing = 'easeOut') {
  const startTime = Date.now();
  const easingFn = easings[easing] || easings.easeOut;

  function update() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easedProgress = easingFn(progress);
    const value = from + (to - from) * easedProgress;

    if (prop === 'opacity') {
      element.style.opacity = value;
    } else if (prop === 'scale') {
      element.style.transform = `scale(${value})`;
    } else if (prop.startsWith('translateX')) {
      element.style.transform = `translateX(${value}px)`;
    } else if (prop.startsWith('translateY')) {
      element.style.transform = `translateY(${value}px)`;
    } else {
      element.style[prop] = value;
    }

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

// ── Stagger animation for multiple elements ──────────────
function staggerElements(elements, animationFn, staggerDelay = 100) {
  elements.forEach((element, index) => {
    setTimeout(() => {
      animationFn(element, index);
    }, index * staggerDelay);
  });
}

// ── Fade in animation ────────────────────────────────────
function fadeIn(element, duration = 300) {
  element.style.opacity = '0';
  element.style.willChange = 'opacity';
  
  requestAnimationFrame(() => {
    animateValue(element, 'opacity', 0, 1, duration, 'easeOut');
  });

  setTimeout(() => {
    element.style.willChange = 'auto';
  }, duration);
}

// ── Scale in animation ───────────────────────────────────
function scaleIn(element, duration = 400, from = 0.9) {
  element.style.opacity = '0';
  element.style.transform = `scale(${from})`;
  element.style.willChange = 'opacity, transform';

  requestAnimationFrame(() => {
    animateValue(element, 'opacity', 0, 1, duration, 'easeOut');
    element.style.transform = `scale(${from})`;
    
    const startTime = Date.now();
    const easingFn = easings.easeOutBack;

    function update() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easingFn(progress);
      const scale = from + (1 - from) * easedProgress;
      element.style.transform = `scale(${scale})`;

      if (progress < 1) {
        requestAnimationFrame(update);
      }
    }

    requestAnimationFrame(update);
  });

  setTimeout(() => {
    element.style.willChange = 'auto';
  }, duration);
}

// ── Slide in animation ───────────────────────────────────
function slideInUp(element, duration = 400, distance = 20) {
  element.style.opacity = '0';
  element.style.transform = `translateY(${distance}px)`;
  element.style.willChange = 'opacity, transform';

  requestAnimationFrame(() => {
    animateValue(element, 'opacity', 0, 1, duration, 'easeOut');
    
    const startTime = Date.now();
    const easingFn = easings.easeOut;

    function update() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easingFn(progress);
      const translateY = distance - (distance * easedProgress);
      element.style.transform = `translateY(${translateY}px)`;

      if (progress < 1) {
        requestAnimationFrame(update);
      }
    }

    requestAnimationFrame(update);
  });

  setTimeout(() => {
    element.style.willChange = 'auto';
  }, duration);
}

// ── Slide in from left ───────────────────────────────────
function slideInLeft(element, duration = 400, distance = 30) {
  element.style.opacity = '0';
  element.style.transform = `translateX(-${distance}px)`;
  element.style.willChange = 'opacity, transform';

  requestAnimationFrame(() => {
    animateValue(element, 'opacity', 0, 1, duration, 'easeOut');
    
    const startTime = Date.now();
    const easingFn = easings.easeOut;

    function update() {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easingFn(progress);
      const translateX = -distance + (distance * easedProgress);
      element.style.transform = `translateX(${translateX}px)`;

      if (progress < 1) {
        requestAnimationFrame(update);
      }
    }

    requestAnimationFrame(update);
  });

  setTimeout(() => {
    element.style.willChange = 'auto';
  }, duration);
}

// ── Hover scale effect ───────────────────────────────────
function enableHoverScale(element, scale = 1.05, duration = 200) {
  element.addEventListener('mouseenter', () => {
    element.style.willChange = 'transform';
    animateValue(element, 'scale', 1, scale, duration, 'easeOut');
  });

  element.addEventListener('mouseleave', () => {
    element.style.willChange = 'transform';
    animateValue(element, 'scale', scale, 1, duration, 'easeOut');
    
    setTimeout(() => {
      element.style.willChange = 'auto';
    }, duration);
  });
}

// ── Pulse animation ──────────────────────────────────────
function pulse(element, duration = 2000, intensity = 0.3) {
  element.style.animation = `pulse ${duration}ms ease-in-out infinite`;
  element.style.setProperty('--pulse-intensity', intensity);
}

// ── Smooth scroll animation ──────────────────────────────
function smoothScroll(targetElement, duration = 800) {
  const targetPosition = targetElement.offsetTop;
  const startPosition = window.scrollY;
  const distance = targetPosition - startPosition;
  let start = null;

  const animation = (currentTime) => {
    if (start === null) start = currentTime;
    const elapsed = currentTime - start;
    const progress = Math.min(elapsed / duration, 1);
    const ease = easings.easeInOut(progress);
    window.scrollTo(0, startPosition + distance * ease);

    if (progress < 1) {
      requestAnimationFrame(animation);
    }
  };

  requestAnimationFrame(animation);
}

// ── Ripple effect on click ───────────────────────────────
function addRippleEffect(element) {
  element.addEventListener('click', (e) => {
    const ripple = document.createElement('span');
    const rect = element.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;

    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    ripple.classList.add('ripple');

    element.appendChild(ripple);

    setTimeout(() => ripple.remove(), 600);
  });
}

// ── Parallax scroll effect ───────────────────────────────
function enableParallax(element, speed = 0.5) {
  function update() {
    const rect = element.getBoundingClientRect();
    const visible = rect.top < window.innerHeight && rect.bottom > 0;

    if (visible) {
      const yPos = window.scrollY * speed;
      element.style.transform = `translateY(${yPos}px)`;
    }
  }

  window.addEventListener('scroll', update, { passive: true });
  update();
}

// ── Sequence animations ──────────────────────────────────
async function sequenceAnimations(animations) {
  for (const anim of animations) {
    await new Promise((resolve) => {
      anim();
      setTimeout(resolve, 300);
    });
  }
}

// ── Watch scroll position ────────────────────────────────
function onScroll(callback) {
  let ticking = false;

  function update() {
    callback(window.scrollY);
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });
}

// ── Observe element visibility ───────────────────────────
function observeElement(element, callback) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      callback(entry.isIntersecting, entry);
    });
  }, {
    threshold: 0.1,
    rootMargin: '50px'
  });

  observer.observe(element);
  return observer;
}

// ── Add focus visible styles ─────────────────────────────
function enableFocusStyles(element) {
  element.addEventListener('focus', () => {
    element.style.outlineOffset = '2px';
  });

  element.addEventListener('blur', () => {
    element.style.outlineOffset = 'auto';
  });
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    easings,
    animateValue,
    staggerElements,
    fadeIn,
    scaleIn,
    slideInUp,
    slideInLeft,
    enableHoverScale,
    pulse,
    smoothScroll,
    addRippleEffect,
    enableParallax,
    sequenceAnimations,
    onScroll,
    observeElement,
    enableFocusStyles
  };
}
