"use client";
import { useCallback, useRef, useState } from "react";

/** A pointer drag records once; intermediate pointer events don't consume history. */
export function useEditHistory<T>(initial: T) {
  const [state, render] = useState(() => ({
    value: initial,
    past: [] as T[],
    future: [] as T[],
  }));
  const store = useRef(state);
  const set = useCallback((update: T | ((value: T) => T), record = true) => {
    const current = store.current;
    const value =
      typeof update === "function"
        ? (update as (value: T) => T)(current.value)
        : update;
    if (value === current.value) return;
    store.current = {
      value,
      past: record ? [...current.past, current.value].slice(-5) : current.past,
      future: [],
    };
    render(store.current);
  }, []);
  const reset = useCallback((value: T) => {
    store.current = { value, past: [], future: [] };
    render(store.current);
  }, []);
  const undo = useCallback(() => {
    const { value, past, future } = store.current;
    if (!past.length) return;
    store.current = {
      value: past[past.length - 1],
      past: past.slice(0, -1),
      future: [value, ...future].slice(0, 5),
    };
    render(store.current);
  }, []);
  const redo = useCallback(() => {
    const { value, past, future } = store.current;
    if (!future.length) return;
    store.current = {
      value: future[0],
      past: [...past, value].slice(-5),
      future: future.slice(1),
    };
    render(store.current);
  }, []);
  return {
    value: state.value,
    set,
    reset,
    undo,
    redo,
    canUndo: !!state.past.length,
    canRedo: !!state.future.length,
  };
}
