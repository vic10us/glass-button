/**
 * Interaction state easing.
 *
 * The element sets *targets* from DOM events; `step(dt)` eases the visible
 * values toward them with frame-rate independent exponential smoothing and
 * reports whether everything has settled. The renderer reads `state` each
 * frame and never touches the DOM. Keeping this pure makes the timing
 * testable without a browser.
 */

/** Exponential approach: the fraction covered per second is fixed regardless of dt. */
export function expSmooth(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export interface FrameState {
  /** 0 = idle, 1 = fully hovered. */
  hover: number;
  /** 0 = released, 1 = fully pressed. */
  press: number;
  /** Pointer position in pill-normalised coordinates (-1..1, y up). */
  pointerX: number;
  pointerY: number;
  /** Click flash, 1 on trigger, decays to 0. */
  pulse: number;
}

const SETTLE_EPS = 1e-3;

export class InteractionState {
  /** Resting light position when the pointer is away: slightly above centre. */
  static readonly REST_POINTER_Y = 0.35;

  hoverTarget = 0;
  pressTarget = 0;
  pointerTargetX = 0;
  pointerTargetY = InteractionState.REST_POINTER_Y;

  readonly state: FrameState = {
    hover: 0,
    press: 0,
    pointerX: 0,
    pointerY: InteractionState.REST_POINTER_Y,
    pulse: 0,
  };

  /** Rates in 1/s. Press engages quickly and releases slower, like real material. */
  static readonly RATE_HOVER = 6;
  static readonly RATE_PRESS_IN = 18;
  static readonly RATE_PRESS_OUT = 7;
  static readonly RATE_POINTER = 10;
  static readonly RATE_PULSE = 4;

  setPointer(x: number, y: number): void {
    this.pointerTargetX = x;
    this.pointerTargetY = y;
  }

  /** Click flash. */
  trigger(): void {
    this.state.pulse = 1;
  }

  /** Advance by dt seconds. Returns true when every value is within epsilon of its target. */
  step(dt: number): boolean {
    const s = this.state;
    const hovered = this.hoverTarget > 0.5;
    const px = hovered ? this.pointerTargetX : 0;
    const py = hovered ? this.pointerTargetY : InteractionState.REST_POINTER_Y;

    s.hover = expSmooth(s.hover, this.hoverTarget, InteractionState.RATE_HOVER, dt);
    s.press = expSmooth(
      s.press,
      this.pressTarget,
      this.pressTarget > s.press ? InteractionState.RATE_PRESS_IN : InteractionState.RATE_PRESS_OUT,
      dt,
    );
    s.pointerX = expSmooth(s.pointerX, px, InteractionState.RATE_POINTER, dt);
    s.pointerY = expSmooth(s.pointerY, py, InteractionState.RATE_POINTER, dt);
    s.pulse = expSmooth(s.pulse, 0, InteractionState.RATE_PULSE, dt);

    return (
      Math.abs(s.hover - this.hoverTarget) < SETTLE_EPS &&
      Math.abs(s.press - this.pressTarget) < SETTLE_EPS &&
      Math.abs(s.pointerX - px) < SETTLE_EPS &&
      Math.abs(s.pointerY - py) < SETTLE_EPS &&
      s.pulse < SETTLE_EPS
    );
  }
}
