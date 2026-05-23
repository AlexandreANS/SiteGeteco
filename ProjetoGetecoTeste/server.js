const express = require("express");
const path = require("path");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 5000;

// Define a pasta 'ProjetoGetecoTeste' como o diretório raiz para servir ficheiros estáticos (CSS, JS, Imagens)
app.use(express.static(path.join(__dirname)));

// --- MIDDLEWARE PARA JSON ---
app.use(express.json());

// --- ROTAS PARA TODAS AS PÁGINAS HTML ---

// Rota para a página inicial
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});
app.get("/index", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

// Rota para a página Sobre
app.get("/sobre", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "sobre.html"));
});

// Rota para a página Cursos
app.get("/cursos", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "cursos.html"));
});

// Rota para a página Docentes
app.get("/docente", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "docente.html"));
});

// Rota para a página Contato
app.get("/contato", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "contato.html"));
});

// Rota para a página Alunos
app.get("/alunos", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "alunos.html"));
});

// Rota para a página Responsáveis
app.get("/responsaveis", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "responsaveis.html"));
});

// Rota para a página Novidades
app.get("/novidades", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "novidades.html"));
});

// Rota para a página de Notícias
app.get("/noticias", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "noticias.html"));
});

// Rota para o ficheiro do rodapé, necessário para o main.js
app.get("/footer.html", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "footer.html"));
});

// ============================================================
// ✅ NOVAS ROTAS DE API PARA CONFIG
// ============================================================

// GET - Buscar configuração
app.get("/api/config", (req, res) => {
  const configPath = path.join(__dirname, "config.json");
  
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(data);
      res.json(config);
    } else {
      res.json({ siteTitle: "GETECO", description: "Gestão Escolar" });
    }
  } catch (error) {
    res.status(500).json({ error: "Erro ao ler configuração" });
  }
});

// POST - Atualizar configuração
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

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`[Public Site] Servidor do site principal a correr em http://localhost:${PORT}`);
});