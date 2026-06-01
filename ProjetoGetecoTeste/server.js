const express = require("express");
const path = require("path");
const fs = require("fs");
const http = require("http");
const app = express();
const PORT = process.env.PORT || 5000;

// Define a pasta 'ProjetoGetecoTeste' como o diretório raiz para servir ficheiros estáticos (CSS, JS, Imagens)
app.use(express.static(path.join(__dirname)));

// ✅ CORREÇÃO: Servir imagens de uploads do admin-server (porta 3000)
app.use('/uploads', express.static(path.join(__dirname, '..', 'testeRegistro', 'public', 'uploads')));

// --- MIDDLEWARE PARA JSON ---
app.use(express.json());

// --- ROTAS PARA TODAS AS PÁGINAS HTML ---
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

// --- ROTAS DE CONFIG (arquivo local) ---
app.get("/api/config", (req, res) => {
  const configPath = path.join(__dirname, "config.json");
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      res.json(JSON.parse(data));
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
    const config = {
      siteTitle: siteTitle || "GETECO",
      description: description || "Gestão Escolar"
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    res.json({ success: true, message: "Configuração atualizada com sucesso!" });
  } catch (error) {
    res.status(500).json({ success: false, error: "Erro ao atualizar configuração" });
  }
});

// ✅ CORREÇÃO: Proxy para repassar /api/* ao admin-server na porta 3000
// Isso faz alunos, contato, cursos, responsaveis, noticias, docente, etc. funcionarem
app.use('/api', (req, res) => {
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api' + req.url,
    method: req.method,
    headers: { ...req.headers, host: 'localhost:3000' }
  };

  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxy.on('error', () => {
    res.status(503).json({ error: 'Admin server indisponível. Certifique-se que está rodando na porta 3000.' });
  });

  req.pipe(proxy);
});

app.listen(PORT, () => {
  console.log(`[Public Site] Servidor do site principal a correr em http://localhost:${PORT}`);
});