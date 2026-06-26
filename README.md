# LiveBoard 🎨

Quadro colaborativo em tempo real para streams ao vivo no OBS. Múltiplos moderadores podem desenhar, escrever e inserir imagens no quadro simultaneamente, e tudo reflete ao vivo na transmissão com latência mínima.

---

## Requisitos

- [Node.js](https://nodejs.org/) v18 ou superior
- npm (incluído com o Node.js)

---

## Instalação e inicialização

```bash
# 1. Faça clone do repositório
git clone "este repositório"

# 2. Instale as dependências
npm install

# 3. Inicie o servidor
npm start
```

O servidor sobe na porta **3000** e fica acessível em toda a rede local.

---

## URLs

| URL | Para quê |
|-----|----------|
| `http://localhost:3000` | Página de login dos editores |
| `http://localhost:3000/board.html` | Editor completo com ferramentas |
| `http://localhost:3000/view` | **Source do OBS** — fundo transparente, sem HUD |

Para acesso de outros dispositivos na mesma rede (LAN), substitua `localhost` pelo IP da máquina host:
```
http://192.168.x.x:3000
```

---

## Senha de acesso

A senha padrão é:
```
live123
```

Para usar uma senha diferente, defina a variável de ambiente `BOARD_PASSWORD` antes de iniciar:

```bash
BOARD_PASSWORD=minhasenha npm start
```

A senha é validada pelo servidor — nunca fica exposta no código do cliente.

---

## Configurar no OBS

1. Adicione uma source do tipo **"Browser"**
2. URL: `http://localhost:3000/view`
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

### Imagens
- Upload via botão na toolbar (até 20MB por imagem)
- Colar da área de transferência com **Ctrl+V**
- Redimensionar, rotacionar e espelhar (horizontal/vertical)
- Imagens armazenadas em disco no servidor (`/uploads/`) — nunca trafegam como base64, apenas como URL
- Limpeza automática: ao remover uma imagem do board, o arquivo é apagado do disco

### Histórico
- **Desfazer/Refazer** local com até 50 estados
- Undo/Redo sincroniza o estado completo para todos os clientes

### Z-order (camadas)
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
│   └── index.js        # Servidor Node.js (Express + Socket.IO)
├── public/
│   ├── index.html      # Página de login
│   ├── board.html      # Editor principal
│   └── view.html       # Source do OBS (só visualização)
├── uploads/            # Imagens enviadas (criada automaticamente)
├── package.json
└── README.md
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
| Streaming | `draw:move` | Caneta em movimento | `volatile` ponto a ponto |

**Princípio:** updates em tempo real (`transform`) atualizam apenas `left/top/scaleX/scaleY/angle/flipX/flipY` in-place sem recriar o objeto (zero flicker). Ao finalizar qualquer ação, um `object:modify` com o JSON completo garante que todos os clientes ficam em estado idêntico.

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3000` | Porta do servidor |
| `BOARD_PASSWORD` | `live123` | Senha de acesso ao editor |

---

## Hospedagem (além da LAN)

O projeto foi desenvolvido para uso local, mas pode ser hospedado normalmente em qualquer VPS com Node.js. Recomendações:

- Use um proxy reverso (nginx ou Caddy) com HTTPS
- Configure `BOARD_PASSWORD` com uma senha forte via variável de ambiente
- A pasta `uploads/` precisa ter permissão de escrita pelo processo Node.js
- Para múltiplos processos, o estado do board é in-memory — use pm2 com uma única instância ou adicione Redis para persistência