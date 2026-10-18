import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoPlayerFrame } from './VideoPlayerFrame';
import { MEDIA_WAIT_TIMEOUT_MS } from '@/lib/playback/media-error';
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); delete document.documentElement.dataset['remoteNavigation']; });
function setup() {
  const rendered = render(<VideoPlayerFrame title="Movie"><video /></VideoPlayerFrame>);
  const video = rendered.container.querySelector('video');
  if (!video) throw new Error('Missing media');
  Object.defineProperty(video,'duration',{value:120,configurable:true});
  video.currentTime=40; fireEvent.loadedMetadata(video); fireEvent.canPlay(video);
  return video;
}
describe('Native player remote controls',()=>{
  it('stalled media stops waiting and retry loads the same video',()=>{
    vi.useFakeTimers();
    const video=setup();
    const load=vi.spyOn(video,'load').mockImplementation(()=>{});
    vi.spyOn(video,'play').mockResolvedValue();
    fireEvent.waiting(video);
    act(()=>{vi.advanceTimersByTime(MEDIA_WAIT_TIMEOUT_MS);});
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.canPlay(video);
    act(()=>{vi.advanceTimersByTime(MEDIA_WAIT_TIMEOUT_MS);});
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('arrows on focused play do not trigger seek or playback',()=>{
    const video=setup(),play=vi.spyOn(video,'play').mockResolvedValue();
    const control=screen.getByRole('button',{name:'Reproduzir'});act(()=>control.focus());fireEvent.keyDown(control,{key:'ArrowRight'});
    expect(video.currentTime).toBe(40);expect(play).not.toHaveBeenCalled();
  });
  it('progress slider owns arrows without the parent adding a ten-second seek',()=>{
    const video=setup(),slider=screen.getByRole('slider',{name:'Progresso'});act(()=>slider.focus());fireEvent.keyDown(slider,{key:'ArrowRight'});
    expect(video.currentTime).toBeCloseTo(40.1);
  });
  it('explicit skip buttons still seek ten seconds',()=>{
    const video=setup();fireEvent.click(screen.getByRole('button',{name:'Avançar 10 segundos'}));expect(video.currentTime).toBe(50);
  });
  it('player region arrows in remote mode do not seek',()=>{
    const video=setup();document.documentElement.dataset['remoteNavigation']='true';fireEvent.keyDown(screen.getByRole('region'),{key:'ArrowLeft'});expect(video.currentTime).toBe(40);
  });
});