const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const fs       = require('fs');
const path     = require('path');

const { PORT, UPLOADS, DATA_DIR } = require('./config');
const { startEvictionSweep }      = require('./services/room.service');
const { startUploadMaintenance }  = require('./services/upload.service');
const { registerSocketHandlers }  = require('./sockets');

const authRoutes   = require('./routes/auth.routes');
const uploadRoutes = require('./routes/upload.routes');
const apiRoutes    = require('./routes/api.routes');
const pagesRoutes  = require('./routes/pages.routes');

const app    = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 5e6,
});

// ─── Limpeza no startup ───────────────────────────────────────────────────────
// Apaga todos os dados de rooms e uploads ao iniciar. Garante estado limpo em
// cada inicialização — imagens são tratadas como dados voláteis de sessão,
// não persistentes entre reinicializações.
function cleanOnStartup() {
  let files = 0;
  for (const dir of [UPLOADS, DATA_DIR]) {
    try {
      for (const f of fs.readdirSync(dir)) {
        fs.unlinkSync(path.join(dir, f));
        files++;
      }
    } catch (_) {}
  }
  if (files > 0) console.log(`[startup] ${files} arquivo(s) removido(s) (uploads + rooms)`);
}
cleanOnStartup();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}, express.static(UPLOADS));

// ─── Rotas ────────────────────────────────────────────────────────────────────
app.use(authRoutes);
app.use(uploadRoutes);
app.use(apiRoutes);
app.use(pagesRoutes); // por último: contém o express.static(PUBLIC_DIR) genérico

// ─── Socket.IO ────────────────────────────────────────────────────────────────
registerSocketHandlers(io);

// ─── Manutenção em background (eviction de salas vazias, uploads órfãos) ─────
startEvictionSweep({ uploadsDir: UPLOADS });
startUploadMaintenance();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nLiveBoard rodando na porta ${PORT}`);
  console.log(`Dados das salas: ${DATA_DIR}\n`);
});
