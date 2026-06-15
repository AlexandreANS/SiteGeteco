const express = require("express");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const admin = require("firebase-admin");
const fs = require("fs");
const https = require("https");
const http = require("http");
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

// ══════════════════════════════════════════════════════════════════
// SISTEMA DE NÍVEIS / PERMISSÕES
// Nível 1 = Diretor, Nível 8 = TI — podem executar ações direto.
// Outros níveis geram solicitações que super-admins aprovam/negam.
// ══════════════════════════════════════════════════════════════════
const SUPER_NIVEIS = [1, 8];

function isSuperAdmin(claims) {
    return claims && SUPER_NIVEIS.includes(Number(claims.nivel));
}

// Auth Middleware — qualquer admin aprovado
async function requireAdmin(req, res, next) {
    const sessionCookie = req.cookies.session || '';
    try {
        const claims = await auth.verifySessionCookie(sessionCookie, true);
        if (claims.isAdmin) { req.user = claims; return next(); }
        res.status(403).redirect("/login");
    } catch (e) { res.status(401).redirect("/login"); }
}

// Auth Middleware — apenas super-admins (nível 1 ou 8)
async function requireSuperAdmin(req, res, next) {
    const sessionCookie = req.cookies.session || '';
    try {
        const claims = await auth.verifySessionCookie(sessionCookie, true);
        if (claims.isAdmin && isSuperAdmin(claims)) { req.user = claims; return next(); }
        res.status(403).json({ error: 'Requer nível de super-administrador (Diretor ou TI).' });
    } catch (e) { res.status(401).redirect("/login"); }
}

// --- KEEP-ALIVE
app.get('/api/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Retorna informações do usuário logado
app.get('/api/me', requireAdmin, (req, res) => {
    res.json({
        email: req.user.email,
        nivel: req.user.nivel ?? null,
        isSuperAdmin: isSuperAdmin(req.user)
    });
});

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

// ══════════════════════════════════════════════════════════════════
// HELPER: CRIAR SOLICITAÇÃO
// ══════════════════════════════════════════════════════════════════
async function criarSolicitacao({ user, collection, method, itemId = null, data, details, subAction = null }) {
    await db.collection('solicitacoes').add({
        collection, method, itemId, data: data || null, details, subAction,
        requestedBy: user.email,
        requestedByNivel: user.nivel ?? null,
        requestedAt: new Date(),
        status: 'pending'
    });
    db.collection('logs').add({
        adminEmail: user.email,
        action: `solicitou ${method === 'POST' ? 'criar' : method === 'PUT' ? 'editar' : 'excluir'}`,
        collection, details, timestamp: new Date()
    });
}

// ══════════════════════════════════════════════════════════════════
// CRUD GENÉRICO
// ══════════════════════════════════════════════════════════════════
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
            const details = data.titulo || data.nome || data.cargo || '';

            if (!isSuperAdmin(req.user)) {
                await criarSolicitacao({ user: req.user, collection: col, method: 'POST', data, details });
                return res.status(202).json({ pending: true, message: 'Solicitação de criação enviada para aprovação.' });
            }

            const ref = await db.collection(col).add(data);
            db.collection('logs').add({
                adminEmail: req.user.email, action: 'criou', collection: col,
                details, timestamp: new Date()
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
            const details = data.titulo || data.nome || data.cargo || req.params.id;

            if (!isSuperAdmin(req.user)) {
                await criarSolicitacao({ user: req.user, collection: col, method: 'PUT', itemId: req.params.id, data, details });
                return res.status(202).json({ pending: true, message: 'Solicitação de edição enviada para aprovação.' });
            }

            await db.collection(col).doc(req.params.id).update(data);
            db.collection('logs').add({
                adminEmail: req.user.email, action: 'editou', collection: col,
                details, timestamp: new Date()
            });
            res.json({ success: true });
        } catch (e) {
            console.error(`ERRO ao editar em ${col}:`, JSON.stringify(e));
            res.status(500).json({ error: 'Erro ao editar registro.', detalhe: e.message });
        }
    });

    app.delete(`/api/${col}/:id`, requireAdmin, async (req, res) => {
        try {
            if (!isSuperAdmin(req.user)) {
                await criarSolicitacao({ user: req.user, collection: col, method: 'DELETE', itemId: req.params.id, data: null, details: req.params.id });
                return res.status(202).json({ pending: true, message: 'Solicitação de exclusão enviada para aprovação.' });
            }

            await db.collection(col).doc(req.params.id).delete();
            db.collection('logs').add({
                adminEmail: req.user?.email || 'admin', action: 'excluiu', collection: col,
                details: req.params.id, timestamp: new Date()
            });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: 'Erro ao deletar.' }); }
    });
});

// ══════════════════════════════════════════════════════════════════
// CRUD DOCENTE
// ══════════════════════════════════════════════════════════════════
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
        const data = { nome: req.body.nome || '', cargo: req.body.cargo || '', materia: req.body.materia || '', foto: '', data: new Date() };
        if (req.file) data.foto = await uploadImagem(req.file);

        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({ user: req.user, collection: 'docente', method: 'POST', data, details: data.nome });
            return res.status(202).json({ pending: true, message: 'Solicitação de criação enviada para aprovação.' });
        }

        const ref = await db.collection('docente').add(data);
        db.collection('logs').add({ adminEmail: req.user.email, action: 'criou', collection: 'docente', details: data.nome, timestamp: new Date() });
        res.json({ success: true, id: ref.id });
    } catch (e) {
        console.error('ERRO ao criar docente:', JSON.stringify(e));
        res.status(500).json({ error: 'Erro ao criar docente.', detalhe: e.message });
    }
});

app.put('/api/docente/:id', requireAdmin, upload.single('foto'), async (req, res) => {
    try {
        const data = { nome: req.body.nome, cargo: req.body.cargo, materia: req.body.materia, dataAtualizacao: new Date() };
        Object.keys(data).forEach(k => { if (!data[k]) delete data[k]; });
        if (req.file) data.foto = await uploadImagem(req.file);

        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({ user: req.user, collection: 'docente', method: 'PUT', itemId: req.params.id, data, details: data.nome || req.params.id });
            return res.status(202).json({ pending: true, message: 'Solicitação de edição enviada para aprovação.' });
        }

        await db.collection('docente').doc(req.params.id).update(data);
        db.collection('logs').add({ adminEmail: req.user.email, action: 'editou', collection: 'docente', details: data.nome || req.params.id, timestamp: new Date() });
        res.json({ success: true });
    } catch (e) {
        console.error('ERRO ao editar docente:', JSON.stringify(e));
        res.status(500).json({ error: 'Erro ao editar docente.', detalhe: e.message });
    }
});

app.delete('/api/docente/:id', requireAdmin, async (req, res) => {
    try {
        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({ user: req.user, collection: 'docente', method: 'DELETE', itemId: req.params.id, data: null, details: req.params.id });
            return res.status(202).json({ pending: true, message: 'Solicitação de exclusão enviada para aprovação.' });
        }

        await db.collection('docente').doc(req.params.id).delete();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao deletar docente.' }); }
});

// ══════════════════════════════════════════════════════════════════
// DADOS ÚNICOS
// ══════════════════════════════════════════════════════════════════
['alunos', 'responsaveis'].forEach(col => {
    app.get(`/api/${col}`, async (req, res) => {
        try {
            const doc = await db.collection(col).doc('main').get();
            res.json(doc.data() || {});
        } catch (e) { res.status(500).json({ error: 'Erro ao buscar dados.' }); }
    });
    app.post(`/api/${col}`, requireAdmin, async (req, res) => {
        try {
            if (!isSuperAdmin(req.user)) {
                await criarSolicitacao({ user: req.user, collection: col, method: 'POST', data: req.body, details: `Atualização de ${col}` });
                return res.status(202).json({ pending: true, message: 'Solicitação enviada para aprovação.' });
            }
            await db.collection(col).doc('main').set(req.body, { merge: true });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: 'Erro ao salvar dados.' }); }
    });
});

// ══════════════════════════════════════════════════════════════════
// PENDENTES, LOGS E SOLICITAÇÕES
// ══════════════════════════════════════════════════════════════════
app.get('/api/pendentes', requireAdmin, async (req, res) => {
    try {
        const list = await auth.listUsers(100);
        res.json(list.users.filter(u => u.customClaims?.status === 'pending').map(u => ({ uid: u.uid, username: u.email })));
    } catch (e) { res.status(500).json({ error: 'Erro ao listar pendentes.' }); }
});

app.post('/api/pendentes/aceitar', requireSuperAdmin, async (req, res) => {
    try {
        const { uid, nivel } = req.body;
        const nivelNum = parseInt(nivel, 10);
        const NIVEIS_VALIDOS = [1, 2, 3, 4, 5, 6, 7, 8];

        if (!uid) return res.status(400).json({ error: 'UID obrigatório.' });
        if (isNaN(nivelNum) || !NIVEIS_VALIDOS.includes(nivelNum)) {
            return res.status(400).json({ error: `Nível inválido. Valores aceitos: ${NIVEIS_VALIDOS.join(', ')}.` });
        }

        await auth.setCustomUserClaims(uid, { isAdmin: true, nivel: nivelNum, status: null });
        await db.collection('registrations').doc(uid).update({
            status: 'approved', nivel: nivelNum,
            approvedAt: new Date(), approvedBy: req.user.email
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao aceitar.' }); }
});

app.post('/api/pendentes/negar', requireSuperAdmin, async (req, res) => {
    try {
        const { uid } = req.body;
        await db.collection('registrations').doc(uid).update({
            status: 'denied', deniedAt: new Date(), deniedBy: req.user.email
        }).catch(() => {});
        await auth.deleteUser(uid);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao negar.' }); }
});

/*// ═══════ ROTA DE MIGRAÇÃO – ELEVAR TODOS OS ADMINS EXISTENTES ═══════
app.post('/api/elevar-todos-admins', requireAdmin, async (req, res) => {
    try {
        const list = await auth.listUsers(1000);
        const hasSuper = list.users.some(u =>
            u.customClaims?.isAdmin && SUPER_NIVEIS.includes(Number(u.customClaims.nivel))
        );
        if (hasSuper) {
            return res.status(400).json({
                error: 'Já existem super-admins. Esta migração só pode ser executada uma vez, antes de qualquer super-admin ser criado.'
            });
        }

        const updates = [];
        list.users.forEach(u => {
            if (u.customClaims?.isAdmin) {
                const currentNivel = Number(u.customClaims.nivel);
                if (!SUPER_NIVEIS.includes(currentNivel)) {
                    const newClaims = { ...u.customClaims, nivel: 8, status: null };
                    updates.push(auth.setCustomUserClaims(u.uid, newClaims));
                }
            }
        });

        await Promise.all(updates);
        res.json({
            success: true,
            adminsAtualizados: updates.length,
            message: `${updates.length} administrador(es) promovido(s) a nível 8. Faça logout e login novamente para aplicar as permissões.`
        });
    } catch (e) {
        console.error('Erro ao elevar admins:', e);
        res.status(500).json({ error: 'Erro ao atualizar administradores.' });
    }
});*/

// logs e solicitações
app.get('/api/logs', requireAdmin, async (req, res) => {
    try {
        const snap = await db.collection('logs').orderBy('timestamp', 'desc').limit(50).get();
        res.json(snap.docs.map(d => d.data()));
    } catch (e) { res.status(500).json({ error: 'Erro ao buscar logs.' }); }
});

app.get('/api/solicitacoes', requireAdmin, async (req, res) => {
    try {
        let snap;
        if (isSuperAdmin(req.user)) {
            snap = await db.collection('solicitacoes').where('status', '==', 'pending').orderBy('requestedAt', 'desc').get();
        } else {
            snap = await db.collection('solicitacoes')
                .where('requestedBy', '==', req.user.email)
                .where('status', '==', 'pending')
                .orderBy('requestedAt', 'desc').get();
        }
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { res.status(500).json({ error: 'Erro ao listar solicitações.' }); }
});

async function executarAcao(sol) {
    const { collection, method, itemId, data, subAction } = sol;

    if (method === 'DELETE' && collection === 'livros') {
        if (data?.deleteHistory) {
            const hist = await db.collection('emprestimos').where('livroId', '==', itemId).get();
            if (!hist.empty) {
                const batch = db.batch();
                hist.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
            }
        }
        await db.collection(collection).doc(itemId).delete();
        return;
    }

    if (method === 'DELETE') {
        await db.collection(collection).doc(itemId).delete();
        return;
    }

    if (method === 'POST') {
        if (collection === 'alunos' || collection === 'responsaveis') {
            await db.collection(collection).doc('main').set(data, { merge: true });
        } else {
            await db.collection(collection).add({ ...data });
        }
        return;
    }

    if (method === 'PUT') {
        await db.collection(collection).doc(itemId).update({ ...data, aprovadoEm: new Date() });
        return;
    }
}

app.post('/api/solicitacoes/:id/aprovar', requireSuperAdmin, async (req, res) => {
    try {
        const solRef = db.collection('solicitacoes').doc(req.params.id);
        const solSnap = await solRef.get();
        if (!solSnap.exists) return res.status(404).json({ error: 'Solicitação não encontrada.' });
        const sol = solSnap.data();
        if (sol.status !== 'pending') return res.status(400).json({ error: 'Solicitação já resolvida.' });

        await executarAcao(sol);

        await solRef.update({ status: 'approved', resolvedBy: req.user.email, resolvedAt: new Date() });
        db.collection('logs').add({
            adminEmail: req.user.email, action: 'aprovou solicitação',
            collection: sol.collection, details: sol.details, timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) {
        console.error('ERRO ao aprovar solicitação:', e);
        res.status(500).json({ error: `Erro ao executar ação: ${e.message}` });
    }
});

app.post('/api/solicitacoes/:id/negar', requireSuperAdmin, async (req, res) => {
    try {
        const solRef = db.collection('solicitacoes').doc(req.params.id);
        const solSnap = await solRef.get();
        if (!solSnap.exists) return res.status(404).json({ error: 'Solicitação não encontrada.' });
        if (solSnap.data().status !== 'pending') return res.status(400).json({ error: 'Solicitação já resolvida.' });

        await solRef.update({ status: 'denied', resolvedBy: req.user.email, resolvedAt: new Date() });
        db.collection('logs').add({
            adminEmail: req.user.email, action: 'negou solicitação',
            collection: solSnap.data().collection, details: solSnap.data().details, timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao negar solicitação.' }); }
});

// ══════════════════════════════════════════════════════════════════
// BIBLIOTECA — ALUNOS (com nível)
// ══════════════════════════════════════════════════════════════════
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

app.post('/api/alunosBib', requireAdmin, async (req, res) => {
    try {
        const { matricula, nome } = req.body;
        if (!matricula || !nome) return res.status(400).json({ error: 'Matrícula e nome são obrigatórios.' });
        const existente = await db.collection('alunosBib').where('matricula', '==', matricula).limit(1).get();
        if (!existente.empty) return res.status(400).json({ error: 'Já existe um aluno com essa matrícula.' });

        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({ user: req.user, collection: 'alunosBib', method: 'POST', data: { matricula, nome }, details: `${nome} (${matricula})` });
            return res.status(202).json({ pending: true, message: 'Solicitação de criação enviada para aprovação.' });
        }

        const ref = await db.collection('alunosBib').add({ matricula, nome, criadoEm: new Date() });
        db.collection('logs').add({ adminEmail: req.user.email, action: 'criou', collection: 'alunosBib', details: `${nome} (${matricula})`, timestamp: new Date() });
        res.json({ success: true, id: ref.id });
    } catch (e) { res.status(500).json({ error: 'Erro ao cadastrar aluno.' }); }
});

app.put('/api/alunosBib/:id', requireAdmin, async (req, res) => {
    try {
        const { matricula, nome } = req.body;
        if (!matricula || !nome) return res.status(400).json({ error: 'Matrícula e nome são obrigatórios.' });
        const existente = await db.collection('alunosBib').where('matricula', '==', matricula).limit(1).get();
        if (!existente.empty && existente.docs[0].id !== req.params.id) {
            return res.status(400).json({ error: 'Já existe outro aluno com essa matrícula.' });
        }

        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({
                user: req.user, collection: 'alunosBib', method: 'PUT', itemId: req.params.id,
                data: { matricula, nome }, details: `${nome} (${matricula})`
            });
            return res.status(202).json({ pending: true, message: 'Solicitação de edição enviada para aprovação.' });
        }

        await db.collection('alunosBib').doc(req.params.id).update({ matricula, nome, atualizadoEm: new Date() });
        db.collection('logs').add({ adminEmail: req.user.email, action: 'editou', collection: 'alunosBib', details: `${nome} (${matricula})`, timestamp: new Date() });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao editar aluno.' }); }
});

app.delete('/api/alunosBib/:id', requireAdmin, async (req, res) => {
    try {
        const empAtivos = await db.collection('emprestimos').where('alunoId', '==', req.params.id).where('devolvido', '==', false).get();
        if (!empAtivos.empty) return res.status(400).json({ error: 'Não é possível excluir um aluno com empréstimos em andamento.' });

        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({ user: req.user, collection: 'alunosBib', method: 'DELETE', itemId: req.params.id, data: null, details: req.params.id });
            return res.status(202).json({ pending: true, message: 'Solicitação de exclusão enviada para aprovação.' });
        }

        await db.collection('alunosBib').doc(req.params.id).delete();
        db.collection('logs').add({ adminEmail: req.user?.email || 'admin', action: 'excluiu', collection: 'alunosBib', details: req.params.id, timestamp: new Date() });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao excluir aluno.' }); }
});

// ══════════════════════════════════════════════════════════════════
// BIBLIOTECA — LIVROS
// ══════════════════════════════════════════════════════════════════
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
        const { codigo, nome, autor, quantidade } = req.body;
        if (!codigo || !nome || !autor) return res.status(400).json({ error: 'Código, título e autor são obrigatórios.' });
        const qtd = parseInt(quantidade, 10) || 1;
        if (qtd < 1) return res.status(400).json({ error: 'Quantidade deve ser pelo menos 1.' });

        const existente = await db.collection('livros').where('codigo', '==', codigo).limit(1).get();
        if (!existente.empty) return res.status(400).json({ error: 'Já existe um livro com esse código.' });

        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({
                user: req.user, collection: 'livros', method: 'POST',
                data: { codigo, nome, autor, quantidade: qtd },
                details: `${nome} — ${autor} (${qtd}x)`
            });
            return res.status(202).json({ pending: true, message: 'Solicitação de criação enviada para aprovação.' });
        }

        const ref = await db.collection('livros').add({
            codigo, nome, autor,
            quantidade: qtd,
            quantidadeDisponivel: qtd,
            emprestado: false,
            criadoEm: new Date()
        });
        db.collection('logs').add({ adminEmail: req.user.email, action: 'criou', collection: 'livros', details: `${nome} — ${autor} (${qtd}x)`, timestamp: new Date() });
        res.json({ success: true, id: ref.id });
    } catch (e) { res.status(500).json({ error: 'Erro ao cadastrar livro.' }); }
});

app.put('/api/livros/:id', requireAdmin, async (req, res) => {
    try {
        const { codigo, nome, autor, quantidade } = req.body;
        if (!codigo || !nome || !autor) return res.status(400).json({ error: 'Código, título e autor são obrigatórios.' });

        const existente = await db.collection('livros').where('codigo', '==', codigo).limit(1).get();
        if (!existente.empty && existente.docs[0].id !== req.params.id) {
            return res.status(400).json({ error: 'Já existe outro livro com esse código.' });
        }

        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({
                user: req.user, collection: 'livros', method: 'PUT', itemId: req.params.id,
                data: { codigo, nome, autor, quantidade: parseInt(quantidade,10) || undefined },
                details: `${nome} — ${autor}`
            });
            return res.status(202).json({ pending: true, message: 'Solicitação de edição enviada para aprovação.' });
        }

        const docAtual = await db.collection('livros').doc(req.params.id).get();
        const atual = docAtual.data() || {};
        const novaQtd = parseInt(quantidade, 10) || atual.quantidade || 1;
        const emprestados = (atual.quantidade || 1) - (atual.quantidadeDisponivel ?? (atual.emprestado ? 0 : 1));
        const novaDisp = Math.max(0, novaQtd - emprestados);

        await db.collection('livros').doc(req.params.id).update({
            codigo, nome, autor,
            quantidade: novaQtd,
            quantidadeDisponivel: novaDisp,
            emprestado: novaDisp <= 0,
            atualizadoEm: new Date()
        });
        db.collection('logs').add({ adminEmail: req.user.email, action: 'editou', collection: 'livros', details: `${nome} — ${autor}`, timestamp: new Date() });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao editar livro.' }); }
});

app.delete('/api/livros/:id', requireAdmin, async (req, res) => {
    try {
        const doc = await db.collection('livros').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Livro não encontrado.' });
        const livro = doc.data();

        const disponiveis = livro.quantidadeDisponivel ?? (livro.emprestado ? 0 : 1);
        const quantidade = livro.quantidade || 1;
        if (disponiveis < quantidade) {
            return res.status(400).json({ error: `Não é possível excluir: ${quantidade - disponiveis} cópia(s) deste livro estão emprestadas no momento.` });
        }

        const historico = await db.collection('emprestimos').where('livroId', '==', req.params.id).limit(1).get();
        const temHistorico = !historico.empty;
        const deleteHistory = req.query.deleteHistory === 'true';

        if (temHistorico && !deleteHistory) {
            return res.status(409).json({
                error: 'Este livro possui histórico de empréstimos.',
                temHistorico: true,
                message: 'Confirme se deseja excluir o histórico também.'
            });
        }

        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({
                user: req.user, collection: 'livros', method: 'DELETE',
                itemId: req.params.id,
                data: { deleteHistory },
                details: `${livro.nome} — ${livro.autor}${deleteHistory ? ' (com histórico)' : ''}`
            });
            return res.status(202).json({ pending: true, message: 'Solicitação de exclusão enviada para aprovação.' });
        }

        if (deleteHistory && temHistorico) {
            const hist = await db.collection('emprestimos').where('livroId', '==', req.params.id).get();
            const batch = db.batch();
            hist.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
        }

        await db.collection('livros').doc(req.params.id).delete();
        db.collection('logs').add({
            adminEmail: req.user?.email || 'admin', action: 'excluiu', collection: 'livros',
            details: `${livro.nome}${deleteHistory ? ' (histórico incluído)' : ''}`, timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao excluir livro.' }); }
});

// ══════════════════════════════════════════════════════════════════
// BIBLIOTECA — EMPRÉSTIMOS
// ══════════════════════════════════════════════════════════════════
app.get('/api/emprestimos', requireAdmin, async (req, res) => {
    try {
        const snap = req.query.ativos === 'true'
            ? await db.collection('emprestimos').where('devolvido', '==', false).get()
            : await db.collection('emprestimos').get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { res.status(500).json({ error: 'Erro ao listar empréstimos.' }); }
});

app.get('/api/emprestimos/aluno/:id', requireAdmin, async (req, res) => {
    try {
        const snap = await db.collection('emprestimos').where('alunoId', '==', req.params.id).get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { res.status(500).json({ error: 'Erro ao buscar empréstimos do aluno.' }); }
});

app.get('/api/emprestimos/livro/:id', requireAdmin, async (req, res) => {
    try {
        const snap = await db.collection('emprestimos').where('livroId', '==', req.params.id).get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { res.status(500).json({ error: 'Erro ao buscar empréstimos do livro.' }); }
});

app.post('/api/emprestimos', requireAdmin, async (req, res) => {
    try {
        const { alunoId, livroId } = req.body;
        if (!alunoId || !livroId) return res.status(400).json({ error: 'Aluno e livro são obrigatórios.' });

        const alunoRef = db.collection('alunosBib').doc(alunoId);
        const livroRef = db.collection('livros').doc(livroId);
        let logNomeAluno = '', logNomeLivro = '';

        await db.runTransaction(async t => {
            const [alunoSnap, livroSnap] = await Promise.all([t.get(alunoRef), t.get(livroRef)]);

            if (!alunoSnap.exists) throw Object.assign(new Error('Aluno não encontrado.'), { code: 404 });
            if (!livroSnap.exists) throw Object.assign(new Error('Livro não encontrado.'), { code: 404 });

            const livro = livroSnap.data();
            const disponiveis = livro.quantidadeDisponivel ?? (livro.emprestado ? 0 : 1);
            if (disponiveis <= 0) throw Object.assign(new Error('Não há cópias disponíveis para empréstimo.'), { code: 400 });

            const aluno = alunoSnap.data();
            logNomeAluno = aluno.nome;
            logNomeLivro = livro.nome;

            const empRef = db.collection('emprestimos').doc();
            t.set(empRef, {
                alunoId, livroId,
                alunoNome: aluno.nome, alunoMatricula: aluno.matricula,
                livroNome: livro.nome, livroCodigo: livro.codigo,
                dataEmprestimo: new Date(), devolvido: false
            });
            const novaDisp = disponiveis - 1;
            t.update(livroRef, {
                quantidadeDisponivel: novaDisp,
                emprestado: novaDisp <= 0
            });
        });

        db.collection('logs').add({ adminEmail: req.user.email, action: 'emprestou', collection: 'emprestimos', details: `${logNomeAluno} ← ${logNomeLivro}`, timestamp: new Date() });
        res.json({ success: true });
    } catch (e) {
        if (e.code === 404) return res.status(404).json({ error: e.message });
        if (e.code === 400) return res.status(400).json({ error: e.message });
        console.error('ERRO ao registrar empréstimo:', e);
        res.status(500).json({ error: 'Erro ao registrar empréstimo.', detalhe: e.message });
    }
});

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
            const livroRef = db.collection('livros').doc(livroId);
            const livroSnap = await t.get(livroRef);
            const livro = livroSnap.data() || {};
            const novaDisp = (livro.quantidadeDisponivel ?? 0) + 1;

            t.update(empRef, { devolvido: true, dataDevolucao: new Date() });
            t.update(livroRef, {
                quantidadeDisponivel: novaDisp,
                emprestado: false
            });
        });

        db.collection('logs').add({ adminEmail: req.user.email, action: 'devolveu', collection: 'emprestimos', details: logDetalhes, timestamp: new Date() });
        res.json({ success: true });
    } catch (e) {
        if (e.code === 404) return res.status(404).json({ error: e.message });
        if (e.code === 400) return res.status(400).json({ error: e.message });
        console.error('ERRO ao registrar devolução:', e);
        res.status(500).json({ error: 'Erro ao registrar devolução.' });
    }
});

// ══════════════════════════════════════════════════════════════════
// ROTA DE MIGRAÇÃO – LIVROS ANTIGOS
// ══════════════════════════════════════════════════════════════════
/*app.post('/api/migrar-livros-quantidade', requireSuperAdmin, async (req, res) => {
    try {
        const livrosSnap = await db.collection('livros').get();
        let atualizados = 0;
        const batch = db.batch();

        livrosSnap.forEach(doc => {
            const data = doc.data();
            if (data.quantidade === undefined) {
                const emprestado = data.emprestado === true;
                batch.update(doc.ref, {
                    quantidade: 1,
                    quantidadeDisponivel: emprestado ? 0 : 1
                });
                atualizados++;
            }
        });

        if (atualizados > 0) await batch.commit();
        res.json({ success: true, livrosAtualizados: atualizados });
    } catch (e) {
        console.error('Erro na migração de livros:', e);
        res.status(500).json({ error: 'Erro ao migrar livros.' });
    }
});*/

// ══════════════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
    console.log(`Admin Server rodando em http://localhost:${PORT}`);

    db.collection('logs').limit(1).get()
        .then(() => console.log('✅ Conexão Firestore aquecida.'))
        .catch(err => console.error('⚠️ Warm-up Firestore falhou:', err.message));

    const PING_INTERVAL = 10 * 60 * 1000;
    setInterval(() => {
        const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        const url = `${baseUrl}/api/ping`;
        const lib = url.startsWith('https') ? https : http;
        lib.get(url, (res) => {
            res.resume();
            console.log(`🏓 Keep-alive ping → ${res.statusCode}`);
        }).on('error', (err) => {
            console.warn('⚠️ Keep-alive ping falhou:', err.message);
        });
    }, PING_INTERVAL);
});