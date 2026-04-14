export type BallType = 'cue' | 'solid' | 'stripe' | 'black';

export interface Ball {
  id: number;
  type: BallType;
  number: number;
  color: string;
  isPotted: boolean;
}

export interface GameState {
  currentPlayer: 1 | 2;
  player1Type: BallType | null;
  player2Type: BallType | null;
  balls: Ball[];
  isGameOver: boolean;
  winner: 1 | 2 | null;
  turnStatus: 'waiting' | 'aiming' | 'moving' | 'foul';
  lastFoulReason: string | null;
  pottedThisTurn: Ball[];
  firstBallHitThisTurn: Ball | null;
}

export const BALL_COLORS: Record<number, string> = {
  0: '#FFFFFF', // Cue
  1: '#FFD700', // Yellow
  2: '#0000FF', // Blue
  3: '#FF0000', // Red
  4: '#800080', // Purple
  5: '#FFA500', // Orange
  6: '#008000', // Green
  7: '#800000', // Maroon
  8: '#000000', // Black
  9: '#FFD700', // Yellow Stripe
  10: '#0000FF', // Blue Stripe
  11: '#FF0000', // Red Stripe
  12: '#800080', // Purple Stripe
  13: '#FFA500', // Orange Stripe
  14: '#008000', // Green Stripe
  15: '#800000', // Maroon Stripe
};
