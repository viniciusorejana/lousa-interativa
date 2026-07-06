# Checklist de testes manuais por fase

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
- [ ] Fase 2 — rodar itens 1, 2, 9, 10, 16, 19 (foco: patch de imagem/gif compartilhado
      entre board e view).
- [ ] Fase 3 — rodar itens 1-6, 12, 19 (foco: canvas, estado, ferramentas, undo/redo).
- [ ] Fase 4 — rodar itens 7-11, 13, 14, 19 (foco: camadas, grupos, export, mídia,
      clipboard, spawn area).
- [ ] Fase 5 — roteiro completo (1-19) — entrypoints e UI final montados.
- [ ] Fase 6 — roteiro completo (1-19), com atenção visual a cada tela (CSS).
- [ ] Fase 7 — roteiro completo (1-19) como validação final.
