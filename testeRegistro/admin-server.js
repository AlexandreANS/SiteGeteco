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

// --- CLOUDINARY ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

console.log('CLOUDINARY_CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME || 'NÃO DEFINIDO');
console.log('CLOUDINARY_API_KEY:', process.env.CLOUDINARY_API_KEY || 'NÃO DEFINIDO');
console.log('CLOUDINARY_API_SECRET:', process.env.CLOUDINARY_API_SECRET ? 'DEFINIDO' : 'NÃO DEFINIDO');

const upload = multer({ storage: multer.memoryStorage() });

async function uploadImagem(file) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: 'geteco' },
            (error, result) => {
                if (error) { console.error('CLOUDINARY ERRO:', JSON.stringify(error)); reject(error); }
                else { console.log('CLOUDINARY SUCESSO:', result.secure_url); resolve(result.secure_url); }
            }
        );
        stream.end(file.buffer);
    });
}

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
app.get("/edit-post", requireAdmin, (req, res) => res.sendFile(path.join(views, "edit-post.html")));
app.get("/", (req, res) => res.redirect("/login"));

// API Login
app.post("/sessionLogin", async (req, res) => {
    try {
        const { idToken } = req.body;
        const decoded = await auth.verifyIdToken(idToken);
        if (!decoded.isAdmin) return res.status(403).send('Não autorizado');
        const cookie = await auth.createSessionCookie(idToken, { expiresIn: 432000000 });
        res.cookie('session', cookie, { maxAge: 432000000, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
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
    app.get(`/api/${col}`, async (req, res) => {
        try {
            const snap = await db.collection(col).get();
            res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        } catch (e) { res.status(500).json({ error: 'Erro ao listar.' }); }
    });

    app.get(`/api/${col}/:id`, async (req, res) => {
        try {
            const doc = await db.collection(col).doc(req.params.id).get();
            if (!doc.exists) return res.status(404).json({ error: 'Item não encontrado' });
            res.json({ id: doc.id, ...doc.data() });
        } catch (e) { res.status(500).json({ error: 'Erro ao buscar item.' }); }
    });

    app.post(`/api/${col}`, requireAdmin, upload.single('imagem'), async (req, res) => {
        try {
            const data = { ...req.body, data: new Date() };
            if (req.file) data.imagem = await uploadImagem(req.file);
            const ref = await db.collection(col).add(data);
            db.collection('logs').add({
                adminEmail: req.user.email, action: 'criou', collection: col,
                details: data.titulo || data.nome || data.cargo, timestamp: new Date()
            });
            res.json({ success: true, id: ref.id });
        } catch (e) {
            console.error(`ERRO ao criar em ${col}:`, JSON.stringify(e));
            res.status(500).json({ error: 'Erro ao criar registro.', detalhe: e.message });
        }
    });

    app.put(`/api/${col}/:id`, requireAdmin, upload.single('imagem'), async (req, res) => {
        try {
            const data = { ...req.body, dataAtualizacao: new Date() };
            Object.keys(data).forEach(k => { if (data[k] === '') delete data[k]; });
            if (req.file) data.imagem = await uploadImagem(req.file);
            await db.collection(col).doc(req.params.id).update(data);
            db.collection('logs').add({
                adminEmail: req.user.email, action: 'editou', collection: col,
                details: data.titulo || data.nome || data.cargo || req.params.id, timestamp: new Date()
            });
            res.json({ success: true });
        } catch (e) {
            console.error(`ERRO ao editar em ${col}:`, JSON.stringify(e));
            res.status(500).json({ error: 'Erro ao editar registro.', detalhe: e.message });
        }
    });

    app.delete(`/api/${col}/:id`, requireAdmin, async (req, res) => {
        try {
            await db.collection(col).doc(req.params.id).delete();
            db.collection('logs').add({
                adminEmail: req.user?.email || 'admin', action: 'excluiu', collection: col,
                details: req.params.id, timestamp: new Date()
            });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: 'Erro ao deletar.' }); }
    });
});

// --- CRUD DOCENTE ---
app.get('/api/docente', async (req, res) => {
    try {
        const snap = await db.collection('docente').get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { res.status(500).json({ error: 'Erro ao listar docentes.' }); }
});

app.get('/api/docente/:id', async (req, res) => {
    try {
        const doc = await db.collection('docente').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Docente não encontrado' });
        res.json({ id: doc.id, ...doc.data() });
    } catch (e) { res.status(500).json({ error: 'Erro ao buscar docente.' }); }
});

app.post('/api/docente', requireAdmin, upload.single('foto'), async (req, res) => {
    try {
        const data = {
            nome: req.body.nome || '',
            cargo: req.body.cargo || '',
            materia: req.body.materia || '',
            foto: '',
            data: new Date()
        };
        if (req.file) data.foto = await uploadImagem(req.file);
        const ref = await db.collection('docente').add(data);
        db.collection('logs').add({
            adminEmail: req.user.email, action: 'criou', collection: 'docente',
            details: data.nome, timestamp: new Date()
        });
        res.json({ success: true, id: ref.id });
    } catch (e) {
        console.error('ERRO ao criar docente:', JSON.stringify(e));
        res.status(500).json({ error: 'Erro ao criar docente.', detalhe: e.message });
    }
});

app.put('/api/docente/:id', requireAdmin, upload.single('foto'), async (req, res) => {
    try {
        const data = {
            nome: req.body.nome,
            cargo: req.body.cargo,
            materia: req.body.materia,
            dataAtualizacao: new Date()
        };
        Object.keys(data).forEach(k => { if (!data[k]) delete data[k]; });
        if (req.file) data.foto = await uploadImagem(req.file);
        await db.collection('docente').doc(req.params.id).update(data);
        db.collection('logs').add({
            adminEmail: req.user.email, action: 'editou', collection: 'docente',
            details: data.nome || req.params.id, timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) {
        console.error('ERRO ao editar docente:', JSON.stringify(e));
        res.status(500).json({ error: 'Erro ao editar docente.', detalhe: e.message });
    }
});

app.delete('/api/docente/:id', requireAdmin, async (req, res) => {
    try {
        await db.collection('docente').doc(req.params.id).delete();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao deletar docente.' }); }
});

// --- DADOS ÚNICOS (calendário de alunos e responsáveis — inalterado) ---
['alunos', 'responsaveis'].forEach(col => {
    app.get(`/api/${col}`, async (req, res) => {
        try {
            const doc = await db.collection(col).doc('main').get();
            res.json(doc.data() || {});
        } catch (e) { res.status(500).json({ error: 'Erro ao buscar dados.' }); }
    });
    app.post(`/api/${col}`, requireAdmin, async (req, res) => {
        try {
            await db.collection(col).doc('main').set(req.body, { merge: true });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: 'Erro ao salvar dados.' }); }
    });
});

// --- PENDENTES E LOGS ---
app.get('/api/pendentes', requireAdmin, async (req, res) => {
    try {
        const list = await auth.listUsers(100);
        res.json(list.users.filter(u => u.customClaims?.status === 'pending').map(u => ({ uid: u.uid, username: u.email })));
    } catch (e) { res.status(500).json({ error: 'Erro ao listar pendentes.' }); }
});
app.post('/api/pendentes/aceitar', requireAdmin, async (req, res) => {
    try {
        const { uid } = req.body;
        await auth.setCustomUserClaims(uid, { isAdmin: true, status: null });
        // Atualiza também o documento de registo no Firestore
        await db.collection('registrations').doc(uid).update({
            status: 'approved',
            approvedAt: new Date(),
            approvedBy: req.user.email
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao aceitar.' }); }
});
app.post('/api/pendentes/negar', requireAdmin, async (req, res) => {
    try {
        const { uid } = req.body;
        // Marca o registo como negado antes de apagar o utilizador
        await db.collection('registrations').doc(uid).update({
            status: 'denied',
            deniedAt: new Date(),
            deniedBy: req.user.email
        }).catch(() => {}); // ignora se o documento já não existir
        await auth.deleteUser(uid);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao negar.' }); }
});
app.get('/api/logs', requireAdmin, async (req, res) => {
    try {
        const snap = await db.collection('logs').orderBy('timestamp', 'desc').limit(20).get();
        res.json(snap.docs.map(d => d.data()));
    } catch (e) { res.status(500).json({ error: 'Erro ao buscar logs.' }); }
});

// ══════════════════════════════════════════════════════════════════
// BIBLIOTECA
// ══════════════════════════════════════════════════════════════════

// --- ALUNOS DA BIBLIOTECA (coleção independente do calendário) ---
app.get('/api/alunosBib', requireAdmin, async (req, res) => {
    try {
        const snap = await db.collection('alunosBib').get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { res.status(500).json({ error: 'Erro ao listar alunos.' }); }
});

app.get('/api/alunosBib/:id', requireAdmin, async (req, res) => {
    try {
        const doc = await db.collection('alunosBib').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Aluno não encontrado.' });
        res.json({ id: doc.id, ...doc.data() });
    } catch (e) { res.status(500).json({ error: 'Erro ao buscar aluno.' }); }
});

// POST recebe JSON (frontend envia assim para coleções sem arquivo)
app.post('/api/alunosBib', requireAdmin, async (req, res) => {
    try {
        const { matricula, nome } = req.body;
        if (!matricula || !nome) return res.status(400).json({ error: 'Matrícula e nome são obrigatórios.' });
        // Correção 1: impede matrículas duplicadas
        const existente = await db.collection('alunosBib').where('matricula', '==', matricula).limit(1).get();
        if (!existente.empty) return res.status(400).json({ error: 'Já existe um aluno com essa matrícula.' });
        const ref = await db.collection('alunosBib').add({ matricula, nome, criadoEm: new Date() });
        db.collection('logs').add({
            adminEmail: req.user.email, action: 'criou', collection: 'alunosBib',
            details: `${nome} (${matricula})`, timestamp: new Date()
        });
        res.json({ success: true, id: ref.id });
    } catch (e) { res.status(500).json({ error: 'Erro ao cadastrar aluno.' }); }
});

// PUT recebe JSON (o modal de edição envia JSON para coleções sem arquivo)
app.put('/api/alunosBib/:id', requireAdmin, async (req, res) => {
    try {
        const { matricula, nome } = req.body;
        if (!matricula || !nome) return res.status(400).json({ error: 'Matrícula e nome são obrigatórios.' });
        // Correção 6: impede que a edição gere matrícula duplicada (exclui o próprio documento)
        const existente = await db.collection('alunosBib').where('matricula', '==', matricula).limit(1).get();
        if (!existente.empty && existente.docs[0].id !== req.params.id) {
            return res.status(400).json({ error: 'Já existe outro aluno com essa matrícula.' });
        }
        await db.collection('alunosBib').doc(req.params.id).update({ matricula, nome, atualizadoEm: new Date() });
        db.collection('logs').add({
            adminEmail: req.user.email, action: 'editou', collection: 'alunosBib',
            details: `${nome} (${matricula})`, timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao editar aluno.' }); }
});

app.delete('/api/alunosBib/:id', requireAdmin, async (req, res) => {
    try {
        // Correção 3: impede excluir aluno com empréstimos em andamento
        const empAtivos = await db.collection('emprestimos')
            .where('alunoId', '==', req.params.id)
            .where('devolvido', '==', false)
            .get();
        if (!empAtivos.empty) {
            return res.status(400).json({ error: 'Não é possível excluir um aluno com empréstimos em andamento.' });
        }
        await db.collection('alunosBib').doc(req.params.id).delete();
        db.collection('logs').add({
            adminEmail: req.user?.email || 'admin', action: 'excluiu',
            collection: 'alunosBib', details: req.params.id, timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao excluir aluno.' }); }
});

// --- LIVROS ---
app.get('/api/livros', async (req, res) => {
    try {
        const snap = await db.collection('livros').get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { res.status(500).json({ error: 'Erro ao listar livros.' }); }
});

app.get('/api/livros/:id', async (req, res) => {
    try {
        const doc = await db.collection('livros').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Livro não encontrado.' });
        res.json({ id: doc.id, ...doc.data() });
    } catch (e) { res.status(500).json({ error: 'Erro ao buscar livro.' }); }
});

app.post('/api/livros', requireAdmin, async (req, res) => {
    try {
        const { codigo, nome, autor } = req.body;
        if (!codigo || !nome || !autor) return res.status(400).json({ error: 'Código, título e autor são obrigatórios.' });
        // Correção 2: impede códigos duplicados
        const existente = await db.collection('livros').where('codigo', '==', codigo).limit(1).get();
        if (!existente.empty) return res.status(400).json({ error: 'Já existe um livro com esse código.' });
        const ref = await db.collection('livros').add({ codigo, nome, autor, emprestado: false, criadoEm: new Date() });
        db.collection('logs').add({
            adminEmail: req.user.email, action: 'criou', collection: 'livros',
            details: `${nome} — ${autor}`, timestamp: new Date()
        });
        res.json({ success: true, id: ref.id });
    } catch (e) { res.status(500).json({ error: 'Erro ao cadastrar livro.' }); }
});

app.put('/api/livros/:id', requireAdmin, async (req, res) => {
    try {
        const { codigo, nome, autor } = req.body;
        if (!codigo || !nome || !autor) return res.status(400).json({ error: 'Código, título e autor são obrigatórios.' });
        // Correção 6: impede que a edição gere código duplicado (exclui o próprio documento)
        const existente = await db.collection('livros').where('codigo', '==', codigo).limit(1).get();
        if (!existente.empty && existente.docs[0].id !== req.params.id) {
            return res.status(400).json({ error: 'Já existe outro livro com esse código.' });
        }
        await db.collection('livros').doc(req.params.id).update({ codigo, nome, autor, atualizadoEm: new Date() });
        db.collection('logs').add({
            adminEmail: req.user.email, action: 'editou', collection: 'livros',
            details: `${nome} — ${autor}`, timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao editar livro.' }); }
});

app.delete('/api/livros/:id', requireAdmin, async (req, res) => {
    try {
        const doc = await db.collection('livros').doc(req.params.id).get();
        // Correção original: impede excluir livro atualmente emprestado
        if (doc.exists && doc.data().emprestado) {
            return res.status(400).json({ error: 'Não é possível excluir um livro que está emprestado.' });
        }
        // Correção 4: impede excluir livro com qualquer histórico de empréstimos
        const historico = await db.collection('emprestimos').where('livroId', '==', req.params.id).limit(1).get();
        if (!historico.empty) {
            return res.status(400).json({ error: 'Não é possível excluir um livro que possui histórico de empréstimos.' });
        }
        await db.collection('livros').doc(req.params.id).delete();
        db.collection('logs').add({
            adminEmail: req.user?.email || 'admin', action: 'excluiu',
            collection: 'livros', details: req.params.id, timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao excluir livro.' }); }
});

// --- EMPRÉSTIMOS ---
// Listar (todos ou só os ativos via ?ativos=true)
app.get('/api/emprestimos', requireAdmin, async (req, res) => {
    try {
        let snap;
        if (req.query.ativos === 'true') {
            snap = await db.collection('emprestimos').where('devolvido', '==', false).get();
        } else {
            snap = await db.collection('emprestimos').get();
        }
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { res.status(500).json({ error: 'Erro ao listar empréstimos.' }); }
});

// Histórico de empréstimos de um aluno
// ATENÇÃO: esta rota deve vir ANTES de qualquer /api/emprestimos/:id
app.get('/api/emprestimos/aluno/:id', requireAdmin, async (req, res) => {
    try {
        const snap = await db.collection('emprestimos')
            .where('alunoId', '==', req.params.id)
            .get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { res.status(500).json({ error: 'Erro ao buscar empréstimos do aluno.' }); }
});

// Histórico de empréstimos de um livro
app.get('/api/emprestimos/livro/:id', requireAdmin, async (req, res) => {
    try {
        const snap = await db.collection('emprestimos')
            .where('livroId', '==', req.params.id)
            .get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { res.status(500).json({ error: 'Erro ao buscar empréstimos do livro.' }); }
});

// Registrar empréstimo
app.post('/api/emprestimos', requireAdmin, async (req, res) => {
    try {
        const { alunoId, livroId } = req.body;
        if (!alunoId || !livroId) return res.status(400).json({ error: 'Aluno e livro são obrigatórios.' });

        // Leitura e escrita dentro da mesma transação — garante atomicidade real.
        // Correção 5 e 7: aluno também é validado e os dados são buscados do Firestore,
        // não confiando nos valores enviados pelo frontend.
        const alunoRef = db.collection('alunosBib').doc(alunoId);
        const livroRef = db.collection('livros').doc(livroId);
        let logNomeAluno = '', logNomeLivro = '';

        await db.runTransaction(async t => {
            const [alunoSnap, livroSnap] = await Promise.all([t.get(alunoRef), t.get(livroRef)]);

            if (!alunoSnap.exists) throw Object.assign(new Error('Aluno não encontrado.'), { code: 404 });
            if (!livroSnap.exists) throw Object.assign(new Error('Livro não encontrado.'), { code: 404 });
            if (livroSnap.data().emprestado) throw Object.assign(new Error('Este livro já está emprestado.'), { code: 400 });

            const aluno = alunoSnap.data();
            const livro = livroSnap.data();
            logNomeAluno = aluno.nome;
            logNomeLivro = livro.nome;

            const empRef = db.collection('emprestimos').doc();
            t.set(empRef, {
                alunoId, livroId,
                // Dados vindos do Firestore, não do cliente
                alunoNome: aluno.nome,
                alunoMatricula: aluno.matricula,
                livroNome: livro.nome,
                livroCodigo: livro.codigo,
                dataEmprestimo: new Date(),
                devolvido: false
            });
            t.update(livroRef, { emprestado: true });
        });

        db.collection('logs').add({
            adminEmail: req.user.email, action: 'emprestou', collection: 'emprestimos',
            details: `${logNomeAluno} ← ${logNomeLivro}`, timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) {
        if (e.code === 404) return res.status(404).json({ error: e.message });
        if (e.code === 400) return res.status(400).json({ error: e.message });
        console.error('ERRO ao registrar empréstimo:', e);
        res.status(500).json({ error: 'Erro ao registrar empréstimo.', detalhe: e.message });
    }
});

// Devolver livro
app.put('/api/emprestimos/:id/devolver', requireAdmin, async (req, res) => {
    try {
        const empRef = db.collection('emprestimos').doc(req.params.id);
        let logDetalhes = '';

        await db.runTransaction(async t => {
            const empSnap = await t.get(empRef);
            if (!empSnap.exists) throw Object.assign(new Error('Empréstimo não encontrado.'), { code: 404 });

            const { livroId, alunoNome, livroNome, devolvido } = empSnap.data();
            if (devolvido) throw Object.assign(new Error('Este livro já foi devolvido.'), { code: 400 });

            logDetalhes = `${alunoNome} → ${livroNome}`;
            t.update(empRef, { devolvido: true, dataDevolucao: new Date() });
            t.update(db.collection('livros').doc(livroId), { emprestado: false });
        });

        db.collection('logs').add({
            adminEmail: req.user.email, action: 'devolveu', collection: 'emprestimos',
            details: logDetalhes, timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) {
        if (e.code === 404) return res.status(404).json({ error: e.message });
        if (e.code === 400) return res.status(400).json({ error: e.message });
        console.error('ERRO ao registrar devolução:', e);
        res.status(500).json({ error: 'Erro ao registrar devolução.' });
    }
});

// ══════════════════════════════════════════════════════════════════

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
app.get("/edit-post", requireAdmin, (req, res) => res.sendFile(path.join(views, "edit-post.html")));
app.get("/", (req, res) => res.redirect("/login"));

// API Login
app.post("/sessionLogin", async (req, res) => {
    try {
        const { idToken } = req.body;
        const decoded = await auth.verifyIdToken(idToken);
        if (!decoded.isAdmin) return res.status(403).send('Não autorizado');
        const cookie = await auth.createSessionCookie(idToken, { expiresIn: 432000000 });
        res.cookie('session', cookie, { maxAge: 432000000, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
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

    // NOVO: Editar
    app.put(`/api/${col}/:id`, requireAdmin, upload.single('imagem'), async (req, res) => {
        try {
            const data = { ...req.body, dataAtualizacao: new Date() };
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

// NOVO: Editar docente
app.put('/api/docente/:id', requireAdmin, upload.single('foto'), async (req, res) => {
    try {
        const data = {
            nome: req.body.nome,
            cargo: req.body.cargo,
            materia: req.body.materia,
            dataAtualizacao: new Date()
        };
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