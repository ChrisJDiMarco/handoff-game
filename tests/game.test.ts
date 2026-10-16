import { test } from 'node:test';
import assert from 'node:assert/strict';
import {createGame,launch,tick,settle,CENTER,RADIUS,PUCK,inZone} from '../lib/game.ts';

test('invalid and tiny shots do not change state',()=>{
  const g=createGame(), initial=JSON.stringify(g);
  for(const [id,x,y] of [[1,150,0],[0,0,0],[0,7,0],[0,NaN,5],[0,Infinity,0],[99,150,0]]) assert.equal(launch(g,id,x,y),false);
  assert.equal(JSON.stringify(g),initial);
});
test('a puck given away in the light scores immediately for its recipient',()=>{
  const g=createGame(); g.pucks[0].x=360;g.pucks[0].y=360;
  assert(launch(g,0,10,0));settle(g);
  assert.equal(g.pucks[0].owner,1);assert.deepEqual(g.scores,[0,1]);assert.equal(g.player,1);assert.equal(g.phase,'handover');
  assert.equal(launch(g,1,100,0),false);
});
test('each player always has four legal pucks, and gets exactly ten scoring events',()=>{
  for(const starter of [0,1] as const){
    const g=createGame(starter), payouts=[0,0], shots=[0,0];
    for(let i=0;i<20;i++){
      if(g.phase==='handover')g.phase='ready';
      assert.equal(g.pucks.filter(p=>p.owner===g.player).length,4);
      const p=g.pucks.find(p=>p.owner===g.player)!;
      const owners=g.pucks.map(p=>p.owner),recipient=1-g.player;
      shots[g.player]++;payouts[recipient]++;
      assert(launch(g,p.id,Math.cos(i*2.4)*150,Math.sin(i*2.4)*150));settle(g);
      assert.equal(g.pucks[p.id].owner,recipient);
      for(const other of g.pucks.filter(q=>q.id!==p.id))assert.equal(other.owner,owners[other.id]);
      assert.equal(g.phase,i===19?'over':'handover');
    }
    assert.deepEqual(shots,[10,10]);assert.deepEqual(payouts,[10,10]);assert.equal(g.shots,20);
    const before=JSON.stringify(g);assert.equal(launch(g,0,100,0),false);assert.equal(JSON.stringify(g),before);
  }
});
test('200 maximum-power shots stay finite, bounded, non-overlapping, and settle',()=>{
  let g=createGame();
  for(let i=0;i<200;i++){
    if(g.phase==='over')g=createGame();if(g.phase==='handover')g.phase='ready';
    const own=g.pucks.filter(p=>p.owner===g.player),p=own[i%own.length];
    assert(launch(g,p.id,Math.cos(i*1.618)*150,Math.sin(i*1.618)*150));
    let steps=0;
    while(g.phase==='moving' && steps++<2000){
      tick(g);
      for(const p of g.pucks){assert(Number.isFinite(p.x+p.y+p.vx+p.vy));assert(Math.hypot(p.x-CENTER,p.y-CENTER)<=RADIUS-PUCK+.01);}
    }
    assert(steps<2000);
    for(let a=0;a<7;a++)for(let b=a+1;b<7;b++)assert(Math.hypot(g.pucks[a].x-g.pucks[b].x,g.pucks[a].y-g.pucks[b].y)>=PUCK*2-.05);
  }
});
test('direct contact passes motion but not ownership to the struck puck',()=>{
  const g=createGame();g.pucks[0].x=550;g.pucks[0].y=360;g.pucks[1].x=450;g.pucks[1].y=360;
  const initial=g.pucks[1].x;launch(g,0,-80,0);settle(g);
  assert(g.pucks[1].x<initial-50);assert.equal(g.pucks[1].owner,1);assert.equal(g.pucks[0].owner,1);
});
