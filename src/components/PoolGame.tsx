import React, { useEffect, useRef, useState, useCallback } from 'react';
import Matter from 'matter-js';
import { Ball, BallType, GameState, BALL_COLORS } from '../types';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { Toaster } from './ui/sonner';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { RotateCcw, Play, Trophy, AlertCircle } from 'lucide-react';

const TABLE_WIDTH = 800;
const TABLE_HEIGHT = 400;
const BALL_RADIUS = 10;
const POCKET_RADIUS = 18;
const CUE_LENGTH = 300;
const FRICTION = 0.01;
const RESTITUTION = 0.9;

const POCKETS = [
  { x: 0, y: 0 },
  { x: TABLE_WIDTH / 2, y: 0 },
  { x: TABLE_WIDTH, y: 0 },
  { x: 0, y: TABLE_HEIGHT },
  { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT },
  { x: TABLE_WIDTH, y: TABLE_HEIGHT },
];

export default function PoolGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const ballsRef = useRef<Map<number, Matter.Body>>(new Map());
  const [gameState, setGameState] = useState<GameState>({
    currentPlayer: 1,
    player1Type: null,
    player2Type: null,
    balls: [],
    isGameOver: false,
    winner: null,
    turnStatus: 'aiming',
    lastFoulReason: null,
    pottedThisTurn: [],
    firstBallHitThisTurn: null,
  });

  const [cueAngle, setCueAngle] = useState(0);
  const [cuePower, setCuePower] = useState(0);
  const [cueSpin, setCueSpin] = useState({ x: 0, y: 0 }); // -1 to 1
  const [isCharging, setIsCharging] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Initialize Physics Engine
  useEffect(() => {
    const engine = Matter.Engine.create({
      gravity: { x: 0, y: 0 },
    });
    engineRef.current = engine;

    // Create Table Walls
    const wallOptions = { isStatic: true, restitution: RESTITUTION, friction: 0 };
    const thickness = 50;
    const walls = [
      Matter.Bodies.rectangle(TABLE_WIDTH / 2, -thickness / 2, TABLE_WIDTH, thickness, wallOptions), // Top
      Matter.Bodies.rectangle(TABLE_WIDTH / 2, TABLE_HEIGHT + thickness / 2, TABLE_WIDTH, thickness, wallOptions), // Bottom
      Matter.Bodies.rectangle(-thickness / 2, TABLE_HEIGHT / 2, thickness, TABLE_HEIGHT, wallOptions), // Left
      Matter.Bodies.rectangle(TABLE_WIDTH + thickness / 2, TABLE_HEIGHT / 2, thickness, TABLE_HEIGHT, wallOptions), // Right
    ];
    Matter.Composite.add(engine.world, walls);

    // Initial Ball Setup
    setupBalls(engine);

    // Collision Events
    Matter.Events.on(engine, 'collisionStart', (event) => {
      event.pairs.forEach((pair) => {
        const { bodyA, bodyB } = pair;
        const ballA = Array.from(ballsRef.current.entries()).find(([_, b]) => b === bodyA);
        const ballB = Array.from(ballsRef.current.entries()).find(([_, b]) => b === bodyB);

        if (ballA && ballB) {
          const idA = ballA[0];
          const idB = ballB[0];
          
          setGameState(prev => {
            if (prev.turnStatus === 'moving' && !prev.firstBallHitThisTurn) {
              const hitBall = idA === 0 ? prev.balls.find(b => b.id === idB) : (idB === 0 ? prev.balls.find(b => b.id === idA) : null);
              if (hitBall) return { ...prev, firstBallHitThisTurn: hitBall };
            }
            return prev;
          });
        }
      });
    });

    // Animation Loop
    let animationId: number;
    const update = () => {
      Matter.Engine.update(engine, 1000 / 60);
      checkPockets(engine);
      checkMovement(engine);
      render();
      animationId = requestAnimationFrame(update);
    };
    update();

    return () => {
      cancelAnimationFrame(animationId);
      Matter.Engine.clear(engine);
    };
  }, []);

  const setupBalls = (engine: Matter.Engine) => {
    const balls: Ball[] = [];
    const bodies: Matter.Body[] = [];
    ballsRef.current.clear();

    // Cue Ball
    const cueBall = Matter.Bodies.circle(200, TABLE_HEIGHT / 2, BALL_RADIUS, {
      restitution: RESTITUTION,
      friction: FRICTION,
      frictionAir: FRICTION,
      label: 'cue-ball',
    });
    balls.push({ id: 0, type: 'cue', number: 0, color: BALL_COLORS[0], isPotted: false });
    bodies.push(cueBall);
    ballsRef.current.set(0, cueBall);

    // Rack Balls (Triangle)
    const startX = 550;
    const startY = TABLE_HEIGHT / 2;
    const spacing = BALL_RADIUS * 2 + 0.5;
    
    // 8-ball in the middle
    const rackOrder = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
    let ballIdx = 0;

    for (let row = 0; row < 5; row++) {
      for (let col = 0; col <= row; col++) {
        const x = startX + row * spacing * 0.866;
        const y = startY - (row * spacing) / 2 + col * spacing;
        
        const num = rackOrder[ballIdx++];
        const type: BallType = num === 8 ? 'black' : (num <= 7 ? 'solid' : 'stripe');
        
        const ballBody = Matter.Bodies.circle(x, y, BALL_RADIUS, {
          restitution: RESTITUTION,
          friction: FRICTION,
          frictionAir: FRICTION,
        });
        
        balls.push({ id: num, type, number: num, color: BALL_COLORS[num], isPotted: false });
        bodies.push(ballBody);
        ballsRef.current.set(num, ballBody);
      }
    }

    Matter.Composite.add(engine.world, bodies);
    setGameState(prev => ({ ...prev, balls }));
  };

  const checkPockets = (engine: Matter.Engine) => {
    ballsRef.current.forEach((body, id) => {
      POCKETS.forEach(pocket => {
        const dist = Math.sqrt(Math.pow(body.position.x - pocket.x, 2) + Math.pow(body.position.y - pocket.y, 2));
        if (dist < POCKET_RADIUS + BALL_RADIUS) {
          // Ball potted
          Matter.Composite.remove(engine.world, body);
          ballsRef.current.delete(id);
          
          setGameState(prev => {
            const pottedBall = prev.balls.find(b => b.id === id);
            if (!pottedBall) return prev;
            
            const newBalls = prev.balls.map(b => b.id === id ? { ...b, isPotted: true } : b);
            const newPottedThisTurn = [...prev.pottedThisTurn, pottedBall];
            
            return { ...prev, balls: newBalls, pottedThisTurn: newPottedThisTurn };
          });
        }
      });
    });
  };

  const checkMovement = (engine: Matter.Engine) => {
    const cueBallBody = ballsRef.current.get(0);
    
    // Apply Spin Physics
    if (cueBallBody && (cueBallBody as any).speed > 0.1 && (cueBallBody as any).spin) {
      const spin = (cueBallBody as any).spin;
      const velocity = cueBallBody.velocity;
      const speed = (cueBallBody as any).speed;
      
      // Normalize velocity
      const nx = velocity.x / speed;
      const ny = velocity.y / speed;

      // Top/Bottom Spin (Follow/Draw)
      // This force is applied continuously while moving
      // In a real game, this would be more complex (sliding vs rolling)
      const followDrawForce = spin.y * 0.00005 * speed;
      Matter.Body.applyForce(cueBallBody, cueBallBody.position, {
        x: nx * followDrawForce,
        y: ny * followDrawForce
      });

      // Side Spin (English) - Hard to simulate perfectly in 2D without custom collision
      // We'll apply a slight curve
      const sideForce = spin.x * 0.00002 * speed;
      Matter.Body.applyForce(cueBallBody, cueBallBody.position, {
        x: -ny * sideForce,
        y: nx * sideForce
      });
    }

    const isAnyMoving = Array.from(ballsRef.current.values()).some(body => 
      (body as any).speed > 0.1
    );

    setGameState(prev => {
      if (prev.turnStatus === 'moving' && !isAnyMoving) {
        // Turn finished
        return handleTurnEnd(prev);
      }
      return prev;
    });
  };

  const handleTurnEnd = (state: GameState): GameState => {
    let foul = false;
    let foulReason = null;
    let switchPlayer = true;

    const { pottedThisTurn, firstBallHitThisTurn, currentPlayer, player1Type, player2Type } = state;

    // 1. Check for Cue Ball potted
    const cuePotted = pottedThisTurn.some(b => b.type === 'cue');
    if (cuePotted) {
      foul = true;
      foulReason = "Cue ball potted!";
      respawnCueBall();
    }

    // 2. Check for first hit
    const currentType = currentPlayer === 1 ? player1Type : player2Type;
    if (!firstBallHitThisTurn && !foul) {
      foul = true;
      foulReason = "No ball hit!";
    } else if (firstBallHitThisTurn && currentType && firstBallHitThisTurn.type !== currentType && firstBallHitThisTurn.type !== 'black' && !foul) {
      foul = true;
      foulReason = `Wrong ball hit! You are ${currentType}s.`;
    } else if (firstBallHitThisTurn?.type === 'black' && !foul) {
      const remainingOfType = state.balls.filter(b => b.type === currentType && !b.isPotted).length;
      if (remainingOfType > 0) {
        foul = true;
        foulReason = "Hit 8-ball too early!";
      }
    }

    // 3. Assign types if first time
    let newP1Type = player1Type;
    let newP2Type = player2Type;
    
    if (!player1Type && pottedThisTurn.length > 0 && !foul) {
      const firstPotted = pottedThisTurn.find(b => b.type === 'solid' || b.type === 'stripe');
      if (firstPotted) {
        if (currentPlayer === 1) {
          newP1Type = firstPotted.type;
          newP2Type = firstPotted.type === 'solid' ? 'stripe' : 'solid';
        } else {
          newP2Type = firstPotted.type;
          newP1Type = firstPotted.type === 'solid' ? 'stripe' : 'solid';
        }
        toast.success(`Player ${currentPlayer} is now ${firstPotted.type}s!`);
      }
    }

    // 4. Check if player continues
    const validPotted = pottedThisTurn.filter(b => b.type === currentType);
    if (validPotted.length > 0 && !foul) {
      switchPlayer = false;
    }

    // 5. Check 8-ball
    const blackPotted = pottedThisTurn.find(b => b.type === 'black');
    if (blackPotted) {
      const remainingOfType = state.balls.filter(b => b.type === currentType && !b.isPotted).length;
      if (remainingOfType === 0 && !foul) {
        // Win!
        return { ...state, isGameOver: true, winner: currentPlayer };
      } else {
        // Loss!
        return { ...state, isGameOver: true, winner: currentPlayer === 1 ? 2 : 1 };
      }
    }

    if (foul) {
      toast.error(foulReason);
    }

    return {
      ...state,
      currentPlayer: switchPlayer ? (currentPlayer === 1 ? 2 : 1) : currentPlayer,
      player1Type: newP1Type,
      player2Type: newP2Type,
      turnStatus: 'aiming',
      pottedThisTurn: [],
      firstBallHitThisTurn: null,
      lastFoulReason: foulReason,
    };
  };

  const respawnCueBall = () => {
    if (!engineRef.current) return;
    const cueBall = Matter.Bodies.circle(200, TABLE_HEIGHT / 2, BALL_RADIUS, {
      restitution: RESTITUTION,
      friction: FRICTION,
      frictionAir: FRICTION,
      label: 'cue-ball',
    });
    ballsRef.current.set(0, cueBall);
    Matter.Composite.add(engineRef.current.world, cueBall);
    setGameState(prev => ({
      ...prev,
      balls: prev.balls.map(b => b.id === 0 ? { ...b, isPotted: false } : b)
    }));
  };

  const render = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT);

    // Table Felt
    ctx.fillStyle = '#2d5a27';
    ctx.fillRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT);

    // Pockets
    POCKETS.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, POCKET_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = '#111';
      ctx.fill();
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Balls
    ballsRef.current.forEach((body, id) => {
      const ball = gameState.balls.find(b => b.id === id);
      if (!ball) return;

      ctx.save();
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);

      // Shadow
      ctx.beginPath();
      ctx.arc(2, 2, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fill();

      // Ball Body
      ctx.beginPath();
      ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = ball.color;
      ctx.fill();

      // Stripe
      if (ball.type === 'stripe') {
        ctx.beginPath();
        ctx.arc(0, 0, BALL_RADIUS, -Math.PI / 4, Math.PI / 4);
        ctx.lineTo(0, 0);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0, BALL_RADIUS, Math.PI * 0.75, Math.PI * 1.25);
        ctx.lineTo(0, 0);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
      }

      // Number Circle
      if (ball.id !== 0) {
        ctx.beginPath();
        ctx.arc(0, 0, BALL_RADIUS * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 8px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ball.number.toString(), 0, 0);
      }

      // Highlight
      const gradient = ctx.createRadialGradient(-BALL_RADIUS * 0.3, -BALL_RADIUS * 0.3, 1, 0, 0, BALL_RADIUS);
      gradient.addColorStop(0, 'rgba(255,255,255,0.4)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.restore();
    });

    // Cue
    if (gameState.turnStatus === 'aiming') {
      const cueBall = ballsRef.current.get(0);
      if (cueBall) {
        ctx.save();
        ctx.translate(cueBall.position.x, cueBall.position.y);
        ctx.rotate(cueAngle);

        const offset = BALL_RADIUS + 10 + cuePower * 0.5;
        
        // Cue Stick
        const gradient = ctx.createLinearGradient(offset, -3, offset + CUE_LENGTH, 3);
        gradient.addColorStop(0, '#4a2c10');
        gradient.addColorStop(0.1, '#d4a373');
        gradient.addColorStop(0.9, '#4a2c10');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(offset, -3, CUE_LENGTH, 6);
        
        // Tip
        ctx.fillStyle = '#333';
        ctx.fillRect(offset, -3, 5, 6);
        
        // Aim Line
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.moveTo(-BALL_RADIUS, 0);
        ctx.lineTo(-TABLE_WIDTH, 0);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.stroke();

        ctx.restore();
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (gameState.turnStatus !== 'aiming') return;
    setIsCharging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMousePos({ x, y });

    if (gameState.turnStatus === 'aiming') {
      const cueBall = ballsRef.current.get(0);
      if (cueBall) {
        const angle = Math.atan2(y - cueBall.position.y, x - cueBall.position.x);
        setCueAngle(angle);
      }
    }

    if (isCharging) {
      const cueBall = ballsRef.current.get(0);
      if (cueBall) {
        const dist = Math.sqrt(Math.pow(x - cueBall.position.x, 2) + Math.pow(y - cueBall.position.y, 2));
        setCuePower(Math.min(100, Math.max(0, dist - 50)));
      }
    }
  };

  const handleMouseUp = () => {
    if (!isCharging) return;
    setIsCharging(false);
    shoot();
  };

  const shoot = () => {
    const cueBall = ballsRef.current.get(0);
    if (!cueBall) return;

    const force = cuePower * 0.0005;
    const vx = -Math.cos(cueAngle) * force;
    const vy = -Math.sin(cueAngle) * force;

    Matter.Body.applyForce(cueBall, cueBall.position, { x: vx, y: vy });
    
    // Store spin for physics processing
    (cueBall as any).spin = { ...cueSpin };
    
    setGameState(prev => ({ ...prev, turnStatus: 'moving' }));
    setCuePower(0);
    // Reset spin after shot? Usually yes in pool games
    // setCueSpin({ x: 0, y: 0 }); 
  };

  const resetGame = () => {
    window.location.reload();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-900 p-8 font-sans text-white" ref={containerRef}>
      <Toaster position="top-center" />
      
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 flex items-center justify-between w-full max-w-4xl"
      >
        <div className="flex items-center gap-4">
          <div className={`p-4 rounded-xl border-2 transition-all ${gameState.currentPlayer === 1 ? 'border-yellow-500 bg-yellow-500/10 shadow-[0_0_15px_rgba(234,179,8,0.3)]' : 'border-transparent bg-neutral-800'}`}>
            <p className="text-xs uppercase tracking-widest opacity-60 mb-1">Player 1</p>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold">YOU</span>
              {gameState.player1Type && (
                <Badge variant="outline" className="bg-white/5 border-white/20">
                  {gameState.player1Type.toUpperCase()}S
                </Badge>
              )}
            </div>
          </div>
          
          <div className="text-4xl font-black opacity-20 italic">VS</div>

          <div className={`p-4 rounded-xl border-2 transition-all ${gameState.currentPlayer === 2 ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'border-transparent bg-neutral-800'}`}>
            <p className="text-xs uppercase tracking-widest opacity-60 mb-1">Player 2</p>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold">OPPONENT</span>
              {gameState.player2Type && (
                <Badge variant="outline" className="bg-white/5 border-white/20">
                  {gameState.player2Type.toUpperCase()}S
                </Badge>
              )}
            </div>
          </div>
        </div>

        <Button variant="outline" size="icon" onClick={resetGame} className="bg-white/5 border-white/10 hover:bg-white/10">
          <RotateCcw className="w-4 h-4" />
        </Button>
      </motion.div>

      <div className="relative group">
        {/* Table Frame */}
        <div className="absolute -inset-4 bg-[#4a2c10] rounded-3xl shadow-2xl border-8 border-[#3a220d]" />
        
        <canvas
          ref={canvasRef}
          width={TABLE_WIDTH}
          height={TABLE_HEIGHT}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="relative rounded-lg cursor-crosshair shadow-inner"
          style={{ background: '#2d5a27' }}
        />

        {/* Power Meter */}
        <div className="absolute -right-12 top-0 bottom-0 w-4 bg-neutral-800 rounded-full overflow-hidden border border-white/10">
          <motion.div 
            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-red-500 via-yellow-500 to-green-500"
            animate={{ height: `${cuePower}%` }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        </div>
      </div>

      <div className="mt-12 grid grid-cols-3 gap-8 w-full max-w-4xl">
        <Card className="bg-neutral-800/50 border-white/5 p-6 backdrop-blur-sm">
          <h3 className="text-sm font-medium opacity-50 uppercase tracking-wider mb-4">Game Status</h3>
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full animate-pulse ${gameState.turnStatus === 'aiming' ? 'bg-green-500' : 'bg-yellow-500'}`} />
            <span className="text-lg font-medium">
              {gameState.turnStatus === 'aiming' ? 'Ready to Shoot' : 'Balls in Motion...'}
            </span>
          </div>
        </Card>

        <Card className="bg-neutral-800/50 border-white/5 p-6 backdrop-blur-sm">
          <h3 className="text-sm font-medium opacity-50 uppercase tracking-wider mb-4">Instructions</h3>
          <ul className="text-sm space-y-2 opacity-80">
            <li>• Move mouse to aim</li>
            <li>• Click and drag back for power</li>
            <li>• Release to shoot</li>
          </ul>
        </Card>

        <Card className="bg-neutral-800/50 border-white/5 p-6 backdrop-blur-sm">
          <h3 className="text-sm font-medium opacity-50 uppercase tracking-wider mb-4">Potted Balls</h3>
          <div className="flex flex-wrap gap-2">
            {gameState.balls.filter(b => b.isPotted && b.id !== 0).map(b => (
              <div 
                key={b.id} 
                className="w-6 h-6 rounded-full border border-white/20 shadow-sm"
                style={{ backgroundColor: b.color }}
              />
            ))}
          </div>
        </Card>

        <Card className="bg-neutral-800/50 border-white/5 p-6 backdrop-blur-sm flex flex-col items-center">
          <h3 className="text-sm font-medium opacity-50 uppercase tracking-wider mb-4 w-full">Cue Ball Spin</h3>
          <div 
            className="relative w-24 h-24 rounded-full bg-white shadow-inner cursor-crosshair overflow-hidden border-4 border-neutral-700"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
              const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
              const dist = Math.sqrt(x*x + y*y);
              if (dist <= 1) {
                setCueSpin({ x, y });
              } else {
                // Snap to edge
                setCueSpin({ x: x/dist, y: y/dist });
              }
            }}
          >
            {/* Crosshair lines */}
            <div className="absolute inset-0 flex items-center justify-center opacity-10">
              <div className="w-full h-px bg-black" />
              <div className="h-full w-px bg-black" />
            </div>
            
            {/* Spin Indicator Dot */}
            <motion.div 
              className="absolute w-3 h-3 bg-red-600 rounded-full shadow-md border border-red-800"
              animate={{ 
                left: `${(cueSpin.x + 1) * 50}%`, 
                top: `${(cueSpin.y + 1) * 50}%` 
              }}
              style={{ x: '-50%', y: '-50%' }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          </div>
          <div className="mt-4 flex gap-4 text-[10px] uppercase tracking-tighter opacity-50">
            <span>{cueSpin.y < -0.2 ? 'Follow' : cueSpin.y > 0.2 ? 'Draw' : 'Center'}</span>
            <span>{cueSpin.x < -0.2 ? 'Left' : cueSpin.x > 0.2 ? 'Right' : ''}</span>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            className="mt-2 h-6 text-[10px] hover:bg-white/10"
            onClick={() => setCueSpin({ x: 0, y: 0 })}
          >
            Reset Spin
          </Button>
        </Card>
      </div>

      <AnimatePresence>
        {gameState.isGameOver && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-neutral-900 border border-white/10 p-12 rounded-3xl text-center max-w-md w-full shadow-2xl"
            >
              <div className="w-24 h-24 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-8">
                <Trophy className="w-12 h-12 text-yellow-500" />
              </div>
              <h2 className="text-5xl font-black mb-4 italic tracking-tighter">VICTORY!</h2>
              <p className="text-xl opacity-60 mb-12">
                Player {gameState.winner} has conquered the table.
              </p>
              <Button size="lg" onClick={resetGame} className="w-full h-16 text-xl font-bold bg-white text-black hover:bg-neutral-200 rounded-2xl">
                PLAY AGAIN
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
