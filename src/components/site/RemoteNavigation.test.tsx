import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteNavigation } from './RemoteNavigation';
const state = vi.hoisted(() => ({ back:vi.fn(), subscriptions:new Map<string,()=>void>() }));
const router = { history:{canGoBack:()=>true,back:state.back},subscribe:(key:string,fn:()=>void)=>{state.subscriptions.set(key,fn);return ()=>state.subscriptions.delete(key);} };
vi.mock('@tanstack/react-router',()=>({useRouter:()=>router}));
function setup() {
  render(<><RemoteNavigation /><main><button id="one">One</button><button id="two">Two</button><input aria-label="Search" /></main></>);
  const one=document.getElementById('one'),two=document.getElementById('two');
  if (!one || !two) throw new Error('Missing controls');
  one.getBoundingClientRect=()=>({left:0,top:0,right:100,bottom:100,width:100,height:100,x:0,y:0,toJSON:()=>({})});
  two.getBoundingClientRect=()=>({left:200,top:0,right:300,bottom:100,width:100,height:100,x:200,y:0,toJSON:()=>({})});
  return {one,two};
}
beforeEach(()=>{vi.clearAllMocks();window.history.replaceState({},'', '/');});
afterEach(cleanup);
describe('Global remote focus behavior',()=>{
  it('arrows move real focus without activating buttons',()=>{
    const {one,two}=setup(),click=vi.fn();two.addEventListener('click',click);one.focus();fireEvent.keyDown(one,{key:'ArrowRight'});
    expect(document.activeElement).toBe(two);expect(click).not.toHaveBeenCalled();
  });
  it('OK activates a semantic button exactly once',()=>{
    const {one}=setup(),click=vi.fn();one.addEventListener('click',click);one.focus();fireEvent.keyDown(one,{key:'OK'});expect(click).toHaveBeenCalledTimes(1);
  });
  it('Backspace goes back once and held repeats do not navigate',()=>{
    const {one}=setup();one.focus();fireEvent.keyDown(one,{key:'Backspace'});fireEvent.keyDown(one,{key:'Backspace',repeat:true});expect(state.back).toHaveBeenCalledTimes(1);
  });
  it('does not intercept Backspace while editing',()=>{
    setup();const input=document.querySelector('input');if(!input)throw new Error('Missing input');input.focus();fireEvent.keyDown(input,{key:'Backspace'});expect(state.back).not.toHaveBeenCalled();expect(document.activeElement).toBe(input);
  });
  it('leaves slider arrows to the media widget',()=>{
    const {one,two}=setup();one.setAttribute('role','slider');one.focus();const allowed=fireEvent.keyDown(one,{key:'ArrowRight'});expect(allowed).toBe(true);expect(document.activeElement).not.toBe(two);
  });
  it('pointer input exits remote mode without removing native focus',()=>{
    const {one}=setup();one.focus();fireEvent.keyDown(one,{key:'ArrowDown'});fireEvent.pointerDown(one);expect(document.documentElement.dataset['remoteNavigation']).toBeUndefined();expect(document.activeElement).toBe(one);
  });
  it('does not change staff-area key behavior',()=>{
    window.history.replaceState({},'', '/admin');const {one,two}=setup();one.focus();fireEvent.keyDown(one,{key:'ArrowRight'});expect(document.activeElement).not.toBe(two);
  });
});