# Gltvplay

Crie a base completa de uma plataforma moderna de streaming de filmes, séries e canais, com arquitetura profissional, escalável e otimizada.



O projeto terá DOIS ambientes totalmente integrados:



1. SITE PÚBLICO

2. PAINEL ADMINISTRATIVO (ADM)



O Painel ADM será responsável por controlar o conteúdo e as configurações da plataforma, enquanto o site público deverá receber e refletir automaticamente todas as alterações feitas pelo ADM.



IMPORTANTE:



- Não criar dados fictícios permanentes.

- Toda informação deverá ser armazenada no banco de dados.

- O site público deverá buscar os dados reais do banco.

- O ADM deverá conseguir criar, editar, excluir e organizar os conteúdos.

- Todas as alterações feitas no ADM devem aparecer no site público sem necessidade de alterar código.

- Criar arquitetura preparada para crescimento futuro.



DESIGN:



Criar uma identidade visual premium inspirada em grandes plataformas modernas de streaming, sem copiar elementos proprietários.



Paleta principal:



- Preto como cor predominante.

- Azul bebê como cor de destaque.

- Branco/cinza para textos secundários.

- Interface elegante, minimalista e moderna.

- Cards com bordas arredondadas.

- Animações suaves.

- Excelente hierarquia visual.



TECNOLOGIA:



Utilizar uma arquitetura moderna full-stack adequada para aplicação web.



Criar:



- Frontend público.

- Frontend administrativo.

- Backend/API.

- Banco de dados.

- Sistema de autenticação.

- Controle de permissões.

- Armazenamento de imagens.

- Sistema preparado para URLs de reprodução autorizadas.

- Sistema preparado para integração futura com APIs externas.



BANCO DE DADOS:



Criar estrutura para:



USUÁRIOS:



- id

- nome

- email

- senha protegida

- avatar

- status

- data de criação

- último acesso

- tipo de usuário



PERFIS:



- id

- usuário

- nome do perfil

- avatar

- preferências



FILMES:



- id

- título

- título original

- descrição

- poster

- backdrop

- trailer

- ano

- duração

- classificação indicativa

- qualidade

- idioma

- país

- status

- destaque

- data de criação

- data de atualização



SÉRIES:



- id

- título

- descrição

- poster

- backdrop

- trailer

- ano

- classificação

- status

- destaque



TEMPORADAS:



- id

- série

- número da temporada

- título

- poster



EPISÓDIOS:



- id

- temporada

- número do episódio

- título

- descrição

- thumbnail

- duração

- URL de reprodução autorizada

- data de lançamento

- status



CATEGORIAS:



- id

- nome

- slug

- descrição

- imagem

- status



GÊNEROS:



- id

- nome

- slug



CANAIS:



- id

- nome

- logo

- descrição

- categoria

- URL de transmissão autorizada

- status

- destaque



HISTÓRICO:



- usuário

- conteúdo

- posição de reprodução

- percentual assistido

- data



LISTA:



- usuário

- conteúdo

- data adicionada



CONFIGURAÇÕES:



- nome da plataforma

- logo

- favicon

- cores

- banner

- textos

- redes sociais

- configurações gerais



Criar os relacionamentos corretamente e utilizar IDs únicos.



Também criar estrutura para auditoria das ações administrativas.



OBJETIVO:



Ao finalizar esta etapa, a aplicação deverá possuir uma fundação sólida para que os próximos prompts possam implementar o Painel ADM, o site público, autenticação, catálogo, reprodução e integrações.



Não remover funcionalidades existentes caso este prompt seja aplicado em um projeto já iniciado.

Analise a estrutura atual antes de criar novas tabelas ou componentes e reutilize o que já existir.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://gltvplay.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a60e024f-d8d7-4202-815f-86d1103dd07c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
