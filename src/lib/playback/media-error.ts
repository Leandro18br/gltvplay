export const MEDIA_WAIT_TIMEOUT_MS = 20000;
export function mediaErrorMessage(code?: number) {
  if (code === 1) return "O carregamento do vídeo foi interrompido. Tente novamente.";
  if (code === 2) return "Falha de conexão ao carregar o vídeo. A origem pode estar indisponível ou negar o acesso.";
  if (code === 3) return "Não foi possível decodificar o vídeo. O formato ou codec pode ser incompatível com este navegador.";
  if (code === 4) return "Fonte não suportada ou inacessível. Verifique o formato, o certificado HTTPS e as permissões do provedor.";
  return "Não foi possível carregar o vídeo. Verifique a conexão e tente novamente.";
}