import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoPlayerFrame } from './VideoPlayerFrame';
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete document.documentElement.dataset['remoteNavigation']; });
function setup() {
  const rendered = render(<VideoPlayerFrame title="Movie"><video /></VideoPlayerFrame>);
  const video = rendered.container.querySelector('video');
  if (!video) throw new Error('Missing media');
  Object.defineProperty(video,'duration',{value:120,configurable:true});
  video.currentTime=40; fireEvent.loadedMetadata(video); fireEvent.canPlay(video);
  return video;
}
describe('Native player remote controls',()=>{
  it('arrows on focused play do not trigger seek or playback',()=>{
    const video=setup(),play=vi.spyOn(video,'play').mockResolvedValue();
    const control=screen.getByRole('button',{name:'Reproduzir'});control.focus();fireEvent.keyDown(control,{key:'ArrowRight'});
    expect(video.currentTime).toBe(40);expect(play).not.toHaveBeenCalled();
  });
  it('progress slider owns arrows without the parent adding a ten-second seek',()=>{
    const video=setup(),slider=screen.getByRole('slider',{name:'Progresso'});slider.focus();fireEvent.keyDown(slider,{key:'ArrowRight'});
    expect(video.currentTime).toBeCloseTo(40.1);
  });
  it('explicit skip buttons still seek ten seconds',()=>{
    const video=setup();fireEvent.click(screen.getByRole('button',{name:'Avançar 10 segundos'}));expect(video.currentTime).toBe(50);
  });
  it('player region arrows in remote mode do not seek',()=>{
    const video=setup();document.documentElement.dataset['remoteNavigation']='true';fireEvent.keyDown(screen.getByRole('region'),{key:'ArrowLeft'});expect(video.currentTime).toBe(40);
  });
});