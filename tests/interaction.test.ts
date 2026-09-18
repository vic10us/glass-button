import { describe, expect, it } from 'vitest';
import { InteractionState, expSmooth } from '../src/interaction';

describe('expSmooth', () => {
  it('approaches the target exponentially', () => {
    expect(expSmooth(0, 1, 6, 0.5)).toBeCloseTo(1 - Math.exp(-3), 6);
  });

  it('is frame-rate independent', () => {
    const one = expSmooth(0, 1, 6, 0.5);
    let many = 0;
    for (let i = 0; i < 5; i++) many = expSmooth(many, 1, 6, 0.1);
    expect(many).toBeCloseTo(one, 6);
  });
});

describe('InteractionState', () => {
  it('starts settled at idle', () => {
    const s = new InteractionState();
    expect(s.step(1 / 60)).toBe(true);
    expect(s.state.hover).toBe(0);
  });

  it('reports unsettled while easing and settled once it has arrived', () => {
    const s = new InteractionState();
    s.hoverTarget = 1;
    expect(s.step(1 / 60)).toBe(false);
    expect(s.state.hover).toBeGreaterThan(0);
    expect(s.state.hover).toBeLessThan(1);
    for (let i = 0; i < 180; i++) s.step(1 / 60);
    expect(s.step(1 / 60)).toBe(true);
    expect(s.state.hover).toBeCloseTo(1, 2);
  });

  it('presses in faster than it releases', () => {
    const s = new InteractionState();
    s.pressTarget = 1;
    s.step(0.05);
    const pressedAfter50ms = s.state.press;
    for (let i = 0; i < 60; i++) s.step(1 / 60);
    s.pressTarget = 0;
    s.step(0.05);
    const releasedAfter50ms = 1 - s.state.press;
    expect(pressedAfter50ms).toBeGreaterThan(releasedAfter50ms);
  });

  it('pulses on trigger and decays', () => {
    const s = new InteractionState();
    s.trigger();
    expect(s.state.pulse).toBe(1);
    for (let i = 0; i < 12; i++) s.step(1 / 60);
    expect(s.state.pulse).toBeLessThan(0.5);
    expect(s.state.pulse).toBeGreaterThan(0);
  });

  it('returns the pointer to its resting position when not hovered', () => {
    const s = new InteractionState();
    s.hoverTarget = 1;
    s.setPointer(0.8, -0.5);
    for (let i = 0; i < 60; i++) s.step(1 / 60);
    expect(s.state.pointerX).toBeCloseTo(0.8, 1);
    s.hoverTarget = 0;
    for (let i = 0; i < 300; i++) s.step(1 / 60);
    expect(s.state.pointerX).toBeCloseTo(0, 2);
    expect(s.state.pointerY).toBeCloseTo(InteractionState.REST_POINTER_Y, 2);
  });
});
