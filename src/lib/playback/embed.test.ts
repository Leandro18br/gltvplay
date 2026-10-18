import { describe, it, expect } from "vitest";
import { domainSchema, normalizeEmbed, normalizePlayback, emptyPlayback, embedHost, looksLikePlayerPage } from "./embed";

const policy={domains:["youtube.com","youtube-nocookie.com","player.vimeo.com"],allowIframe:true};
describe("authorized embeds",()=>{
  it("preserves provider query and fragment for both URL and authorized Embed",()=>{
    const url="https://youtube.com/play/item?token=value#.mp4";
    expect(normalizeEmbed(url,policy)).toBe(url);
    expect(normalizePlayback({...emptyPlayback,type:"url",input:url},policy)).toBe(url);
  });
  it("accepts an authorized iframe URL",()=>{expect(normalizeEmbed("https://youtube-nocookie.com/embed/123",policy)).toBe("https://youtube-nocookie.com/embed/123");});
  it("extracts a single iframe without rendering its HTML",()=>{expect(normalizeEmbed('<iframe src="https://player.vimeo.com/video/123" allowfullscreen></iframe>',policy)).toBe("https://player.vimeo.com/video/123");});
  it("refuses iframe code when disabled",()=>{expect(()=>normalizeEmbed('<iframe src="https://youtube.com/embed/123"></iframe>',{...policy,allowIframe:false})).toThrow("desabilitado");});
  it("allows authorized domains and their subdomains only",()=>{expect(()=>normalizeEmbed("https://youtube.com.attacker.org/embed/123",policy)).toThrow("não autorizado");expect(()=>normalizeEmbed("https://notyoutube.com/embed/123",policy)).toThrow("não autorizado");expect(normalizeEmbed("https://www.youtube.com/embed/123",policy)).toBe("https://www.youtube.com/embed/123");});
  it("refuses scripts, arbitrary HTML and event handlers",()=>{for(const html of ['<script>alert(1)</script>','<iframe src="https://youtube.com/embed/123"></iframe><div>x</div>','<iframe src="https://youtube.com/embed/123" onload="alert(1)"></iframe>','<iframe src="https://youtube.com/embed/123" srcdoc="test"></iframe>'])expect(()=>normalizeEmbed(html,policy)).toThrow();});
  it("only allows HTTPS embeds without credentials or custom ports",()=>{for(const u of ["javascript:alert(1)","http://youtube.com/embed/123","https://name:pass@youtube.com/embed/123","https://youtube.com:8080/embed/123"])expect(()=>normalizeEmbed(u,policy)).toThrow();});
  it("validates domains against local addresses and invalid formats",()=>{for(const d of ["localhost","127.0.0.1","https://youtube.com","example.local","*.youtube.com","youtube.com/path"])expect(domainSchema.safeParse(d).success).toBe(false);expect(domainSchema.parse(" Player.Vimeo.com ")).toBe("player.vimeo.com");});
  it("does not require a source for no playback",()=>{expect(normalizePlayback(emptyPlayback,policy)).toBeNull();});
  it("preserves URL and HLS sources",()=>{expect(normalizePlayback({...emptyPlayback,type:"hls",input:"https://example.com/main.m3u8"},policy)).toBe("https://example.com/main.m3u8");expect(normalizePlayback({...emptyPlayback,type:"url",input:"https://example.com/movie.mp4"},policy)).toBe("https://example.com/movie.mp4");});
  it("reads the host of a URL or iframe code for admin hints",()=>{expect(embedHost("https://Player.Vimeo.com/video/1")).toBe("player.vimeo.com");expect(embedHost('<iframe src="https://youtube.com/embed/1"></iframe>')).toBe("youtube.com");expect(embedHost("texto")).toBeNull();});
  it("flags player pages saved as Vídeo/URL",()=>{expect(looksLikePlayerPage("https://site.com/filme/24099")).toBe(true);expect(looksLikePlayerPage("https://site.com/movie.mp4")).toBe(false);});
  it("limits normalized embed URL length to 2048",()=>{expect(()=>normalizeEmbed("https://youtube.com/"+"a".repeat(2048),policy)).toThrow();});
});
import { normalizePlayback as np2 } from "./embed";
describe("streambetter iframe code", () => {
  const code = `<iframe\n  src="https://streambetter.shop/filme/20558"\n  width="640"\n  height="360"\n  frameborder="0"\n  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"\n  allowfullscreen\n></iframe>`;
  it("extracts the exact src from iframe code", () => {
    expect(np2({ type: "embed", input: code, active: true, primary: true }, { domains: ["streambetter.shop"], allowIframe: true })).toBe("https://streambetter.shop/filme/20558");
  });
  it("treats iframe code as embed even when typed as Vídeo/URL", () => {
    expect(np2({ type: "url", input: code, active: true, primary: true }, { domains: ["streambetter.shop"], allowIframe: true })).toBe("https://streambetter.shop/filme/20558");
  });
  it("accepts subdomains of an authorized domain but not other domains", () => {
    expect(np2({ type: "embed", input: "https://www.streambetter.shop/filme/1", active: true, primary: true }, { domains: ["streambetter.shop"], allowIframe: true })).toBe("https://www.streambetter.shop/filme/1");
    expect(() => np2({ type: "embed", input: "https://evilstreambetter.shop/x", active: true, primary: true }, { domains: ["streambetter.shop"], allowIframe: true })).toThrow();
  });
});
