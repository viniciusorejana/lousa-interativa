# LiveBoard 🎨

Quadro colaborativo em tempo real para streams ao vivo no OBS. Múltiplos moderadores podem desenhar, escrever e inserir imagens e GIFs animados no quadro simultaneamente, e tudo reflete ao vivo na transmissão com latência mínima. Uma área de spawn reservada, configurável por pessoa, evita que qualquer coisa nova "pipoque" no meio do stream ao vivo.

---

## Requisitos

- [Node.js](https://nodejs.org/) v18 ou superior (obrigatório — usa `--env-file` nativo)
- npm (incluído com o Node.js)

---

## Instalação e inicialização

```bash
# 1. Clone o repositório
git clone "este repositório"
cd liveboard

# 2. Instale as dependências
npm install

# 3. Inicie o servidor
npm start
```

O servidor sobe na porta definida em `.env` (padrão: **3000**) e fica acessível em toda a rede local.

Para desenvolvimento com `.env-dev`:

```bash
npm run dev
```

---

## URLs

| URL | Para quê |
|-----|----------|
| `http://localhost:3000` | Página de login dos editores |
| `http://localhost:3000/board.html` | Editor completo com ferramentas |
| `http://localhost:3000/view` | Source do OBS — sala padrão |
| `http://localhost:3000/view/:sala` | Source do OBS — sala específica |

Para acesso de outros dispositivos na mesma rede (LAN), substitua `localhost` pelo IP da máquina host.

---

## Salas (multi-board)

O LiveBoard suporta **múltiplas salas independentes** simultaneamente. Cada sala tem seu próprio estado, objetos, camadas, histórico de undo/redo e z-order.

### Como funciona

Na tela de login, o editor digita um **nome de sala**. O servidor converte para um **slug de URL** seguro, exibido em preview em tempo real:

```
"Lousa 1"             → /view/lousa-1
"Aula de Matemática"  → /view/aula-de-matematica
```

### Source do OBS por sala

```
http://localhost:3000/view/lousa-1
http://localhost:3000/view/aula-de-matematica
```

### Trocar de sala

O botão **"Trocar de Lousa"** (ícone de casinha na toolbar) redireciona para a escolha de sala sem pedir a senha novamente.

### Persistência e eviction

- Estado salvo em disco (`/data/rooms/<slug>.json`) 2 segundos após qualquer alteração
- Salas vazias há mais de **30 minutos** são removidas da RAM e do disco
- Ao reiniciar o servidor, todos os uploads e estados são limpos (volátil por design)

---

## Senha de acesso

Definida em `.env`:

```
BOARD_PASSWORD=live123
```

Validada no servidor via cookie de sessão HttpOnly.

---

## Configurar no OBS

1. Source do tipo **"Browser"**
2. URL: `http://localhost:3000/view` (ou `/view/nome-da-sala`)
3. Largura/Altura: igual à resolução do stream (ex: `1920 × 1080`)
4. **"Shutdown source when not visible"** → **OFF**
5. **"Refresh browser when scene becomes active"** → **OFF**
6. CSS personalizado → vazio (fundo já transparente)

---

## Ferramentas do editor

### Atalhos de teclado

| Tecla | Ação |
|-------|------|
| `V` | Selecionar / mover |
| `P` | Caneta livre |
| `E` | Borracha |
| `R` | Retângulo |
| `C` | Elipse / círculo |
| `L` | Linha |
| `A` | Seta |
| `T` | Texto |
| `Ctrl+Z` | Desfazer |
| `Ctrl+Y` | Refazer |
| `Ctrl+A` | Selecionar tudo |
| `Ctrl+D` | Duplicar seleção |
| `Ctrl+C` | Copiar seleção |
| `Ctrl+V` | Colar |
| `Delete` / `Backspace` | Apagar selecionado |
| `Esc` | Cancelar o "modo mira" de reposicionar a área de spawn reservada |

### Painel de opções (toolbar)

Cor, espessura (1–60px), opacidade (10–100%) e preenchimento para formas geométricas.

### Painel contextual (objeto selecionado)

Largura, altura, opacidade, z-order ("Para trás" / "Para frente"), exportar PNG e excluir.

### Viewport

O painel **VIEWPORT** (canto esquerdo) define a resolução de captura (padrão `1920 × 1080`) e o botão "Ir para Viewport" centraliza a visão.

### Layout dos painéis (topo da tela)

Todos os painéis fixos no topo se reposicionam dinamicamente conforme o tamanho real da tela e da toolbar (nunca em valores fixos "no chute"), então continuam alinhados em qualquer resolução, zoom ou idioma de texto:

| Painel | Posição | Conteúdo |
|--------|---------|----------|
| Toolbar principal | Topo, centro | Ferramentas de desenho |
| Painel de opções | Abaixo da toolbar, centro | Cor, espessura, opacidade (por ferramenta) |
| **Spawn** | Abaixo do painel de opções, centro | Alternar modo de spawn + mover área reservada (ver seção própria abaixo) |
| **Ver ao vivo / Como usar** | Canto superior esquerdo | Abrir a view do OBS desta sala / tutorial in-app |
| Viewport | Canto esquerdo, abaixo do painel anterior | Resolução de captura |
| Propriedades do objeto (`#ctx`) | Canto direito, abaixo da área ocupada no topo | Aparece com algo selecionado |
| Camadas | Canto direito, abaixo do painel de propriedades | Sempre visível |

Em telas largas (≥1200px) os painéis de canto ficam fixos; em telas estreitas, cada um mede a borda real do anterior (`getBoundingClientRect`) e se empurra pra baixo automaticamente, sempre nessa ordem: toolbar → opções → spawn → view/ajuda → viewport (e, do lado direito: → propriedades → camadas). Todos os textos dos botões de canto (spawn, ver ao vivo, ajuda) viram **tooltip flutuante** no hover, pra manter os ícones compactos sem perder a descrição completa.

---

## Área de spawn reservada

Controla **onde** imagens, GIFs e qualquer coisa colada com `Ctrl+V` (um objeto, vários soltos ou um grupo inteiro) aparece no board. Pensado pra quem faz live: sem isso, colar algo novo faz o item "pipocar" no meio da tela de quem está assistindo em tempo real.

### Os dois modos

| Modo | Onde as coisas nascem |
|------|------------------------|
| **Minha tela** (padrão) | Centralizado na área do board que você, localmente, está olhando agora |
| **Área reservada** | Numa região tracejada, fora do viewport oficial (`0,0` → `vpW×vpH`, o que a view do OBS realmente mostra) — dá tempo de arrastar pra posição final com calma antes de aparecer "ao vivo" |

Alternável a qualquer momento pelo botão **Spawn** no painel central. A preferência fica salva por navegador (`localStorage`), sobrevive a recarregamentos.

### Posição configurável por pessoa

Cada pessoa escolhe, só pra si, onde a própria área reservada fica — clicando em **"Mover área reservada"** e depois clicando no board (Esc cancela; clique direito no botão reseta pra posição padrão, à direita do viewport oficial).

### Visível para todos

O board mostra a área reservada de **todo mundo que está com o modo ativo** — cada uma com o nome e a cor da respectiva pessoa, pra ninguém colar em cima do que outra pessoa já está organizando. A sincronização **não é em tempo real** (não segue o mouse pela rede): só dispara nestes momentos — ligar/desligar o modo, mover ou resetar a posição, e ao reconectar/recarregar a página já com o modo ativo. Desligar o modo remove a área do board de todo mundo. A posição de cada pessoa persiste no estado da sala (sobrevive a desconexões), identificada por um `clientId` salvo no navegador — não pelo nome de usuário, que pode mudar.

### Colar múltiplos objetos e grupos

Colar (`Ctrl+V`) com o modo "área reservada" ativo funciona pra **qualquer seleção** — um objeto, vários soltos ou um grupo inteiro: todos são traduzidos como um bloco só pra dentro da área reservada, preservando o arranjo relativo entre eles (e encolhendo proporcionalmente, só se necessário, pra caber). Colagens sucessivas caem em cascata, pra nada nascer empilhado exatamente em cima da colagem anterior.

---

## Funcionalidades

### Colaboração em tempo real

- Sincronização via **WebSocket** (Socket.IO) com latência ~1–5ms em LAN
- **Stroke streaming** — traço aparece ponto a ponto nos outros clientes
- **Transform em tempo real** — mover/escalar/rotacionar reflete imediatamente para todos
- **Seleção múltipla sincronizada** — move vários objetos em conjunto
- **Cursores remotos** — cada editor tem um cursor colorido visível para os demais
- **Texto ao vivo** — digitação aparece letra a letra

### Z-order persistente

A ordem visual dos objetos (quem fica na frente de quem) é mantida como um array `zorder` no estado da sala, salvo em disco. Após F5, undo/redo ou entrada de novos usuários, a ordem é restaurada exatamente como estava — imagens não sobem mais para a frente de tudo ao recarregar.

### Copiar e colar

`Ctrl+C` copia a seleção atual (1 ou vários objetos, qualquer tipo, inclusive grupos inteiros) para um clipboard interno. `Ctrl+V` gera **novos objetos** com novos IDs para todos os clientes:

- Sem o modo "área reservada" ativo: cada colagem aplica um offset incremental de 24px a partir da posição original copiada, para não empilhar no mesmo lugar
- Com o modo "área reservada" ativo: todo o conjunto colado nasce dentro da área reservada, preservando o arranjo relativo entre os objetos (ver [Área de spawn reservada](#área-de-spawn-reservada))
- `Ctrl+V` múltiplas vezes continua offsetando/cascateando progressivamente
- GIFs colados entram diretamente no pipeline de animação (não são cópias estáticas)
- Objetos colados vão para a camada ativa no momento da colagem

### Exportar PNG

Botão na toolbar e no painel contextual. Três modos automáticos com base na seleção:

| Cenário | Resultado |
|---------|-----------|
| Nenhum objeto selecionado | PNG do board inteiro no tamanho do viewport (ex: 1920×1080) |
| 1 objeto selecionado | PNG recortado na bounding box exata daquele objeto |
| 2+ objetos ou grupo selecionado | PNG recortado na bounding box de toda a seleção |

Todos os modos: fundo transparente, tamanho exato dos objetos em pixels, independente do zoom atual do editor. A bounding box usa `aCoords` do `ActiveSelection` (o mesmo mecanismo dos grupos reais) para coordenadas corretas no espaço lógico do canvas.

### GIFs animados

GIFs são decodificados fora da thread principal em uma **WebWorker** dedicada (`public/gif.worker.js`):

1. Worker faz `fetch` do GIF, parseia o binário (GIF89a/87a) e decodifica via LZW
2. Frames compostos num `OffscreenCanvas`, respeitando os 4 modos de disposal e transparência por índice
3. Frames enviados como `ImageBitmap[]` via `postMessage` (zero-copy)
4. Um único loop `requestAnimationFrame` global anima todos os GIFs ativos com delays reais por frame

GIFs **não podem ser agrupados** (o botão de grupo fica desabilitado quando algum GIF está selecionado).

### Cache de imagens

`fabric.Image.fromURL` é interceptado globalmente (monkey-patch) em todos os clientes. Efeitos:

- **Cache de `HTMLImageElement`**: cada imagem é baixada uma única vez por sessão, independente de quantas vezes o objeto é movido, modificado, desagrupado ou recebido via socket
- **Normalização de URL**: URLs absolutas de outros hosts são reescritas para o `origin` atual, eliminando falhas de carregamento em ambientes com múltiplos hostnames
- **`crossOrigin: 'anonymous'` garantido** em 100% das cargas, inclusive filhos de grupos via `fabric.Group.fromObject`
- **Warm-up `fetch`**: primeira carga popula o cache HTTP com headers CORS antes do `<img>` tag, evitando o problema de canvas tainted

### Agrupamento atômico

Agrupar e desagrupar são **operações atômicas** no servidor — um único `pushUndo` por operação. Os clientes remotos reutilizam os objetos Fabric já existentes no canvas (sem destruir e recriar), eliminando o frame em branco e o problema de imagens desaparecendo ao agrupar.

### Camadas

- Adicionar, renomear, reordenar (drag-and-drop) e apagar camadas
- Visibilidade por camada sincronizada para todos
- Cada objeto pertence a uma camada; novos objetos vão para a camada ativa
- Objetos em camadas ocultas ficam invisíveis na view do OBS

### Histórico (undo/redo)

- Até 50 estados por sala
- Snapshots incluem objetos, camadas e z-order — o undo/redo restaura a ordem visual completamente
- Sincronizado: todos os clientes veem o mesmo estado após undo/redo
- Token de geração em `loadState` cancela deserializações obsoletas quando `board:sync` chega rapidamente (Ctrl+Z/Y rápido não deixa estados híbridos)

---

## Estrutura do projeto

```
liveboard/
├── server/
│   └── index.js          # Servidor Node.js (Express + Socket.IO)
├── public/
│   ├── index.html        # Página de login (senha → sala → nome)
│   ├── board.html        # Editor principal
│   ├── view.html         # Source do OBS (visualização, fundo transparente)
│   └── gif.worker.js     # WebWorker de decodificação de GIF
├── uploads/              # Imagens enviadas (criada automaticamente)
├── data/
│   └── rooms/            # Estado das salas em JSON (criado automaticamente)
├── .env                  # Variáveis de produção
├── .env-dev              # Variáveis de desenvolvimento
└── package.json
```

---

## Arquitetura de sincronização

| Evento | Quando | Comportamento |
|--------|--------|---------------|
| `object:add` | Objeto criado | Garantido + atualiza zorder |
| `object:modify` | Posição/propriedade alterada | Garantido |
| `object:modify:commit` | Fim de transformação | Garantido + pushUndo |
| `object:transform` | Durante drag/scale | `volatile` — descartável |
| `objects:transform` | Multi-seleção em movimento | `volatile` — batch |
| `objects:batch` | Criação em lote (colar, duplicar) | Garantido + atualiza zorder |
| `group:commit` | Agrupar | Atômico — 1 pushUndo, reutiliza objetos existentes |
| `ungroup:commit` | Desagrupar | Atômico — 1 pushUndo, extrai via `toActiveSelection()` |
| `zorder:sync` | Mudança de z-order explícita | Reordena canvas de todos |
| `draw:end` + `zorder:sync` | Traço finalizado | Garante posição na camada correta |
| `history:undo` / `redo` | Undo/Redo (por usuário) | Servidor aplica o patch e responde com `history:apply` |
| `history:apply` | Diff de undo/redo | Só os objetos afetados + zorder/layers resultantes — cliente aplica via `applyFull` (sem re-deserializar o board todo) |
| `board:sync` | Estado completo | Reservado para reconexão/fallback (não é mais emitido no undo/redo) |
| `staging:sync` | Área de spawn reservada movida/ativada | Não-realtime — só ao confirmar; persiste por `clientId` no estado da sala |
| `staging:remove` | Área de spawn reservada desativada/resetada | Remove a área do board de todos os outros clientes |

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3000` | Porta do servidor |
| `BOARD_PASSWORD` | `live123` | Senha de acesso ao editor |

---

## Dependências

| Pacote | Versão | Uso |
|--------|--------|-----|
| `express` | ^4.18.2 | Servidor HTTP e rotas |
| `socket.io` | ^4.6.1 | WebSocket em tempo real |
| `multer` | ^2.2.0 | Upload de imagens |
| `uuid` | ^9.0.0 | IDs únicos |

Frontend: **Fabric.js 5.3.1** (vendorizado em `public/vendor/fabric.min.js` — servido pelo próprio app, não mais via CDN, pra não depender de terceiros no ar durante uma live) e **Socket.IO client** (servido pelo próprio Socket.IO), sem build step.

---

## Hospedagem além da LAN

O projeto foi desenvolvido para uso local, mas pode ser hospedado em qualquer VPS com Node.js:

- Use nginx ou Caddy como proxy reverso com HTTPS
- `BOARD_PASSWORD` forte via variável de ambiente
- As pastas `uploads/` e `data/rooms/` precisam de permissão de escrita
- Uma única instância Node.js (estado em memória — sem Redis necessário para uso típico)