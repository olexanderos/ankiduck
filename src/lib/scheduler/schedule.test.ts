import { describe, it, expect } from 'vitest';
import { nextState } from './schedule';
import type { CardState } from '../types';

const NOW = 1_700_000_000_000;

function newCard(): CardState {
  return { cid: 1, queue: 'new', due: 0, ivl: 0, ease: 2.5, lapses: 0, learningStep: 0 };
}

describe('nextState — new/learning queue', () => {
  it('Again on a new card enters learning at step 0, due in 1 minute', () => {
    const result = nextState(newCard(), 'again', NOW);
    expect(result.queue).toBe('learning');
    expect(result.learningStep).toBe(0);
    expect(result.due).toBe(NOW + 60_000);
  });

  it('Good on a new card advances to learning step 1, due in 10 minutes', () => {
    const result = nextState(newCard(), 'good', NOW);
    expect(result.queue).toBe('learning');
    expect(result.learningStep).toBe(1);
    expect(result.due).toBe(NOW + 10 * 60_000);
  });

  it('Good on the last learning step graduates to review with a 1-day interval', () => {
    const atLastStep: CardState = { ...newCard(), queue: 'learning', learningStep: 1 };
    const result = nextState(atLastStep, 'good', NOW);
    expect(result.queue).toBe('review');
    expect(result.ivl).toBe(1);
    expect(result.ease).toBe(2.5);
    expect(result.due).toBe(NOW + 24 * 60 * 60_000);
  });

  it('Hard repeats the current learning step', () => {
    const atStep0: CardState = { ...newCard(), queue: 'learning', learningStep: 0 };
    const result = nextState(atStep0, 'hard', NOW);
    expect(result.queue).toBe('learning');
    expect(result.learningStep).toBe(0);
    expect(result.due).toBe(NOW + 60_000);
  });

  it('Easy graduates immediately to review with a 4-day interval', () => {
    const result = nextState(newCard(), 'easy', NOW);
    expect(result.queue).toBe('review');
    expect(result.ivl).toBe(4);
    expect(result.ease).toBe(2.5);
    expect(result.due).toBe(NOW + 4 * 24 * 60 * 60_000);
  });

  it('Again on an in-progress learning card resets to step 0', () => {
    const atStep1: CardState = { ...newCard(), queue: 'learning', learningStep: 1 };
    const result = nextState(atStep1, 'again', NOW);
    expect(result.learningStep).toBe(0);
    expect(result.due).toBe(NOW + 60_000);
  });
});

function reviewCard(overrides: Partial<CardState> = {}): CardState {
  return { cid: 1, queue: 'review', due: 0, ivl: 10, ease: 2.5, lapses: 0, learningStep: 0, ...overrides };
}

const noFuzz = () => 0.5; // rng()*2-1 === 0, i.e. no fuzz applied

describe('nextState — review queue', () => {
  it('Good multiplies the interval by ease', () => {
    const result = nextState(reviewCard({ ivl: 10, ease: 2.5 }), 'good', NOW, noFuzz);
    expect(result.queue).toBe('review');
    expect(result.ivl).toBe(25);
    expect(result.ease).toBe(2.5);
    expect(result.due).toBe(NOW + 25 * 24 * 60 * 60_000);
  });

  it('Hard multiplies the interval by 1.2 and lowers ease by 0.15', () => {
    const result = nextState(reviewCard({ ivl: 10, ease: 2.5 }), 'hard', NOW, noFuzz);
    expect(result.ivl).toBe(12);
    expect(result.ease).toBeCloseTo(2.35);
  });

  it('Easy multiplies the interval by ease * 1.3 and raises ease by 0.15', () => {
    const result = nextState(reviewCard({ ivl: 10, ease: 2.5 }), 'easy', NOW, noFuzz);
    expect(result.ivl).toBe(33); // round(10 * 2.5 * 1.3)
    expect(result.ease).toBeCloseTo(2.65);
  });

  it('Again drops the card into relearning, increments lapses, and lowers ease', () => {
    const result = nextState(reviewCard({ ivl: 10, ease: 2.5, lapses: 2 }), 'again', NOW, noFuzz);
    expect(result.queue).toBe('relearning');
    expect(result.lapses).toBe(3);
    expect(result.ease).toBeCloseTo(2.3);
    expect(result.due).toBe(NOW + 10 * 60_000);
  });

  it('ease never drops below the 1.3 floor', () => {
    const result = nextState(reviewCard({ ease: 1.35 }), 'again', NOW, noFuzz);
    expect(result.ease).toBe(1.3);
  });

  it('a relearning card graduates back to review using the ivl captured at lapse time', () => {
    const relearning: CardState = { cid: 1, queue: 'relearning', due: 0, ivl: 6, ease: 2.3, lapses: 1, learningStep: 0 };
    const result = nextState(relearning, 'good', NOW, noFuzz);
    expect(result.queue).toBe('review');
    expect(result.ivl).toBe(6);
  });
});
