# LiveBoard 🎨

Quadro colaborativo em tempo real para streams ao vivo no OBS.

## Como iniciar

```bash
npm start
```

O servidor sobe na porta 3000.

## URLs

| URL | Uso |
|-----|-----|
| `http://localhost:3000` | Login dos editores |
| `http://localhost:3000/board.html` | Editor com ferramentas |
| `http://localhost:3000/view` | Source do OBS (fundo transparente) |

## Senha padrão

```
live123
```

Para mudar, defina a variável de ambiente antes de iniciar:
```bash
BOARD_PASSWORD=minhasenha npm start
```

## Configurar no OBS

1. Adicione uma source do tipo **"Browser"**
2. URL: `http://localhost:3000/view`
3. Largura/Altura: igual à sua resolução de stream (ex: 1920x1080)
4. Marque **"Shutdown source when not visible"** = OFF
5. Marque **"Refresh browser when scene becomes active"** = OFF

## Ferramentas do editor

| Tecla | Ferramenta |
|-------|-----------|
| V | Selecionar / mover |
| P | Caneta livre |
| E | Borracha |
| R | Retângulo |
| C | Elipse/círculo |
| SHIFT+T | Triângulo |
| L | Linha |
| A | Seta |
| T | Texto |
| Ctrl+Z | Desfazer |
| Ctrl+Y | Refazer |
| Ctrl+D | Duplicar seleção |
| Ctrl+A | Selecionar tudo |
| Delete | Apagar selecionado |

## Funcionalidades

- ✅ Sincronização em tempo real via WebSocket (Socket.IO)
- ✅ Stroke streaming (desenho aparece em tempo real nos outros clients)
- ✅ Cursores remotos com identificação por cor
- ✅ Upload de imagens (botão ou Ctrl+V para colar)
- ✅ Redimensionar / mover / girar objetos
- ✅ Histórico Undo/Redo local + sync
- ✅ Fundo transparente na view do OBS
- ✅ Login com senha única
- ✅ Suporte a múltiplos editores simultâneos
