/**
 * Creates a spring-based easing function.
 * This simulates a damped harmonic oscillator, providing a more natural motion.
 * Inspired by principles from physics-based UI animation.
 *
 * @param tension - The stiffness of the spring. Higher values result in faster, snappier motion.
 * @param friction - The damping force. Higher values reduce oscillation and bring the spring to rest faster.
 * @param mass - The mass of the object. Higher values increase inertia and overshoot.
 * @returns An easing function that maps time `t` [0, 1] to a springy position value.
 */
function createSpringEasing({ tension = 250, friction = 25, mass = 1 } = {}) {
  // Pre-calculate physics constants for performance
  const stiffness = tension
  const damping = friction
  const velocity = 0 // Start from rest

  return (t: number): number => {
    if (t === 0) return 0
    if (t === 1) return 1

    const m_w0 = Math.sqrt(stiffness / mass)
    const m_zeta = damping / (2 * Math.sqrt(stiffness * mass))

    if (m_zeta < 1) {
      // Under-damped (bouncy)
      const m_wd = m_w0 * Math.sqrt(1 - m_zeta * m_zeta)
      const b = (m_zeta * m_w0 + -velocity) / m_wd
      return (
        1 - Math.exp(-t * m_zeta * m_w0) * ((1 + b * Math.sin(m_wd * t)) * Math.cos(m_wd * t) + Math.sin(m_wd * t) * -1)
      )
    } else {
      // Critically damped (no bounce)
      const g = m_w0
      const h = velocity + m_w0
      return 1 - (Math.exp(-t * g) * (1 + h * t)) / Math.exp(0)
    }
  }
}

// --- Standard Cubic Bezier Easing Functions ---

const easeInOutCubic = (t: number): number => {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

const easeInOutQuint = (t: number): number => {
  if (t < 0.5) {
    return 16 * t * t * t * t * t
  } else {
    const f = 2 * t - 2
    return 0.5 * f * f * f * f * f + 1
  }
}

const easeOutQuint = (t: number): number => {
  return 1 - Math.pow(1 - t, 5)
}

// --- User-Friendly Easing Map ---
// This map provides descriptive names for different animation styles,
// making the UI more intuitive for non-technical users.

export const EASING_MAP = {
  // Standard, reliable easing curves
  Smooth: easeOutQuint, // A gentle start that decelerates smoothly to a stop. Good for elegant transitions.
  Balanced: easeInOutQuint, // A symmetrical, very smooth acceleration and deceleration. The new default.
  Dynamic: easeInOutCubic, // A slightly quicker and more pronounced acceleration/deceleration than Balanced.

  // Physics-based spring animations
  'Gentle Spring': createSpringEasing({ tension: 180, friction: 30, mass: 1 }), // A soft, fluid motion with no bounce.
  'Bouncy Spring': createSpringEasing({ tension: 380, friction: 20, mass: 1 }), // A playful, energetic motion with a noticeable overshoot and bounce.
}
