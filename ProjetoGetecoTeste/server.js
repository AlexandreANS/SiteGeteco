const express = require("express");
const path = require("path");
const fs = require("fs");
const https = require("https");
const app = express();
const PORT = process.env.PORT || 5000;

// URL do admin-server no Render
const ADMIN_URL = "escola-geteco.onrender.com";

// Ficheiros estáticos
app.use(express.static(path.join(__dirname)));

// ✅ Servir imagens de uploads vindas do admin (redireciona para o Render)
app.use('/uploads', (req, res) => {
  res.redirect(`https://${ADMIN_URL}/uploads${req.url}`);
});

// Middleware JSON
app.use(express.json());

// --- ROTAS DE PÁGINAS ---
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "views", "index.html")));
app.get("/index", (req, res) => res.sendFile(path.join(__dirname, "views", "index.html")));
app.get("/sobre", (req, res) => res.sendFile(path.join(__dirname, "views", "sobre.html")));
app.get("/cursos", (req, res) => res.sendFile(path.join(__dirname, "views", "cursos.html")));
app.get("/docente", (req, res) => res.sendFile(path.join(__dirname, "views", "docente.html")));
app.get("/contato", (req, res) => res.sendFile(path.join(__dirname, "views", "contato.html")));
app.get("/alunos", (req, res) => res.sendFile(path.join(__dirname, "views", "alunos.html")));
app.get("/responsaveis", (req, res) => res.sendFile(path.join(__dirname, "views", "responsaveis.html")));
app.get("/novidades", (req, res) => res.sendFile(path.join(__dirname, "views", "novidades.html")));
app.get("/noticias", (req, res) => res.sendFile(path.join(__dirname, "views", "noticias.html")));
app.get("/footer.html", (req, res) => res.sendFile(path.join(__dirname, "views", "footer.html")));

// --- CONFIG LOCAL ---
app.get("/api/config", (req, res) => {
  const configPath = path.join(__dirname, "config.json");
  try {
    if (fs.existsSync(configPath)) {
      res.json(JSON.parse(fs.readFileSync(configPath, 'utf8')));
    } else {
      res.json({ siteTitle: "GETECO", description: "Gestão Escolar" });
    }
  } catch (error) {
    res.status(500).json({ error: "Erro ao ler configuração" });
  }
});

app.post("/api/update-config", (req, res) => {
  const { siteTitle, description } = req.body;
  const configPath = path.join(__dirname, "config.json");
  try {
    const config = { siteTitle: siteTitle || "GETECO", description: description || "Gestão Escolar" };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: "Erro ao atualizar configuração" });
  }
});

// ✅ PROXY: repassa /api/* para o admin-server no Render
app.use('/api', (req, res) => {
  const options = {
    hostname: ADMIN_URL,
    port: 443,
    path: '/api' + req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: ADMIN_URL
    }
  };

  const proxy = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxy.on('error', (err) => {
    console.error('Erro no proxy:', err.message);
    res.status(503).json({ error: 'Admin server indisponível.' });
  });

  req.pipe(proxy);
});

app.listen(PORT, () => {
  console.log(`[Public Site] Servidor rodando em http://localhost:${PORT}`);
});