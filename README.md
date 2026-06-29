# LiveBoard 🎨

Quadro colaborativo em tempo real para streams ao vivo no OBS. Múltiplos moderadores podem desenhar, escrever e inserir imagens e GIFs animados no quadro simultaneamente, e tudo reflete ao vivo na transmissão com latência mínima.

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

Para acesso de outros dispositivos na mesma rede (LAN), substitua `localhost` pelo IP da máquina host:

```
http://192.168.x.x:3000
```

---

## Salas (multi-board)

O LiveBoard suporta **múltiplas salas independentes** simultaneamente. Cada sala tem seu próprio estado, objetos, camadas e histórico de undo/redo.

### Como funciona

Na tela de login, o editor digita um **nome de sala** (ex: `Lousa 1`, `Aula de Matemática`). O servidor converte esse nome para um **slug de URL** seguro:

```
"Lousa 1"             → /view/lousa-1
"Aula de Matemática"  → /view/aula-de-matematica
"Minha Lousa!"        → /view/minha-lousa
```

O preview do slug aparece em tempo real enquanto você digita na tela de login.

### Source do OBS por sala

Cada sala tem sua própria URL para o OBS:

```
http://localhost:3000/view/lousa-1
http://localhost:3000/view/aula-de-matematica
```

### Trocar de sala sem relogar

No editor, o botão **"Trocar de Lousa"** (ícone de casinha na toolbar) redireciona para o passo de escolha de sala sem pedir a senha novamente, desde que a sessão ainda seja válida.

### Persistência e eviction

- O estado de cada sala é **salvo em disco** (`/data/rooms/<slug>.json`) 2 segundos após qualquer alteração.
- Salas ficam em memória enquanto têm usuários conectados.
- Salas vazias há mais de **30 minutos** são apagadas automaticamente da RAM e do disco, junto com todos os uploads associados.
- Ao reiniciar o servidor, **todos os uploads e estados de sala são limpos** — o board é tratado como volátil de sessão por design.

---

## Senha de acesso

Definida no arquivo `.env`:

```
BOARD_PASSWORD=live123
```

A senha é validada no servidor via cookie de sessão HttpOnly — nunca fica exposta no código do cliente.

Para usar uma senha diferente sem editar o arquivo:

```bash
BOARD_PASSWORD=minhasenha npm start
```

---

## Configurar no OBS

1. Adicione uma source do tipo **"Browser"**
2. URL: `http://localhost:3000/view` (ou `http://localhost:3000/view/nome-da-sala`)
3. Largura/Altura: igual à resolução do stream (ex: `1920` × `1080`)
4. **"Shutdown source when not visible"** → **OFF**
5. **"Refresh browser when scene becomes active"** → **OFF**
6. **"CSS personalizado"** → deixe em branco (o fundo já é transparente por padrão)

A página `/view` não tem HUD nem controles — apenas os objetos do quadro sobre fundo transparente, pronta para ser sobreposta na live.

---

## Ferramentas do editor

### Atalhos de teclado

| Tecla | Ferramenta |
|-------|------------|
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
| `Ctrl+D` | Duplicar seleção |
| `Ctrl+A` | Selecionar tudo |
| `Delete` / `Backspace` | Apagar selecionado |

### Painel de opções (toolbar)

Ao selecionar qualquer ferramenta de desenho, aparece um painel abaixo da toolbar com:
- **Cor** — 8 cores predefinidas + seletor de cor livre
- **Espessura** — slider de 1 a 60px
- **Opacidade** — slider de 10% a 100%
- **Preenchimento** — checkbox para preencher formas geométricas

### Painel contextual (objeto selecionado)

Ao selecionar um objeto no modo **Selecionar**, aparece um painel lateral com:
- Largura e altura (redimensionamento numérico)
- Opacidade
- Botões "Para trás" / "Para frente" (controle de z-order)
- Botão "Excluir"

### Viewport

O painel de **Viewport** (canto esquerdo) define a resolução do canvas de transmissão. O padrão é `1920 × 1080`. Alterar esse valor reposiciona e reescala a visualização para refletir a área que o OBS vai capturar.

---

## Funcionalidades

### Colaboração em tempo real
- Sincronização via **WebSocket** (Socket.IO) com latência ~1–5ms em LAN
- **Stroke streaming** — o traço da caneta aparece ponto a ponto nos outros clientes enquanto você desenha
- **Transform em tempo real** — mover, escalar e rotacionar objetos reflete imediatamente para todos
- **Seleção múltipla sincronizada** — mover/escalar vários objetos juntos sincroniza todos simultaneamente
- **Cursores remotos** — cada editor tem um cursor colorido visível para os demais
- **Texto ao vivo** — digitação aparece letra a letra para todos os visualizadores

### Ferramentas de desenho
- Caneta livre com streaming em tempo real
- Retângulo, elipse, linha, seta (com cabeça de flecha)
- Texto editável com suporte a redimensionamento
- Borracha (clique para apagar objeto)

### Imagens e GIFs animados
- Upload via botão na toolbar (até 20MB por arquivo)
- Colar da área de transferência com **Ctrl+V**
- Formatos suportados: JPG, PNG, GIF, WebP, BMP, SVG
- Redimensionar, rotacionar e espelhar (horizontal/vertical)
- Imagens armazenadas em disco no servidor (`/uploads/`) — nunca trafegam como base64, apenas como URL
- Limpeza automática: ao remover uma imagem do board, o arquivo é apagado do disco

#### GIFs animados

GIFs são decodificados fora da thread principal usando uma **WebWorker** dedicada (`public/gif.worker.js`):

1. O Worker faz `fetch` do GIF, parseia o binário (formato GIF89a/87a) e decodifica cada frame via LZW
2. Os frames são compostos num `OffscreenCanvas`, respeitando todos os 4 modos de disposal do formato GIF (keep, clear, restore-to-background, restore-to-previous) e transparência por índice
3. Cada frame é convertido em `ImageBitmap` e enviado para a thread principal via `postMessage` com transferência zero-copy
4. Um único loop `requestAnimationFrame` global anima todos os GIFs ativos simultaneamente, avançando frames com base no delay real de cada GIF (mínimo 20ms)

Isso garante GIFs animados funcionais no canvas, sem travamentos na UI e com delays por frame corretos.

### Camadas
- Painel de camadas no lado direito do editor
- Adicionar, renomear, reordenar (drag-and-drop) e apagar camadas
- Visibilidade por camada (ocultar/mostrar sincronizado para todos)
- Cada objeto pertence a uma camada; novos objetos vão para a camada ativa
- Objetos em camadas ocultas ficam invisíveis na view do OBS

### Histórico
- **Desfazer/Refazer** local com até 50 estados
- Undo/Redo sincroniza o estado completo para todos os clientes
- Histórico persistido em disco junto com o estado da sala

### Z-order (camadas de objeto)
- "Para trás" e "Para frente" sincronizados para todos os visualizadores

### Suporte mobile
- Toolbar com scroll horizontal para telas pequenas
- Todos os gestos de toque suportados: desenhar, mover, redimensionar
- Viewport fixo (sem zoom acidental ao desenhar)

---

## Estrutura do projeto

```
liveboard/
├── server/
│   └── index.js          # Servidor Node.js (Express + Socket.IO)
├── public/
│   ├── index.html        # Página de login (3 passos: senha → sala → nome)
│   ├── board.html        # Editor principal
│   ├── view.html         # Source do OBS (só visualização, fundo transparente)
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

O sistema usa dois canais distintos para otimizar performance e fidelidade:

| Canal | Evento | Quando | Comportamento |
|-------|--------|--------|---------------|
| Tempo real | `object:transform` | Durante drag/scale/rotate | `volatile` — descartável se congestionado |
| Tempo real | `objects:transform` | Multi-seleção em movimento | `volatile` — batch de todos os objetos |
| Final | `object:add` | Objeto criado | Garantido — JSON completo |
| Final | `object:modify` | Após mouse:up | Garantido — JSON completo |
| Final | `object:modify:commit` | Commit de transformação | Garantido + push undo |
| Streaming | `draw:move` | Caneta em movimento | `volatile` ponto a ponto |
| Histórico | `history:undo` / `history:redo` | Undo/Redo | Sincroniza estado completo para todos |

**Princípio:** updates em tempo real (`transform`) atualizam apenas `left/top/scaleX/scaleY/angle/flipX/flipY` in-place sem recriar o objeto (zero flicker). Ao finalizar qualquer ação, um `object:modify` ou `object:modify:commit` com o JSON completo garante que todos os clientes ficam em estado idêntico.

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3000` | Porta do servidor |
| `BOARD_PASSWORD` | `live123` | Senha de acesso ao editor |

Definidas nos arquivos `.env` (produção) e `.env-dev` (desenvolvimento).

---

## Dependências

| Pacote | Versão | Uso |
|--------|--------|-----|
| `express` | ^4.18.2 | Servidor HTTP e rotas |
| `socket.io` | ^4.6.1 | WebSocket para sincronização em tempo real |
| `multer` | ^2.2.0 | Upload de imagens (multipart/form-data) |
| `uuid` | ^9.0.0 | IDs únicos para objetos, usuários e sessões |

No frontend: **Fabric.js 5.3.1** (canvas interativo) e **Socket.IO client** — ambos carregados via CDN, sem bundle step.

---

## Hospedagem (além da LAN)

O projeto foi desenvolvido para uso local, mas pode ser hospedado normalmente em qualquer VPS com Node.js. Recomendações:

- Use um proxy reverso (nginx ou Caddy) com HTTPS
- Configure `BOARD_PASSWORD` com uma senha forte via variável de ambiente
- As pastas `uploads/` e `data/rooms/` precisam ter permissão de escrita pelo processo Node.js
- Para múltiplos processos, o estado do board é in-memory — use pm2 com uma única instância ou adicione Redis para persistência entre reinicializações
