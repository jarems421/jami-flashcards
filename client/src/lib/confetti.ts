import confetti from 'canvas-confetti';

export function celebrateStreak(streakCount: number) {
  const duration = streakCount >= 7 ? 3000 : 2000;
  const particleCount = Math.min(50 + streakCount * 10, 200);
  
  confetti({
    particleCount,
    spread: 70,
    origin: { y: 0.6 },
    colors: ['#FFD700', '#FFA500', '#FF6347', '#32CD32', '#1E90FF'],
  });

  if (streakCount >= 7) {
    setTimeout(() => {
      confetti({
        particleCount: 50,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ['#FFD700', '#FFA500'],
      });
    }, 250);
    setTimeout(() => {
      confetti({
        particleCount: 50,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ['#FFD700', '#FFA500'],
      });
    }, 400);
  }
}

export function celebrateGoalComplete() {
  const count = 200;
  const defaults = {
    origin: { y: 0.7 },
    colors: ['#FFD700', '#FFA500', '#9333EA', '#3B82F6', '#22C55E'],
  };

  function fire(particleRatio: number, opts: confetti.Options) {
    confetti({
      ...defaults,
      ...opts,
      particleCount: Math.floor(count * particleRatio),
    });
  }

  fire(0.25, { spread: 26, startVelocity: 55 });
  fire(0.2, { spread: 60 });
  fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
  fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
  fire(0.1, { spread: 120, startVelocity: 45 });
}

export function celebrateStarEarned() {
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.5 },
    colors: ['#FFFFFF', '#FFD700', '#FFF8DC', '#FFFACD'],
    shapes: ['star', 'circle'],
  });
}

export function quickCelebration() {
  confetti({
    particleCount: 30,
    spread: 50,
    origin: { y: 0.7 },
    colors: ['#22C55E', '#3B82F6'],
  });
}
