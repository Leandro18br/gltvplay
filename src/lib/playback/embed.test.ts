import { describe, it, expect } from "vitest";
import { domainSchema, normalizeEmbed, normalizePlayback, emptyPlayback } from "./embed";

const policy={domains:["youtube.com","youtube-nocookie.com","player.vimeo.com"],allowIframe:true};
describe("authorized embeds",()=>{
  it("accepts an authorized iframe URL",()=>{expect(normalizeEmbed("https://youtube-nocookie.com/embed/123",policy)).toBe("https://youtube-nocookie.com/embed/123");});
  it("extracts a single iframe without rendering its HTML",()=>{expect(normalizeEmbed('<iframe src="https://player.vimeo.com/video/123" allowfullscreen></iframe>',policy)).toBe("https://player.vimeo.com/video/123");});
  it("refuses iframe code when disabled",()=>{expect(()=>normalizeEmbed('<iframe src="https://youtube.com/embed/123"></iframe>',{...policy,allowIframe:false})).toThrow("desabilitado");});
  it("requires exact allowed domains, not a suffix match",()=>{expect(()=>normalizeEmbed("https://youtube.com.attacker.org/embed/123",policy)).toThrow("não autorizado");expect(()=>normalizeEmbed("https://www.youtube.com/embed/123",policy)).toThrow("não autorizado");});
  it("refuses scripts, arbitrary HTML and event handlers",()=>{for(const html of ['<script>alert(1)</script>','<iframe src="https://youtube.com/embed/123"></iframe><div>x</div>','<iframe src="https://youtube.com/embed/123" onload="alert(1)"></iframe>','<iframe src="https://youtube.com/embed/123" srcdoc="test"></iframe>'])expect(()=>normalizeEmbed(html,policy)).toThrow();});
  it("only allows HTTPS embeds without credentials or custom ports",()=>{for(const u of ["javascript:alert(1)","http://youtube.com/embed/123","https://name:pass@youtube.com/embed/123","https://youtube.com:8080/embed/123"])expect(()=>normalizeEmbed(u,policy)).toThrow();});
  it("validates domains against local addresses and invalid formats",()=>{for(const d of ["localhost","127.0.0.1","https://youtube.com","example.local","*.youtube.com","youtube.com/path"])expect(domainSchema.safeParse(d).success).toBe(false);expect(domainSchema.parse(" Player.Vimeo.com ")).toBe("player.vimeo.com");});
  it("does not require a source for no playback",()=>{expect(normalizePlayback(emptyPlayback,policy)).toBeNull();});
  it("preserves URL and HLS sources",()=>{expect(normalizePlayback({...emptyPlayback,type:"hls",input:"https://example.com/main.m3u8"},policy)).toBe("https://example.com/main.m3u8");expect(normalizePlayback({...emptyPlayback,type:"url",input:"https://example.com/movie.mp4"},policy)).toBe("https://example.com/movie.mp4");});
  it("limits normalized embed URL length to 2048",()=>{expect(()=>normalizeEmbed("https://youtube.com/"+"a".repeat(2048),policy)).toThrow();});
});