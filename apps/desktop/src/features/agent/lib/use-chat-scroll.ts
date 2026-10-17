"use client";

import { useEffect, useRef } from "react";

export function useChatScroll(scope: string) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const scrollToBottom = useRef<() => void>(() => {});

  useEffect(() => {
    if (!scope) return;
    const container = viewport.current;
    const body = content.current;
    if (!container || !body) return;
    let following = true;
    let previousTop = container.scrollTop;
    let frame: number | null = null;
    const cancel = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };
    const follow = () => {
      if (!following || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (!following) return;
        container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        previousTop = container.scrollTop;
      });
    };
    scrollToBottom.current = () => {
      following = true;
      cancel();
      follow();
    };
    const onScroll = () => {
      const top = container.scrollTop;
      if (top < previousTop) {
        following = false;
        cancel();
      } else if (container.scrollHeight - container.clientHeight - top <= 48) {
        following = true;
        follow();
      }
      previousTop = top;
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        following = false;
        cancel();
      }
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", onWheel, { passive: true });
    const resize = new ResizeObserver(follow);
    resize.observe(container);
    resize.observe(body);
    const mutations = new MutationObserver(follow);
    mutations.observe(body, { subtree: true, childList: true, characterData: true });
    follow();
    return () => {
      cancel();
      scrollToBottom.current = () => {};
      resize.disconnect();
      mutations.disconnect();
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", onWheel);
    };
  }, [scope]);

  return { viewport, content, scrollToBottom: () => scrollToBottom.current() };
}
