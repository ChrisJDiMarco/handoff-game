'use client';

import { useEffect, useRef, useState } from 'react';
import { createGame, launch, tick, inZone, names, CENTER, RADIUS, ZONE, PUCK, type Player, type Game } from '@/lib/game';

const colors = ['#65e5f0', '#ffc16b'];
type Aim = { id: number; x: number; y: number; startX: number; startY: number; pointerId: number };
const copy = (g: Game): Game => ({ ...g, pucks: g.pucks.map(p => ({ ...p })), scores: [...g.scores] });

export default function Home() {
  const engine = useRef(createGame());
  const [game, setGame] = useState(() => copy(engine.current));
  const [aim, setAim] = useState<Aim | null>(null);
  const aimRef = useRef<Aim | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [angle, setAngle] = useState(0);
  const [power, setPower] = useState(60);
  const refresh = () => setGame(copy(engine.current));
  const changeAim = (a: Aim | null) => { aimRef.current = a; setAim(a); };
  const shoot = (id: number, dx: number, dy: number) => {
    if (!launch(engine.current, id, dx, dy)) return false;
    changeAim(null); setSelected(null); refresh(); return true;
  };

  useEffect(() => {
    let frame = 0, previous = 0, accumulator = 0;
    const animate = (time: number) => {
      accumulator += Math.min((time - (previous || time)) / 1000, .05); previous = time;
      let moved = false;
      while (accumulator >= 1 / 120) { if (engine.current.phase === 'moving') { tick(engine.current); moved = true; } accumulator -= 1 / 120; }
      if (moved) setGame(copy(engine.current));
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate); return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    type Registry = { registerTool: (tool: { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => unknown }, options: { signal: AbortSignal }) => void | Promise<void> };
    const registry = (document as Document & { modelContext?: Registry }).modelContext;
    if (!registry?.registerTool) return;
    const life = new AbortController();
    const state = () => ({ player: names[engine.current.player], scores: [...engine.current.scores], shots: engine.current.shots, phase: engine.current.phase, pucks: engine.current.pucks.map(p => ({ id: p.id, owner: names[p.owner], x: p.x, y: p.y, inLight: inZone(p) })) });
    const definitions = [
      { name: 'get_handoff_match_state', description: 'Read turn, points, puck locations and whether a shot is still moving.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: state },
      { name: 'start_handoff_shot', description: 'Start a mouse-equivalent shot for the current player, accepting the handover if needed. Direction is a vector; length 8–150 controls power. Returns after launch; read match state after movement settles for points.', inputSchema: { type: 'object', properties: { puckId: { type: 'integer', minimum: 0, maximum: 6 }, dx: { type: 'number' }, dy: { type: 'number' } }, required: ['puckId', 'dx', 'dy'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: (input: unknown) => {
        const v = input as { puckId?: unknown; dx?: unknown; dy?: unknown } | null;
        if (!v || typeof v.puckId !== 'number' || !Number.isInteger(v.puckId) || typeof v.dx !== 'number' || typeof v.dy !== 'number' || !Number.isFinite(v.dx) || !Number.isFinite(v.dy) || !Number.isFinite(Math.hypot(v.dx,v.dy)) || Math.hypot(v.dx,v.dy) < 8) throw new Error('Provide a legal puckId and finite shot vector of length at least 8.');
        const g = engine.current, puck = g.pucks.find(p => p.id === v.puckId);
        if (!puck || puck.owner !== g.player || !['ready','handover'].includes(g.phase)) throw new Error('That puck cannot be shot in the current turn.');
        if (g.phase === 'handover') g.phase = 'ready';
        if (!shoot(v.puckId, v.dx, v.dy)) throw new Error('Shot was not accepted.');
        return { started: true, ...state() };
      } }
    ];
    for (const definition of definitions) { try { void Promise.resolve(registry.registerTool(definition, { signal: life.signal })).catch(error => console.warn('Handoff tool registration failed', error)); } catch (error) { console.warn('Handoff tool registration failed', error); } }
    return () => life.abort();
  }, []);

  const point = (e: React.PointerEvent<SVGSVGElement>) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    return new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
  };
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || aimRef.current || engine.current.phase !== 'ready') return;
    const q = point(e); if (!q) return;
    const p = engine.current.pucks.find(p => p.owner === engine.current.player && Math.hypot(q.x - p.x, q.y - p.y) < PUCK + 9);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId); changeAim({ id: p.id, x: q.x, y: q.y, startX: q.x, startY: q.y, pointerId: e.pointerId }); setSelected(null);
  };
  const up = (e: React.PointerEvent<SVGSVGElement>) => {
    const a = aimRef.current; if (!a || a.pointerId !== e.pointerId) return;
    const p = engine.current.pucks.find(p => p.id === a.id)!;
    const q = point(e); if (q) shoot(p.id, a.startX - q.x, a.startY - q.y);
    changeAim(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const rematch = () => { engine.current = createGame((1 - engine.current.starter) as Player); changeAim(null); setSelected(null); refresh(); };
  const ready = () => { if (engine.current.phase === 'handover') { engine.current.phase = 'ready'; refresh(); } };
  const keyboard = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { changeAim(null); setSelected(null); return; }
    if (selected === null || game.phase !== 'ready') return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
    if (e.key === 'ArrowLeft') setAngle(a => a - Math.PI / 36);
    if (e.key === 'ArrowRight') setAngle(a => a + Math.PI / 36);
    if (e.key === 'ArrowUp') setPower(p => Math.min(150, p + 10));
    if (e.key === 'ArrowDown') setPower(p => Math.max(10, p - 10));
    if (e.key === ' ') shoot(selected, Math.cos(angle) * power, Math.sin(angle) * power);
  };

  const chosen = game.pucks.find(p => p.id === (aim?.id ?? selected));
  let dx = 0, dy = 0;
  if (chosen && aim) { dx = aim.startX - aim.x; dy = aim.startY - aim.y; }
  else if (chosen) { dx = Math.cos(angle) * power; dy = Math.sin(angle) * power; }
  const length = Math.hypot(dx, dy), fraction = Math.min(length / 150, 1);
  const nx = length ? dx / length : 0, ny = length ? dy / length : 0;
  const recipient = (1 - game.player) as Player;
  const danger = game.pucks.filter(p => p.owner === recipient && inZone(p)).length;
  const winner = game.scores[0] === game.scores[1] ? null : game.scores[0] > game.scores[1] ? 0 : 1;

  return <main onKeyDown={keyboard}>
    <header className="topbar"><div className="brand">handoff<span>↗</span></div><div className="edition">A GAME FOR TWO <span> / </span> PROTOTYPE 01</div><a href="#rules">How to play <span>↘</span></a></header>
    <section className="game-layout" aria-label="Handoff game">
      <aside className="sidebar">
        <p className="eyebrow">THE TABLE IS SHARED.</p>
        <h1>Every shot<br/>changes sides.</h1>
        <p className="intro">The puck you shoot becomes theirs.<br/>Leave them a problem.</p>
        <div className="scoreboard" aria-label="Score">
          {names.map((name, i) => <div key={name} className={`score ${game.player === i ? 'active' : ''}`} style={{ '--player': colors[i] } as React.CSSProperties}><div className="score-name"><span className="player-mark">{i + 1}</span>{name}<span className="score-turn">{game.player === i && game.phase !== 'over' ? 'TO SHOOT' : ''}</span></div><strong>{game.scores[i]}<small> points</small></strong><div className="shot-dots" aria-label={`${Math.floor(game.shots / 2) + (game.shots % 2 && game.starter === i ? 1 : 0)} of 10 shots used`}>{Array.from({length:10}, (_, n) => <i key={n} className={n < Math.floor(game.shots / 2) + (game.shots % 2 && game.starter === i ? 1 : 0) ? 'used' : ''}/>)}</div></div>)}
        </div>
        <div className="turn-info" aria-live="polite" aria-atomic="true">
          <p className="eyebrow">{game.phase === 'over' ? 'MATCH COMPLETE' : `SHOT ${Math.min(game.shots + 1, 20)} OF 20`}</p>
          <h2 style={{ color: colors[game.player] }}>{game.phase === 'over' ? winner === null ? 'A draw.' : `${names[winner]} wins.` : game.phase === 'moving' ? 'Let it settle.' : `${names[game.player]} to play.`}</h2>
          <p>{game.phase === 'moving' ? 'The shooting puck changes hands when it stops.' : game.shots ? game.message : 'Choose one of your four pucks. Pull back and release.'}</p>
          {game.phase === 'handover' && <button className="primary-button" onClick={ready}>{names[game.player]}, take your shot <span>→</span></button>}
          {game.phase === 'over' && <button className="primary-button" onClick={rematch}>Play again · swap the start <span>↗</span></button>}
          {game.phase === 'ready' && <div className="stakes">{danger ? `${names[recipient]} will score ${danger} unless you move their pucks out.` : 'Your opponent scores after your shot. Keep their pucks out of the center.'}</div>}
        </div>
        <p className="local-note">Two people. One mouse. Ten shots each.</p>
      </aside>
      <div className="table-wrap">
        <div className="table-label"><span><i className={game.phase === 'moving' ? 'busy' : ''}/>{game.phase === 'moving' ? 'IN MOTION' : game.phase === 'over' ? 'FINAL POSITION' : 'THE SHARED TABLE'}</span><span>NO PUCK STAYS YOURS FOREVER</span></div>
        <svg ref={svg} className={`table ${game.phase}`} viewBox="0 0 720 720" role="group" aria-label="Circular physics table. Drag your colored puck backward and release to shoot. Pucks in the central circle score for their owner after the opponent shoots." onPointerDown={down} onPointerMove={e => { const a = aimRef.current; if (a && a.pointerId === e.pointerId) { const q = point(e); if(q) changeAim({...a,x:q.x,y:q.y}); } }} onPointerUp={up} onPointerCancel={e => { if (aimRef.current?.pointerId === e.pointerId) changeAim(null); }} onLostPointerCapture={e => { if (aimRef.current?.pointerId === e.pointerId) changeAim(null); }}>
          <defs><radialGradient id="felt"><stop offset="0" stopColor="#1b3337"/><stop offset="1" stopColor="#112327"/></radialGradient><radialGradient id="light"><stop offset="0" stopColor="#dcfaff" stopOpacity=".07"/><stop offset="1" stopColor="#dcfaff" stopOpacity=".02"/></radialGradient><filter id="shadow" x="-50%" y="-50%" width="200%" height="220%"><feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity=".55"/></filter></defs>
          <circle cx={CENTER} cy={CENTER} r="339" fill="#09181d" stroke="#30434a"/>
          <circle cx={CENTER} cy={CENTER} r="328" fill="none" stroke="#1f353d" strokeWidth="12"/>
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="url(#felt)" stroke="#65828b" strokeWidth="2"/>
          {Array.from({length:48},(_,i)=>{const a=i*Math.PI/24;return <line key={i} x1={360+Math.cos(a)*322} y1={360+Math.sin(a)*322} x2={360+Math.cos(a)*(i%4===0?329:325)} y2={360+Math.sin(a)*(i%4===0?329:325)} stroke="#71848a" opacity=".55"/>;})}
          <circle cx="360" cy="360" r="236" stroke="#71878d" strokeDasharray="2 10" opacity=".2" fill="none"/>
          <circle cx="360" cy="360" r={ZONE} fill="url(#light)" stroke="#a6c9cc" strokeDasharray="4 5" opacity=".7"/>
          <path d="M352 360h16M360 352v16" stroke="#c8e3e4" opacity=".25"/>
          <text x="360" y="326" textAnchor="middle" className="zone-label">THE LIGHT</text>
          <text x="360" y="404" textAnchor="middle" className="zone-sublabel">1 POINT / PUCK</text>
          {game.pucks.map(p => <g key={p.id} role="button" tabIndex={p.owner === game.player && game.phase === 'ready' ? 0 : -1} aria-disabled={p.owner !== game.player || game.phase !== 'ready'} aria-label={`Puck ${String.fromCharCode(65+p.id)}, ${names[p.owner]}, ${inZone(p) ? 'in scoring circle' : 'outside scoring circle'}. Enter to select; arrow keys aim and power; Space shoots.`} onKeyDown={e=>{if(e.key==='Enter' && p.owner===game.player && game.phase==='ready'){e.preventDefault();setSelected(p.id);setAngle(Math.atan2(360-p.y,360-p.x));}}} className={`puck ${p.owner === game.player && game.phase === 'ready' ? 'playable' : ''}`} transform={`translate(${p.x} ${p.y})`}>
            {(inZone(p) || chosen?.id === p.id) && <circle r="26" fill="none" stroke={colors[p.owner]} strokeWidth="1" opacity=".65"/>}
            <circle r={PUCK} fill={colors[p.owner]} filter="url(#shadow)"/>
            <circle r="14" stroke="#081c25" strokeOpacity=".3" fill="none"/>
            <text textAnchor="middle" y="5" fill="#092027" fontSize="14" fontWeight="800">{String.fromCharCode(65+p.id)}</text>
            <path d={p.owner===0?'M-4 24h8':'M-7 24h5M2 24h5'} stroke={colors[p.owner]} strokeWidth="2"/>
            {game.phase === 'moving' && p.id === game.fired && <circle r="25" stroke={colors[recipient]} strokeDasharray="3 4" fill="none"/>}
          </g>)}
          {chosen && length > 0 && <g pointerEvents="none"><line x1={chosen.x} y1={chosen.y} x2={chosen.x+nx*(38+fraction*120)} y2={chosen.y+ny*(38+fraction*120)} stroke={colors[game.player]} strokeWidth="2" strokeDasharray="5 5"/><circle cx={chosen.x-nx*fraction*150} cy={chosen.y-ny*fraction*150} r="7" stroke={colors[game.player]} fill="#102127"/><line x1={chosen.x-nx*fraction*150} y1={chosen.y-ny*fraction*150} x2={chosen.x} y2={chosen.y} stroke={colors[game.player]} opacity=".4"/><text x={chosen.x} y={chosen.y-40} textAnchor="middle" fill={colors[game.player]} fontSize="14">{Math.round(fraction*100)}% POWER</text></g>}
        </svg>
        <div className="table-footer"><span>↖ &nbsp; Pull back to aim. Release to shoot.</span><span>Esc cancels</span></div>
      </div>
    </section>
    <section id="rules" className="rules"><div className="rules-heading"><p className="eyebrow">LEARN IT IN A MINUTE</p><h2>Use it. Lose it.<br/>Make that matter.</h2><p>Aim with the mouse. Think about the next pair of hands.</p></div><div className="rule-list"><article><span>01</span><div><h3>Shoot one of your pucks.</h3><p>Drag backward from a puck and release. Direction sets the aim; distance sets the power. Pucks collide, rebound off the rail, and slow to a stop. No spin, pockets, or random forces.</p></div></article><article><span>02</span><div><h3>Give that puck to your opponent.</h3><p>Only the puck you shot changes sides, after everything settles. Every other puck keeps its owner, even if hit. Your opponent can use the gift on their next turn.</p></div></article><article><span>03</span><div><h3>Then your opponent scores.</h3><p>They get one point for each of their puck centers on or inside the light, including the puck you just gave them. Pucks stay on the table and can score again. Your own pucks must survive their shot to earn points.</p></div></article><article><span>04</span><div><h3>Ten shots each. Highest score wins.</h3><p>Alternate turns, with no passes or extra shots. Finish all twenty shots; ties are draws. Seven pucks start equally spaced around the outer dotted circle, alternating ownership: four for the starter, three for the other player. Every turn starts with four pucks for the shooter. A rematch swaps who starts. A tiny drag cancels, so releasing accidentally won’t spend a turn.</p></div></article></div></section>
    <footer><span>HANDOFF · AN EXPERIMENT IN GIVING AWAY CONTROL</span><span>Balance and fun are still being tested.</span></footer>
  </main>;
}
