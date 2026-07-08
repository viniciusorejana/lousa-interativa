# Checklist de testes manuais por fase

## ⚠️ Bug real encontrado e corrigido (obrigado por reportar!)

A fase4g quebrou: `ReferenceError: Cannot access 'myRoomId' before initialization`
em `staging-area.js`. Causa e correção completas em `ARCHITECTURE.md`. Resumo: dois
pontos usavam uma variável de import circular no nível superior do módulo (fora de
função) — violei minha própria regra de segurança nesses dois pontos específicos.
Corrigido, e criei `test-harness/import-test.mjs`, que agora roda em toda extração
futura e teria pego esse bug antes de eu te mandar o zip (confirmei reproduzindo o
bug de propósito e vendo o teste falhar com a mensagem exata que você viu).

**Por favor, antes de continuar**: testa o zip desta mensagem (fase4g corrigida) —
principalmente item 13 (área reservada) de novo, e o roteiro completo se tiver tempo,
já que esse erro na inicialização do módulo poderia ter afetado o carregamento da
página inteira, não só a área reservada.

## ⚠️ Mais 2 bugs na mesma rodada — corrigidos, e o teste automático ficou mais forte

Depois da primeira correção, apareceu `_stagingAreaEntries is not defined` — variável
esquecida na extração (não exportada). Auditando sistematicamente achei mais 4 casos
do mesmo tipo (`cancelStagingPlacement`, `emitStagingSync`, `getStagingOrigin`,
`imageSpawnMode`), e reforcei `test-harness/import-test.mjs` pra disparar os 17
eventos de socket que o client escuta (não só testar a importação) — isso pegou mais
um (`vpRect`). Detalhes completos em `ARCHITECTURE.md`. Tudo corrigido e revalidado.

**Por favor, testa esse zip com o roteiro completo (itens 1-19)?** Essa rodada de bugs
tocou em bastante coisa: atalho de teclado Esc, colar com "spawn: área reservada"
ativo, e sincronização de área reservada entre usuários.

---

Sem testes automatizados no projeto, cada fase da refatoração deve ser validada
manualmente com este roteiro antes de seguir para a próxima. Rode com:

```bash
npm run dev
```

(usa `.env-dev`: porta 3000, senha `live123`)

## Roteiro completo (rodar ao final de cada fase que mexe em client e/ou server)

1. **Login**: abrir `http://localhost:3000`, digitar nome de sala, ver slug atualizar em
   tempo real, digitar senha `live123`, entrar.
2. **Board carrega**: `board.html` abre sem erro no console, canvas aparece, toolbar
   funciona.
3. **Desenho**: selecionar caneta, desenhar um traço; selecionar forma (retângulo/elipse/
   linha/seta), arrastar para criar.
4. **Select/transform**: selecionar objeto, mover, redimensionar, rotacionar.
5. **Cor/espessura/opacidade**: mudar cor e espessura antes de desenhar, mudar opacidade
   de um objeto existente.
6. **Pan**: segurar espaço (ou ativar ferramenta mão) e arrastar o canvas; testar
   pinça de dois dedos se tiver trackpad/touch.
7. **Camadas**: criar nova camada, renomear, esconder/mostrar, trocar camada ativa,
   mover objeto entre camadas.
8. **Agrupar/desagrupar**: selecionar 2+ objetos, agrupar, mover o grupo, desagrupar.
9. **Upload de imagem**: arrastar um arquivo de imagem para o canvas; colar (Ctrl+V) uma
   imagem copiada de outro app; colar uma URL de imagem.
10. **GIF**: inserir um GIF (upload ou URL), confirmar que anima corretamente e que
    mover/redimensionar não quebra a animação.
11. **Copiar/colar interno**: copiar um objeto do board (Ctrl+C) e colar (Ctrl+V) na
    mesma sessão — deve reconstruir o objeto editável, não uma imagem estática.
12. **Undo/redo**: fazer 3-4 ações diferentes e desfazer/refazer todas.
13. **Área reservada (spawn area)**: mover a área reservada, confirmar que novos objetos
    nascem lá.
14. **Export PNG**: exportar o board como PNG e conferir o arquivo baixado.
15. **Multi-usuário**: abrir o board em duas abas com o mesmo nome de sala; confirmar que
    ações em uma refletem na outra em tempo real (cursor remoto, traços, objetos).
16. **View (OBS)**: abrir `http://localhost:3000/view/<slug-da-sala>` numa terceira aba;
    confirmar que reflete o board ao vivo, com fundo transparente.
17. **Trocar de lousa**: usar o botão de trocar de sala no board, confirmar que volta
    para a tela de escolha de sala sem pedir senha de novo.
18. **Persistência**: fechar o servidor (`Ctrl+C`), rodar `npm run dev` de novo, entrar na
    mesma sala — objetos devem continuar lá (arquivo em `data/rooms/<slug>.json`).
19. **Console limpo**: nenhum erro no console do navegador nem no terminal do servidor
    durante o roteiro acima.

## Status por fase

- [x] **Fase 0** — nenhuma mudança de comportamento (só pastas novas vazias). Roteiro
      completo não é necessário aqui, mas confirmamos que `npm run dev` sobe normalmente.
- [x] **Fase 1** — validado: item 1 (login com senha certa/errada, cookie de sessão,
      `/board.html` protegido), item 18 (persistência em disco confirmada após
      debounce), item 19 (log do servidor sem nenhum erro). Testado também o fluxo de
      socket.io de ponta a ponta (conectar → `board:init` → `object:add` →
      `history:update` → `history:undo` → `board:sync`), fora do roteiro padrão mas
      relevante por ser justamente o código que mais mudou de lugar nesta fase.
- [x] **Fase 2** — validado via HTTP e testes isolados de código: os dois arquivos
      compartilhados são servidos corretamente (200, content-type JS), o conteúdo é
      byte-idêntico ao código original (diff limpo), a ordem das tags `<script>` em
      `board.html` e `view.html` preserva a mesma sequência de execução de antes, e o
      log do servidor ficou limpo durante todos os testes. Também rodei o
      `fabric-image-patch.js` e o `socket-client.js` isoladamente em Node com mocks de
      `fabric`/`fetch`/`Image`/`io`, confirmando que a lógica de cache de imagem e a
      chamada de conexão do socket se comportam exatamente como antes.
      **Importante**: este ambiente não tem navegador disponível para mim testar — o
      teste definitivo (itens 1, 2, 9, 10, 16, 19 do roteiro) depende de você abrir de
      verdade `board.html` e `view.html` no navegador. Peço que confirme isso antes de eu
      seguir pra Fase 3, já que ali eu começo a mexer na lógica principal do canvas.
- [x] **Fase 3 (parte 1)** — validado o que dava pra validar sem navegador: sintaxe
      ESM real, as 35 funções da ponte `window.*` todas presentes, zero identificador
      duplicado no nível superior do módulo fundido, arquivos servidos corretamente
      (200, conteúdo byte-idêntico ao disco), e o fluxo de socket.io continua saudável
      (regressão — server não foi tocado nesta fase).
      **Preciso muito da sua ajuda aqui**: esta foi a fase de maior risco até agora —
      o board.html inteiro passou a depender de uma lista manual de ~35 funções
      "ponteadas" pra `window` (pra continuar funcionando com os `onclick=` inline do
      HTML). Se eu esqueci alguma, o sintoma é bem específico: aquele UM botão/campo
      não faz nada ao clicar/mudar, e o console mostra algo como
      `Uncaught ReferenceError: nomeDaFuncao is not defined` — se aparecer isso, me
      manda o nome exato da função no erro, é rápido de corrigir. Por favor rode o
      roteiro **completo** (itens 1-19), não só o recorte que eu geralmente sugiro,
      já que praticamente toda interação de UI passa por essa ponte agora.
- [x] **`features/media/gif-service.js`** — validado: sintaxe ESM, zero declaração
      duplicada, ponte `window.*` continua 100% íntegra (reconferi as 35 funções),
      servidor servindo o arquivo novo corretamente (byte-idêntico ao disco), fluxo de
      socket.io saudável. **Peço que teste especificamente**: item 9 (upload de
      imagem/GIF), item 10 (GIF anima, mover/redimensionar não quebra a animação) e
      item 11 (copiar/colar interno de GIF) — é exatamente o código que mudou de
      arquivo nesta entrega.
- [x] **`features/export/png-exporter.js`** — validado: sintaxe, zero duplicata,
      ponte íntegra, servidor servindo corretamente, socket saudável. **Peça de
      atenção**: item 14 (exportar PNG — objeto único, seleção múltipla, e board
      inteiro sem selecionar nada) e a parte de "copiar como imagem" dentro do item
      11 (copiar/colar), que reaproveita a mesma função de renderização.
- [x] **`features/groups/group-service.js`** — validado: sintaxe, zero duplicata,
      ponte íntegra, arquivos servidos e byte-idênticos, socket saudável. **Peça de
      atenção**: item 8 (agrupar 2+ objetos, mover o grupo, desagrupar e conferir que
      cada objeto volta pra posição/rotação/escala exatas de antes).
- [x] **`features/layers/layers-panel.js`** — a extração mais delicada até agora
      (maior arquivo, mais pontos de reatribuição de estado corrigidos). Validado:
      sintaxe, zero duplicata, ponte com as 35 funções íntegra (incluindo reconferir
      as reexportações que os módulos anteriores dependem), arquivos servidos e
      byte-idênticos, socket saudável. **Peço atenção extra nos itens 7 e 13**: criar
      camada, renomear, esconder/mostrar, mover objeto entre camadas via
      drag-and-drop, colapsar/expandir grupos de traços no painel, excluir camada com
      objetos dentro (deve pedir confirmação) — é literalmente tudo que mudou de
      arquivo aqui.
- [x] **`features/onboarding/tooltip.js` e `tutorial.js`** — extração de baixo risco
      (sem estado compartilhado, sem import circular). Validado: sintaxe, zero
      duplicata, ponte íntegra, arquivos servidos e byte-idênticos, socket saudável.
      **Peça de atenção**: tooltip ao passar o mouse nos botões da toolbar, e o
      tutorial completo (abrir pelo botão de ajuda, navegar com setas do teclado e
      Escape, botão "Apagar e fechar" na última página).
- [x] **`core/serialization.js`** — validado: sintaxe (5 arquivos tocados), zero
      duplicata, ponte íntegra, todos os arquivos servidos e byte-idênticos, socket
      saudável. Essa mudança é "invisível" pro usuário (não muda nenhum
      comportamento visível) — o roteiro completo continua sendo a melhor forma de
      validar, já que serialização entra em quase tudo (undo/redo, grupos, camadas,
      streaming de formas).
- [x] **`features/spawn-area/staging-area.js`** — validado: sintaxe, zero duplicata,
      ponte íntegra, arquivos servidos e byte-idênticos, socket saudável. **Peço
      atenção no item 13**: ligar "Spawn: área reservada", mover a área reservada
      (modo mira + clique pra confirmar), clique direito pra resetar posição,
      inserir imagem/gif com o modo ativo, e — se possível — testar com 2 abas pra
      ver a área reservada de outro usuário aparecer com o nome/cor dele.
- [ ] Fase 3 (parte 2) / Fase 4 — rodar itens 7-11, 13, 14, 19 conforme cada feature for
      extraída de board-app.js pra seu próprio arquivo.
- [ ] Fase 4 — rodar itens 7-11, 13, 14, 19 (foco: camadas, grupos, export, mídia,
      clipboard, spawn area).
- [ ] Fase 5 — roteiro completo (1-19) — entrypoints e UI final montados.
- [ ] Fase 6 — roteiro completo (1-19), com atenção visual a cada tela (CSS).
- [ ] Fase 7 — roteiro completo (1-19) como validação final.
