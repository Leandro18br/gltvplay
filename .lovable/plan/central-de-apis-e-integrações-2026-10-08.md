# Central de APIs e Integrações

Este módulo é grande. O plano abaixo divide o trabalho em etapas que podem ser entregues e testadas uma de cada vez, sem quebrar o que já existe (Embed, Home, Importação TMDB, player).

## O que o administrador terá

1. **Menu "APIs e Integrações"** no painel, com um dashboard: APIs cadastradas, ativas e inativas, último teste, status (Conectada / Erro / Inativa / Nunca testada), tipo, número de requisições e último erro. Botão "+ Adicionar API".
2. **Cadastro de API**: nome, descrição, tipo (Catálogo / Player de Filme / Player de Série), URL base, autenticação (sem autenticação, API Key na URL, API Key no header, Bearer Token, header personalizado), headers e parâmetros personalizados, método padrão (GET/POST), prioridade, limite de requisições por minuto, tempo de cache (5 min, 15 min, 1 h, 6 h, 24 h, 7 dias) e "Buscar player automaticamente". Depois de salvas, as chaves aparecem só como `************ABCD`. Botão "Testar conexão".
3. **Endpoints** de cada API: nome, descrição, tipo (buscar filmes, buscar séries, filme por ID, série por ID, player de filme, player de episódio, temporadas, episódios), método, caminho com variáveis (`{tmdb_id}`, `{imdb_id}`, `{movie_id}`, `{series_id}`, `{season}`, `{episode}`, `{title}`, `{year}`), headers, query e body.
4. **Mapeamento da resposta** por endpoint: caminhos como `data.player`, `embed_url`, `results[0].url`. Nos endpoints de catálogo: caminho da lista de resultados e de cada campo (título, título original, sinopse, poster, backdrop, ano, duração, nota, gêneros, ID externo, TMDB ID).
5. **Testador de API**: informar TMDB ID, título, ano, ID da série, temporada e episódio, depois "Executar teste". Mostra status HTTP, tempo, JSON completo, o player encontrado e a URL identificada. Erros aparecem claramente: 400, 401, 403, 404, 429, 500, tempo esgotado e resposta inválida.
6. **"Buscar Player pela API"** no cadastro de filme e de episódio. Tenta as APIs em ordem de prioridade (principal, depois secundária, depois reserva), mostra a prévia e deixa salvar. Um link de iframe vira Embed. Um código `<iframe>` tem só o endereço aproveitado. Um link .m3u8 vira HLS. O player do episódio fica salvo somente naquele episódio.
7. **Vários players por conteúdo**: lista com nome, tipo, URL, prioridade, ativo/inativo e ordem. Os campos atuais de fonte principal continuam funcionando.
8. **"Importar pela API"** na tela de Filmes e de Séries: busca por título, ano ou ID externo. Os resultados aparecem em cards (poster, título, ano, tipo, nota) com o botão "Importar". Nada é duplicado. Se a busca automática estiver ligada, o player é buscado logo depois. Nas séries, as temporadas e os episódios são criados e cada episódio recebe o seu próprio player, respeitando o limite de requisições.
9. **Histórico de requisições**: API, endpoint, data e hora, conteúdo consultado, status, tempo e sucesso/erro. Nunca guarda chaves nem tokens.

## No site público

Ao clicar em "Assistir", o player principal abre. Se houver mais de um player, aparecem os botões "Servidor 1", "Servidor 2", "Servidor 3". Nas séries, a escolha de temporada e episódio carrega exatamente o player daquele episódio.

## Segurança

- As chaves ficam guardadas numa área do banco que nem o navegador nem os editores conseguem ler. Só o servidor usa as chaves, e só depois de confirmar que quem pediu é administrador.
- Toda chamada externa acontece no servidor. Ela só vai para o domínio da URL base cadastrada, sempre com HTTPS. Endereços internos ou privados (localhost, IPs de rede local) são bloqueados, e não existe campo de "URL livre". Isso impede que o sistema vire um proxy aberto.
- Tem limite de tempo por requisição, limite por minuto em cada API e um tamanho máximo de resposta.
- O sistema não tenta contornar DRM, verificação anti-robô, X-Frame-Options, CSP ou bloqueios de incorporação.
- Os players encontrados continuam passando pela lista de domínios autorizados para Embed.

## Detalhes técnicos

Tabelas novas: `api_integrations`, `api_endpoints` (o mapeamento da resposta fica em colunas/jsonb do endpoint, no lugar de uma tabela `api_response_mappings` separada), `api_credentials` (sem acesso para usuários comuns, editores e administradores. Só o servidor lê, depois de checar `is_admin`), `api_request_logs` e `api_response_cache` (chave = API + endpoint + variáveis, com TTL).

Players: a tabela `playback_sources` atual é reaproveitada no lugar de `movie_sources` e `episode_sources`. Ela ganha as colunas `label`, `api_integration_id` e `external_ref`. Ela já separa os players por `content_kind` + `content_id`, então cada episódio já tem os seus. Assim não ficam dados duplicados e o Embed e o player continuam funcionando como hoje. Uma nova função, `get_playback_sources`, devolve a lista ordenada de players ativos para usuários logados e ativos, e alimenta os botões de servidor.

A importação deduplica por (`external_source`, `external_id`). O provedor TMDB atual continua funcionando ao lado das APIs configuradas.

Etapas: (1) banco + menu + cadastro, credenciais e endpoints; (2) motor de requisição, mapeamento, testador, cache e logs; (3) busca de player, vários players e servidores no site; (4) importação + busca automática + fallback; (5) testes de ponta a ponta. Os testes automáticos cobrem a troca de variáveis, a leitura dos caminhos da resposta, a identificação do tipo de player e o bloqueio de endereços internos.

Limitação do teste: sem uma API externa real do seu lado, o teste de ponta a ponta usa uma API pública que permita esse uso. Depois você cadastra as suas próprias APIs pelo painel.
