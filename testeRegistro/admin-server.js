const express = require("express");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const admin = require("firebase-admin");
const fs = require("fs");
const cloudinary = require("cloudinary").v2;

// --- INICIALIZAÇÃO DO FIREBASE ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const auth = admin.auth();

const app = express();
const PORT = process.env.PORT || 3000;

// --- CLOUDINARY (armazenamento de imagens) ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer salva o arquivo em memória (sem tocar no disco do servidor)
const upload = multer({ storage: multer.memoryStorage() });

// Função que envia a imagem para o Cloudinary e retorna a URL pública permanente
async function uploadImagem(file) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: 'geteco' },
            (error, result) => {
                if (error) reject(error);
                else resolve(result.secure_url);
            }
        );
        stream.end(file.buffer);
    });
}

// --- MIDDLEWARES ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// CORS: Permite o site público (5000) e o admin (3000) quando executando o arquivo para testes locais
app.use(cors({ 
    origin: ['http://localhost:5000', 'http://localhost:3000', 'https://sitegeteco.onrender.com', 'https://escola-geteco.onrender.com'],
    credentials: true 
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// Auth Middleware
async function requireAdmin(req, res, next) {
    const sessionCookie = req.cookies.session || '';
    try {
        const claims = await auth.verifySessionCookie(sessionCookie, true);
        if (claims.isAdmin) { req.user = claims; return next(); }
        res.status(403).redirect("/login");
    } catch (e) { res.status(401).redirect("/login"); }
}

// Rotas de Visualização
const views = path.join(__dirname, 'views');
app.get("/login", (req, res) => res.sendFile(path.join(views, "login.html")));
app.get("/register", (req, res) => res.sendFile(path.join(views, "register.html")));
app.get("/dashboard", requireAdmin, (req, res) => res.sendFile(path.join(views, "dashboard.html")));
app.get("/aguardando", (req, res) => res.sendFile(path.join(views, "aguardando.html")));
app.get("/", (req, res) => res.redirect("/login"));

// API Login
app.post("/sessionLogin", async (req, res) => {
    try {
        const { idToken } = req.body;
        const decoded = await auth.verifyIdToken(idToken);
        if (!decoded.isAdmin) return res.status(403).send('Não autorizado');
        const cookie = await auth.createSessionCookie(idToken, { expiresIn: 432000000 }); // 5 dias
        res.cookie('session', cookie, { maxAge: 432000000, httpOnly: true });
        res.json({ status: 'success' });
    } catch (e) { res.status(401).send('Erro'); }
});

app.post("/checkAdmin", async (req, res) => {
    try {
        const decoded = await auth.verifyIdToken(req.body.idToken);
        res.json({ isAdmin: decoded.isAdmin === true });
    } catch (e) { res.status(401).json({ error: 'Token inválido' }); }
});

app.post('/register', async (req, res) => {
    try {
        const { uid, email, timestamp } = req.body;
        if (!uid || !email) {
            return res.status(400).json({ error: 'Dados de registro incompletos.' });
        }

        const user = await auth.getUser(uid);
        if (user.email !== email) {
            return res.status(400).json({ error: 'Dados de usuário inválidos.' });
        }

        await auth.setCustomUserClaims(uid, { status: 'pending' });
        await db.collection('registrations').doc(uid).set({
            email,
            uid,
            status: 'pending',
            requestedAt: timestamp ? new Date(timestamp) : new Date()
        });

        res.json({ success: true });
    } catch (e) {
        console.error('Erro ao processar registro:', e);
        res.status(500).json({ error: 'Não foi possível processar o registro.' });
    }
});

app.get("/logout", (req, res) => {
    res.clearCookie('session');
    res.redirect('/login');
});

// --- CRUD GENÉRICO (EXCETO DOCENTE) ---
const collections = ['noticias', 'novidades', 'cursos', 'contato', 'cargos'];

collections.forEach(col => {
    // Listar
    app.get(`/api/${col}`, async (req, res) => {
        const snap = await db.collection(col).get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // Criar
    app.post(`/api/${col}`, requireAdmin, upload.single('imagem'), async (req, res) => {
        const data = { ...req.body, data: new Date() };
        if (req.file) data.imagem = await uploadImagem(req.file);
        
        const ref = await db.collection(col).add(data);
        
        // Log simples
        db.collection('logs').add({
            adminEmail: req.user.email,
            action: 'criou',
            collection: col,
            details: data.titulo || data.nome || data.cargo,
            timestamp: new Date()
        });

        res.json({ success: true, id: ref.id });
    });

    // Deletar
    app.delete(`/api/${col}/:id`, requireAdmin, async (req, res) => {
        await db.collection(col).doc(req.params.id).delete();
        res.json({ success: true });
    });
});

// --- CRUD DOCENTE (campo foto separado) ---

// Listar docentes
app.get('/api/docente', async (req, res) => {
    const snap = await db.collection('docente').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

// Criar docente — campo de upload é 'foto', salvo como 'foto' no Firestore
app.post('/api/docente', requireAdmin, upload.single('foto'), async (req, res) => {
    const data = {
        nome: req.body.nome || '',
        cargo: req.body.cargo || '',
        materia: req.body.materia || '',
        foto: '',          // campo foto sempre presente no documento
        data: new Date()
    };

    if (req.file) {
        // URL pública permanente gerada pelo Cloudinary
        data.foto = await uploadImagem(req.file);
    }

    const ref = await db.collection('docente').add(data);

    db.collection('logs').add({
        adminEmail: req.user.email,
        action: 'criou',
        collection: 'docente',
        details: data.nome,
        timestamp: new Date()
    });

    res.json({ success: true, id: ref.id });
});

// Deletar docente
app.delete('/api/docente/:id', requireAdmin, async (req, res) => {
    await db.collection('docente').doc(req.params.id).delete();
    res.json({ success: true });
});

// Dados Únicos (Alunos/Responsaveis)
['alunos', 'responsaveis'].forEach(col => {
    app.get(`/api/${col}`, async (req, res) => {
        const doc = await db.collection(col).doc('main').get();
        res.json(doc.data() || {});
    });
    app.post(`/api/${col}`, requireAdmin, async (req, res) => {
        await db.collection(col).doc('main').set(req.body, { merge: true });
        res.json({ success: true });
    });
});

// Pendentes e Logs
app.get('/api/pendentes', requireAdmin, async (req, res) => {
    const list = await auth.listUsers(100);
    res.json(list.users.filter(u => u.customClaims?.status === 'pending').map(u => ({ uid: u.uid, username: u.email })));
});
app.post('/api/pendentes/aceitar', requireAdmin, async (req, res) => {
    await auth.setCustomUserClaims(req.body.uid, { isAdmin: true, status: null });
    res.json({ success: true });
});
app.post('/api/pendentes/negar', requireAdmin, async (req, res) => {
    await auth.deleteUser(req.body.uid);
    res.json({ success: true });
});
app.get('/api/logs', requireAdmin, async (req, res) => {
    const snap = await db.collection('logs').orderBy('timestamp', 'desc').limit(20).get();
    res.json(snap.docs.map(d => d.data()));
});
// GET uma postagem por ID
app.get('/api/novidades/:id', async (req, res) => {
    try {
        const doc = await db.collection('novidades').doc(req.params.id).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Postagem não encontrada' });
        }
        res.json({ id: doc.id, ...doc.data() });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao buscar postagem' });
    }
});

// PUT atualizar uma postagem
app.put('/api/novidades/:id', requireAdmin, async (req, res) => {
    try {
        const { titulo, conteudo } = req.body;
        
        if (!titulo || !conteudo) {
            return res.status(400).json({ error: 'Título e conteúdo são obrigatórios' });
        }

        await db.collection('novidades').doc(req.params.id).update({
            titulo: titulo,
            conteudo: conteudo,
            dataAtualizacao: new Date()
        });

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao atualizar' });
    }
});
// Iniciar servidor de maneira local "NPM START"(Para testes!!!)
app.listen(PORT, () => {
    console.log(`Admin Server rodando em http://localhost:${PORT}`);
});



/*const express = require("express");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const admin = require("firebase-admin");
const fs = require("fs");

// --- INICIALIZAÇÃO DO FIREBASE ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const auth = admin.auth();

const app = express();
const PORT = process.env.PORT || 3000;

// --- UPLOAD ---
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// --- MIDDLEWARES ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(cors({
    origin: ['http://localhost:5000', 'http://localhost:3000', 'https://sitegeteco.onrender.com', 'https://escola-geteco.onrender.com'],
    credentials: true
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// Auth Middleware
async function requireAdmin(req, res, next) {
    const sessionCookie = req.cookies.session || '';
    try {
        const claims = await auth.verifySessionCookie(sessionCookie, true);
        if (claims.isAdmin) { req.user = claims; return next(); }
        res.status(403).redirect("/login");
    } catch (e) { res.status(401).redirect("/login"); }
}

// Rotas de Visualização
const views = path.join(__dirname, 'views');
app.get("/login", (req, res) => res.sendFile(path.join(views, "login.html")));
app.get("/register", (req, res) => res.sendFile(path.join(views, "register.html")));
app.get("/dashboard", requireAdmin, (req, res) => res.sendFile(path.join(views, "dashboard.html")));
app.get("/aguardando", (req, res) => res.sendFile(path.join(views, "aguardando.html")));
app.get("/", (req, res) => res.redirect("/login"));

// API Login
app.post("/sessionLogin", async (req, res) => {
    try {
        const { idToken } = req.body;
        const decoded = await auth.verifyIdToken(idToken);
        if (!decoded.isAdmin) return res.status(403).send('Não autorizado');
        const cookie = await auth.createSessionCookie(idToken, { expiresIn: 432000000 });
        res.cookie('session', cookie, { maxAge: 432000000, httpOnly: true });
        res.json({ status: 'success' });
    } catch (e) { res.status(401).send('Erro'); }
});

app.post("/checkAdmin", async (req, res) => {
    try {
        const decoded = await auth.verifyIdToken(req.body.idToken);
        res.json({ isAdmin: decoded.isAdmin === true });
    } catch (e) { res.status(401).json({ error: 'Token inválido' }); }
});

app.post('/register', async (req, res) => {
    try {
        const { uid, email, timestamp } = req.body;
        if (!uid || !email) return res.status(400).json({ error: 'Dados de registro incompletos.' });
        const user = await auth.getUser(uid);
        if (user.email !== email) return res.status(400).json({ error: 'Dados de usuário inválidos.' });
        await auth.setCustomUserClaims(uid, { status: 'pending' });
        await db.collection('registrations').doc(uid).set({
            email, uid, status: 'pending',
            requestedAt: timestamp ? new Date(timestamp) : new Date()
        });
        res.json({ success: true });
    } catch (e) {
        console.error('Erro ao processar registro:', e);
        res.status(500).json({ error: 'Não foi possível processar o registro.' });
    }
});

app.get("/logout", (req, res) => {
    res.clearCookie('session');
    res.redirect('/login');
});

// --- CRUD GENÉRICO (noticias, novidades, cursos, contato, cargos) ---
const collections = ['noticias', 'novidades', 'cursos', 'contato', 'cargos'];

collections.forEach(col => {
    // Listar
    app.get(`/api/${col}`, async (req, res) => {
        const snap = await db.collection(col).get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // Buscar por ID
    app.get(`/api/${col}/:id`, async (req, res) => {
        try {
            const doc = await db.collection(col).doc(req.params.id).get();
            if (!doc.exists) return res.status(404).json({ error: 'Item não encontrado' });
            res.json({ id: doc.id, ...doc.data() });
        } catch (e) { res.status(500).json({ error: 'Erro ao buscar item' }); }
    });

    // Criar
    app.post(`/api/${col}`, requireAdmin, upload.single('imagem'), async (req, res) => {
        const data = { ...req.body, data: new Date() };
        if (req.file) data.imagem = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        const ref = await db.collection(col).add(data);
        db.collection('logs').add({
            adminEmail: req.user.email, action: 'criou', collection: col,
            details: data.titulo || data.nome || data.cargo, timestamp: new Date()
        });
        res.json({ success: true, id: ref.id });
    });

    // ✅ NOVO: Editar
    app.put(`/api/${col}/:id`, requireAdmin, upload.single('imagem'), async (req, res) => {
        try {
            const data = { ...req.body, dataAtualizacao: new Date() };
            // Remove campos vazios
            Object.keys(data).forEach(k => { if (data[k] === '') delete data[k]; });
            if (req.file) data.imagem = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
            await db.collection(col).doc(req.params.id).update(data);
            db.collection('logs').add({
                adminEmail: req.user.email, action: 'editou', collection: col,
                details: data.titulo || data.nome || data.cargo || req.params.id, timestamp: new Date()
            });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: 'Erro ao atualizar' }); }
    });

    // Deletar
    app.delete(`/api/${col}/:id`, requireAdmin, async (req, res) => {
        await db.collection(col).doc(req.params.id).delete();
        db.collection('logs').add({
            adminEmail: req.user?.email || 'admin', action: 'excluiu', collection: col,
            details: req.params.id, timestamp: new Date()
        });
        res.json({ success: true });
    });
});

// --- CRUD DOCENTE ---
app.get('/api/docente', async (req, res) => {
    const snap = await db.collection('docente').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

app.get('/api/docente/:id', async (req, res) => {
    try {
        const doc = await db.collection('docente').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Docente não encontrado' });
        res.json({ id: doc.id, ...doc.data() });
    } catch (e) { res.status(500).json({ error: 'Erro ao buscar docente' }); }
});

app.post('/api/docente', requireAdmin, upload.single('foto'), async (req, res) => {
    const data = {
        nome: req.body.nome || '',
        cargo: req.body.cargo || '',
        materia: req.body.materia || '',
        foto: '',
        data: new Date()
    };
    if (req.file) data.foto = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    const ref = await db.collection('docente').add(data);
    db.collection('logs').add({
        adminEmail: req.user.email, action: 'criou', collection: 'docente',
        details: data.nome, timestamp: new Date()
    });
    res.json({ success: true, id: ref.id });
});

// ✅ NOVO: Editar docente
app.put('/api/docente/:id', requireAdmin, upload.single('foto'), async (req, res) => {
    try {
        const data = {
            nome: req.body.nome,
            cargo: req.body.cargo,
            materia: req.body.materia,
            dataAtualizacao: new Date()
        };
        // Remove campos vazios
        Object.keys(data).forEach(k => { if (!data[k]) delete data[k]; });
        if (req.file) data.foto = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        await db.collection('docente').doc(req.params.id).update(data);
        db.collection('logs').add({
            adminEmail: req.user.email, action: 'editou', collection: 'docente',
            details: data.nome || req.params.id, timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao atualizar docente' }); }
});

app.delete('/api/docente/:id', requireAdmin, async (req, res) => {
    await db.collection('docente').doc(req.params.id).delete();
    res.json({ success: true });
});

// Dados Únicos (Alunos/Responsaveis)
['alunos', 'responsaveis'].forEach(col => {
    app.get(`/api/${col}`, async (req, res) => {
        const doc = await db.collection(col).doc('main').get();
        res.json(doc.data() || {});
    });
    app.post(`/api/${col}`, requireAdmin, async (req, res) => {
        await db.collection(col).doc('main').set(req.body, { merge: true });
        res.json({ success: true });
    });
});

// Pendentes e Logs
app.get('/api/pendentes', requireAdmin, async (req, res) => {
    const list = await auth.listUsers(100);
    res.json(list.users.filter(u => u.customClaims?.status === 'pending').map(u => ({ uid: u.uid, username: u.email })));
});
app.post('/api/pendentes/aceitar', requireAdmin, async (req, res) => {
    await auth.setCustomUserClaims(req.body.uid, { isAdmin: true, status: null });
    res.json({ success: true });
});
app.post('/api/pendentes/negar', requireAdmin, async (req, res) => {
    await auth.deleteUser(req.body.uid);
    res.json({ success: true });
});
app.get('/api/logs', requireAdmin, async (req, res) => {
    const snap = await db.collection('logs').orderBy('timestamp', 'desc').limit(20).get();
    res.json(snap.docs.map(d => d.data()));
});

app.listen(PORT, () => {
    console.log(`Admin Server rodando em http://localhost:${PORT}`);
});*/