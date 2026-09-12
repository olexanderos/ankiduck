import type { CardState, Grade } from '../types';

export const LEARNING_STEPS_MIN = [1, 10];
export const RELEARNING_STEPS_MIN = [10];
export const GRADUATING_IVL_DAYS = 1;
export const EASY_IVL_DAYS = 4;
export const STARTING_EASE = 2.5;
export const MIN_EASE = 1.3;
export const HARD_MULTIPLIER = 1.2;
export const EASY_BONUS = 1.3;
export const FUZZ_RATIO = 0.05;

function minutesToMs(min: number): number {
  return min * 60_000;
}

function daysToMs(days: number): number {
  return days * 24 * 60 * 60_000;
}

function applyLearningStep(
  state: CardState,
  grade: Grade,
  now: number,
  steps: number[],
  graduateIvlDays: number
): CardState {
  if (grade === 'easy') {
    return {
      ...state,
      queue: 'review',
      ivl: EASY_IVL_DAYS,
      ease: state.ease || STARTING_EASE,
      due: now + daysToMs(EASY_IVL_DAYS),
      learningStep: 0,
    };
  }
  if (grade === 'again') {
    return {
      ...state,
      queue: state.queue === 'relearning' ? 'relearning' : 'learning',
      learningStep: 0,
      due: now + minutesToMs(steps[0]),
    };
  }
  const currentStep = state.queue === 'new' ? 0 : state.learningStep;
  if (grade === 'hard') {
    return {
      ...state,
      queue: state.queue === 'new' ? 'learning' : state.queue,
      learningStep: currentStep,
      due: now + minutesToMs(steps[currentStep]),
    };
  }
  // good
  const nextStep = currentStep + 1;
  if (nextStep >= steps.length) {
    return {
      ...state,
      queue: 'review',
      ivl: graduateIvlDays,
      ease: state.ease || STARTING_EASE,
      due: now + daysToMs(graduateIvlDays),
      learningStep: 0,
    };
  }
  return {
    ...state,
    queue: state.queue === 'new' ? 'learning' : state.queue,
    learningStep: nextStep,
    due: now + minutesToMs(steps[nextStep]),
  };
}

export function nextState(
  state: CardState,
  grade: Grade,
  now: number = Date.now(),
  rng: () => number = Math.random
): CardState {
  if (state.queue === 'new' || state.queue === 'learning') {
    return applyLearningStep(state, grade, now, LEARNING_STEPS_MIN, GRADUATING_IVL_DAYS);
  }
  if (state.queue === 'relearning') {
    return applyLearningStep(state, grade, now, RELEARNING_STEPS_MIN, Math.max(1, state.ivl));
  }
  return applyReviewGrade(state, grade, now, rng);
}

function applyFuzz(ivlDays: number, rng: () => number): number {
  const fuzz = ivlDays * FUZZ_RATIO * (rng() * 2 - 1);
  return Math.max(1, Math.round(ivlDays + fuzz));
}

function applyReviewGrade(state: CardState, grade: Grade, now: number, rng: () => number): CardState {
  if (grade === 'again') {
    const newEase = Math.max(MIN_EASE, state.ease - 0.2);
    return {
      ...state,
      queue: 'relearning',
      ease: newEase,
      lapses: state.lapses + 1,
      ivl: 0,
      learningStep: 0,
      due: now + minutesToMs(RELEARNING_STEPS_MIN[0]),
    };
  }
  if (grade === 'hard') {
    const ivl = applyFuzz(state.ivl * HARD_MULTIPLIER, rng);
    return { ...state, queue: 'review', ease: Math.max(MIN_EASE, state.ease - 0.15), ivl, due: now + daysToMs(ivl) };
  }
  if (grade === 'good') {
    const ivl = applyFuzz(state.ivl * state.ease, rng);
    return { ...state, queue: 'review', ivl, due: now + daysToMs(ivl) };
  }
  // easy
  const ivl = applyFuzz(state.ivl * state.ease * EASY_BONUS, rng);
  return { ...state, queue: 'review', ease: state.ease + 0.15, ivl, due: now + daysToMs(ivl) };
}
