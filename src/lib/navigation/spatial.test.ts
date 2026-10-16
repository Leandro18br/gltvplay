import { afterEach, describe, expect, it } from 'vitest';
import { directionScore, directionalTarget, isEditing, navigable, remoteKey } from './spatial';
const rect = (x: number, y: number) => ({ left:x, top:y, right:x+100, bottom:y+100, width:100, height:100, x,y,toJSON:()=>({}) });
function control(x: number, y: number, tag = 'button') {
  const el = document.createElement(tag);
  if (tag === 'a') { el.setAttribute('href','/movie'); el.dataset['remoteId'] = `${x}`; }
  el.getBoundingClientRect = () => rect(x,y);
  document.body.append(el);
  return el;
}
afterEach(() => { document.body.replaceChildren(); });
describe('Directional remote rules', () => {
  it.each(['up','down','left','right'] as const)('selects the actual %s direction', direction => {
    const from = control(200,200);
    const positions = {up:[200,0],down:[200,400],left:[0,200],right:[400,200]};
    const pos = positions[direction];
    const target = control(pos?.[0] ?? 0,pos?.[1] ?? 0);
    expect(directionalTarget(from,[from,target],direction)).toBe(target);
  });
  it('prefers vertically aligned sections over a diagonal item', () => {
    expect(directionScore(rect(0,0),rect(0,300),'down')).toBeLessThan(directionScore(rect(0,0),rect(500,120),'down'));
  });
  it('keeps focus at the horizontal row boundary without wrapping', () => {
    const first = control(0,0,'a'), second = control(150,0,'a'), outside = control(300,0,'a');
    const row = document.createElement('div'); row.dataset['remoteRow']=''; document.body.append(row); row.append(first,second);
    expect(directionalTarget(second,[first,second,outside],'right')).toBeUndefined();
    expect(directionalTarget(second,[first,second,outside],'left')).toBe(first);
  });
  it('moves between cards rather than their secondary watchlist action', () => {
    const first = control(0,0,'a'), next = control(150,0,'a'), action = control(70,0);
    const row = document.createElement('div'); row.dataset['remoteRow']=''; document.body.append(row); row.append(first,next,action);
    expect(directionalTarget(first,[first,next,action],'right')).toBe(next);
  });
  it('excludes hidden, disabled, inert and negative tabindex controls', () => {
    const available = control(0,0), disabled=control(100,0), inert=control(200,0), negative=control(300,0), hidden=control(400,0);
    disabled.setAttribute('disabled',''); inert.setAttribute('inert',''); negative.tabIndex=-1; hidden.setAttribute('aria-hidden','true');
    expect(navigable(document)).toEqual([available]);
  });
  it.each(['input','textarea','select'])('preserves editing in %s', tag => expect(isEditing(control(0,0,tag))).toBe(true));
  it('normalizes OK and Select to Enter', () => {
    expect(remoteKey({key:'OK',keyCode:0})).toBe('Enter');
    expect(remoteKey({key:'Select',keyCode:0})).toBe('Enter');
  });
  it('recognizes TV legacy back codes and directional codes', () => {
    expect(remoteKey({key:'Unidentified',keyCode:10009})).toBe('Escape');
    expect(remoteKey({key:'Unidentified',keyCode:461})).toBe('Escape');
    expect(remoteKey({key:'Unidentified',keyCode:22})).toBe('ArrowRight');
  });
});