'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * IntersectionObserver-driven reveal hook.
 * Returns a ref + a `shown` boolean that flips true once the element
 * scrolls into view (one-shot). Drives the scroll-activated flow nodes.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(
  options?: IntersectionObserverInit,
) {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.25, rootMargin: '0px 0px -8% 0px', ...options },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, shown };
}
