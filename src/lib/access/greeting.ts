// Gendered greeting only for names we can classify with confidence; otherwise neutral.
const FEMALE = new Set("maria ana juliana fernanda patricia aline camila amanda bruna jessica leticia larissa mariana gabriela beatriz vanessa luana adriana sandra simone daniela carla julia giovanna isabela isabella sophia sofia alice laura manuela valentina heloisa lara rafaela tatiana renata claudia luciana cristina priscila natalia raquel francisca antonia rosa vitoria debora elaine eliane fabiana marcia monica paula silvia tereza teresa helena clara cecilia lorena yasmin bianca carolina thais".split(" "));
const MALE = new Set("joao jose antonio francisco carlos paulo pedro lucas luiz luis marcos gabriel rafael daniel marcelo bruno eduardo felipe raimundo rodrigo manoel manuel mateus matheus andre fernando fabio leonardo gustavo guilherme leandro tiago thiago diego vitor victor sergio claudio ricardo roberto jorge alexandre marcio anderson julio cesar renato miguel arthur heitor davi bernardo enzo samuel henrique igor caio otavio murilo vinicius wellington wagner edson nelson".split(" "));

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function greetingFor(name: string | null | undefined): string {
  const n = (name ?? "").trim().replace(/\s+/g, " ");
  if (!n) return "Bem-vindo(a)!";
  const first = n.split(" ")[0] ?? n;
  const key = norm(first);
  if (FEMALE.has(key)) return `Bem-vinda, ${first}!`;
  if (MALE.has(key)) return `Bem-vindo, ${first}!`;
  return `Olá, ${first}!`;
}
