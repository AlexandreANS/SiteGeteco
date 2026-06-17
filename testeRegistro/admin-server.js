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
const dns = require("dns").promises;

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
    api_key: process.env.CLOUDINARY_API_KEY,
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
                if (error) {
                    console.error('CLOUDINARY ERRO:', JSON.stringify(error));
                    reject(error);
                } else {
                    console.log('CLOUDINARY SUCESSO:', result.secure_url);
                    resolve(result.secure_url);
                }
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
    origin: [
        'http://localhost:5000',
        'http://localhost:3000',
        'https://sitegeteco.onrender.com',
        'https://escola-geteco.onrender.com'
    ],
    credentials: true
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// ══════════════════════════════════════════════════════════════════
// SISTEMA DE NÍVEIS / PERMISSÕES
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
        if (claims.isAdmin) {
            req.user = claims;
            return next();
        }
        res.status(403).redirect("/login");
    } catch (e) {
        res.status(401).redirect("/login");
    }
}

// --- KEEP-ALIVE ---
app.get('/api/ping', async (req, res) => {
    try {
        await db.collection('logs').limit(1).get();
        res.json({ ok: true, ts: Date.now() });
    } catch (e) {
        res.status(500).json({ ok: false });
    }
});

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

// ══════════════════════════════════════════════════════════════════
// API Login — exige verificação de e‑mail apenas para contas pendentes
// ══════════════════════════════════════════════════════════════════
app.post("/sessionLogin", async (req, res) => {
    try {
        const { idToken } = req.body;
        const decoded = await auth.verifyIdToken(idToken);
        if (!decoded.isAdmin) return res.status(403).send('Não autorizado');

        const userRecord = await auth.getUser(decoded.uid);
        const isAdminApproved = decoded.isAdmin === true && decoded.status !== 'pending';
        if (!userRecord.emailVerified && !isAdminApproved) {
            return res.status(403).send('Por favor, verifique seu e-mail antes de fazer login.');
        }

        const cookie = await auth.createSessionCookie(idToken, { expiresIn: 432000000 });
        res.cookie('session', cookie, {
            maxAge: 432000000,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });
        res.json({ status: 'success' });
    } catch (e) {
        res.status(401).send('Erro');
    }
});

app.post("/checkAdmin", async (req, res) => {
    try {
        const decoded = await auth.verifyIdToken(req.body.idToken);
        res.json({ isAdmin: decoded.isAdmin === true });
    } catch (e) {
        res.status(401).json({ error: 'Token inválido' });
    }
});

// ══════════════════════════════════════════════════════════════════
// VALIDAÇÃO DE DOMÍNIO
// ══════════════════════════════════════════════════════════════════
async function isEmailDomainValid(email) {
    try {
        const domain = email.split('@')[1];
        if (!domain) return false;
        const addresses = await dns.resolveMx(domain);
        return addresses && addresses.length > 0;
    } catch (err) {
        return false;
    }
}

// ══════════════════════════════════════════════════════════════════
// Registro
// ══════════════════════════════════════════════════════════════════
app.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'E‑mail e senha são obrigatórios.' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Formato de e‑mail inválido.' });
        }

        const domainValid = await isEmailDomainValid(email);
        if (!domainValid) {
            return res.status(400).json({ error: 'Domínio de e‑mail inválido ou não consegue receber mensagens.' });
        }

        let userRecord;
        try {
            userRecord = await auth.createUser({
                email,
                password,
                emailVerified: false
            });
        } catch (e) {
            if (e.code === 'auth/email-already-exists') {
                return res.status(409).json({ error: 'Este e‑mail já está registado.' });
            }
            throw e;
        }

        await auth.setCustomUserClaims(userRecord.uid, { status: 'pending' });

        await db.collection('registrations').doc(userRecord.uid).set({
            email,
            uid: userRecord.uid,
            status: 'pending',
            requestedAt: new Date()
        });

        const verificationLink = await auth.generateEmailVerificationLink(email);
        console.log('Link de verificação:', verificationLink);

        res.json({ success: true, message: 'Conta criada com sucesso. Verifique seu e‑mail para confirmar.' });
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
// HELPER: REGISTRAR LOG COM SNAPSHOT PARA ROLLBACK
// ══════════════════════════════════════════════════════════════════
async function registrarLog(adminEmail, action, collection, docId, previousData, newData, details) {
    const logData = {
        adminEmail,
        action,
        collection,
        docId,
        timestamp: new Date(),
        details: details || '',
        rollbackPossible: false
    };
    if (previousData) {
        logData.previousData = previousData;
        logData.rollbackPossible = true;
    }
    if (newData) logData.newData = newData;
    const ref = await db.collection('logs').add(logData);
    return ref.id;
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
        } catch (e) {
            res.status(500).json({ error: 'Erro ao listar.' });
        }
    });

    app.get(`/api/${col}/:id`, async (req, res) => {
        try {
            const doc = await db.collection(col).doc(req.params.id).get();
            if (!doc.exists) return res.status(404).json({ error: 'Item não encontrado' });
            res.json({ id: doc.id, ...doc.data() });
        } catch (e) {
            res.status(500).json({ error: 'Erro ao buscar item.' });
        }
    });

    app.post(`/api/${col}`, requireAdmin, upload.single('imagem'), async (req, res) => {
        try {
            const data = { ...req.body, data: new Date() };
            if (req.file) data.imagem = await uploadImagem(req.file);
            const details = data.titulo || data.nome || data.cargo || '';

            const ref = await db.collection(col).add(data);
            await registrarLog(req.user.email, 'criou', col, ref.id, null, data, details);
            res.json({ success: true, id: ref.id });
        } catch (e) {
            console.error(`ERRO ao criar em ${col}:`, JSON.stringify(e));
            res.status(500).json({ error: 'Erro ao criar registro.', detalhe: e.message });
        }
    });

    app.put(`/api/${col}/:id`, requireAdmin, upload.single('imagem'), async (req, res) => {
        try {
            const docRef = db.collection(col).doc(req.params.id);
            const oldDoc = await docRef.get();
            const previousData = oldDoc.exists ? oldDoc.data() : null;

            const data = { ...req.body, dataAtualizacao: new Date() };
            Object.keys(data).forEach(k => { if (data[k] === '') delete data[k]; });
            if (req.file) data.imagem = await uploadImagem(req.file);
            const details = data.titulo || data.nome || data.cargo || req.params.id;

            await docRef.update(data);
            await registrarLog(req.user.email, 'editou', col, req.params.id, previousData, data, details);
            res.json({ success: true });
        } catch (e) {
            console.error(`ERRO ao editar em ${col}:`, JSON.stringify(e));
            res.status(500).json({ error: 'Erro ao editar registro.', detalhe: e.message });
        }
    });

    app.delete(`/api/${col}/:id`, requireAdmin, async (req, res) => {
        try {
            const docRef = db.collection(col).doc(req.params.id);
            const oldDoc = await docRef.get();
            const previousData = oldDoc.exists ? oldDoc.data() : null;

            await docRef.delete();
            await registrarLog(req.user.email, 'excluiu', col, req.params.id, previousData, null, req.params.id);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: 'Erro ao deletar.' });
        }
    });
});

// ══════════════════════════════════════════════════════════════════
// CRUD DOCENTE
// ══════════════════════════════════════════════════════════════════
app.get('/api/docente', async (req, res) => {
    try {
        const snap = await db.collection('docente').get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
        res.status(500).json({ error: 'Erro ao listar docentes.' });
    }
});

app.get('/api/docente/:id', async (req, res) => {
    try {
        const doc = await db.collection('docente').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Docente não encontrado' });
        res.json({ id: doc.id, ...doc.data() });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao buscar docente.' });
    }
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
        await registrarLog(req.user.email, 'criou', 'docente', ref.id, null, data, data.nome);
        res.json({ success: true, id: ref.id });
    } catch (e) {
        console.error('ERRO ao criar docente:', JSON.stringify(e));
        res.status(500).json({ error: 'Erro ao criar docente.', detalhe: e.message });
    }
});

app.put('/api/docente/:id', requireAdmin, upload.single('foto'), async (req, res) => {
    try {
        const docRef = db.collection('docente').doc(req.params.id);
        const oldDoc = await docRef.get();
        const previousData = oldDoc.exists ? oldDoc.data() : null;

        const data = {
            nome: req.body.nome,
            cargo: req.body.cargo,
            materia: req.body.materia,
            dataAtualizacao: new Date()
        };
        Object.keys(data).forEach(k => { if (!data[k]) delete data[k]; });
        if (req.file) data.foto = await uploadImagem(req.file);

        await docRef.update(data);
        await registrarLog(req.user.email, 'editou', 'docente', req.params.id, previousData, data, data.nome || req.params.id);
        res.json({ success: true });
    } catch (e) {
        console.error('ERRO ao editar docente:', JSON.stringify(e));
        res.status(500).json({ error: 'Erro ao editar docente.', detalhe: e.message });
    }
});

app.delete('/api/docente/:id', requireAdmin, async (req, res) => {
    try {
        const docRef = db.collection('docente').doc(req.params.id);
        const oldDoc = await docRef.get();
        const previousData = oldDoc.exists ? oldDoc.data() : null;

        await docRef.delete();
        await registrarLog(req.user.email, 'excluiu', 'docente', req.params.id, previousData, null, req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao deletar docente.' });
    }
});

// ══════════════════════════════════════════════════════════════════
// DADOS ÚNICOS
// ══════════════════════════════════════════════════════════════════
['alunos', 'responsaveis'].forEach(col => {
    app.get(`/api/${col}`, async (req, res) => {
        try {
            const doc = await db.collection(col).doc('main').get();
            res.json(doc.data() || {});
        } catch (e) {
            res.status(500).json({ error: 'Erro ao buscar dados.' });
        }
    });

    app.post(`/api/${col}`, requireAdmin, async (req, res) => {
        try {
            const docRef = db.collection(col).doc('main');
            const oldDoc = await docRef.get();
            const previousData = oldDoc.exists ? oldDoc.data() : null;

            await docRef.set(req.body, { merge: true });
            await registrarLog(req.user.email, 'atualizou', col, 'main', previousData, req.body, `Atualização de ${col}`);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: 'Erro ao salvar dados.' });
        }
    });
});

// ══════════════════════════════════════════════════════════════════
// PENDENTES (listagem e aceitar/negar)
// ══════════════════════════════════════════════════════════════════
app.get('/api/pendentes', requireAdmin, async (req, res) => {
    try {
        const list = await auth.listUsers(100);
        res.json(list.users
            .filter(u => u.customClaims?.status === 'pending')
            .map(u => ({ uid: u.uid, username: u.email }))
        );
    } catch (e) {
        res.status(500).json({ error: 'Erro ao listar pendentes.' });
    }
});

app.post('/api/pendentes/aceitar', requireAdmin, async (req, res) => {
    try {
        if (!isSuperAdmin(req.user)) {
            return res.status(403).json({ error: 'Apenas superadministradores podem aprovar novos admins.' });
        }
        const { uid, nivel } = req.body;
        const nivelNum = parseInt(nivel, 10);
        const NIVEIS_VALIDOS = [1, 2, 3, 4, 5, 6, 7, 8];

        if (!uid) return res.status(400).json({ error: 'UID obrigatório.' });
        if (isNaN(nivelNum) || !NIVEIS_VALIDOS.includes(nivelNum)) {
            return res.status(400).json({ error: `Nível inválido. Valores aceitos: ${NIVEIS_VALIDOS.join(', ')}.` });
        }

        await auth.setCustomUserClaims(uid, { isAdmin: true, nivel: nivelNum, status: null });
        await db.collection('registrations').doc(uid).update({
            status: 'approved',
            nivel: nivelNum,
            approvedAt: new Date(),
            approvedBy: req.user.email
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao aceitar.' });
    }
});

app.post('/api/pendentes/negar', requireAdmin, async (req, res) => {
    try {
        if (!isSuperAdmin(req.user)) {
            return res.status(403).json({ error: 'Apenas superadministradores podem negar admins.' });
        }
        const { uid } = req.body;
        await db.collection('registrations').doc(uid).update({
            status: 'denied',
            deniedAt: new Date(),
            deniedBy: req.user.email
        }).catch(() => {});
        await auth.deleteUser(uid);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao negar.' });
    }
});

// ══════════════════════════════════════════════════════════════════
// LOGS E ROLLBACK (com novas ações em massa e individuais)
// ══════════════════════════════════════════════════════════════════
app.get('/api/logs', requireAdmin, async (req, res) => {
    try {
        const snap = await db.collection('logs')
            .orderBy('timestamp', 'desc')
            .limit(100)
            .get();
        const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: 'Erro ao buscar logs.' });
    }
});

// Rollback individual
app.post('/api/logs/:id/rollback', requireAdmin, async (req, res) => {
    try {
        if (!isSuperAdmin(req.user)) {
            return res.status(403).json({ error: 'Apenas superadministradores podem reverter ações.' });
        }

        const logRef = db.collection('logs').doc(req.params.id);
        const logSnap = await logRef.get();
        if (!logSnap.exists) return res.status(404).json({ error: 'Log não encontrado.' });
        const log = logSnap.data();
        if (!log.rollbackPossible) {
            return res.status(400).json({ error: 'Este log não pode ser revertido.' });
        }

        const { collection, docId, previousData, action } = log;
        if (!previousData && action !== 'criou') {
            return res.status(400).json({ error: 'Dados anteriores não disponíveis para rollback.' });
        }

        if (action === 'excluiu' || action === 'editou') {
            await db.collection(collection).doc(docId).set(previousData);
        } else if (action === 'criou') {
            await db.collection(collection).doc(docId).delete();
        } else {
            return res.status(400).json({ error: 'Ação não suportada para rollback.' });
        }

        await logRef.update({ revertedAt: new Date(), revertedBy: req.user.email });
        await registrarLog(req.user.email, 'reverteu', collection, docId, null, null, `Rollback do log ${req.params.id}`);

        res.json({ success: true });
    } catch (e) {
        console.error('Erro no rollback:', e);
        res.status(500).json({ error: 'Erro ao executar rollback.' });
    }
});

// Confirmar log individual (torna não reversível)
app.post('/api/logs/:id/confirm', requireAdmin, async (req, res) => {
    try {
        if (!isSuperAdmin(req.user)) {
            return res.status(403).json({ error: 'Apenas superadministradores podem confirmar logs.' });
        }
        const docRef = db.collection('logs').doc(req.params.id);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
            return res.status(404).json({ error: 'Log não encontrado.' });
        }
        const log = docSnap.data();
        if (!log.rollbackPossible) {
            return res.status(400).json({ error: 'Este log já está confirmado.' });
        }
        await docRef.update({
            previousData: admin.firestore.FieldValue.delete(),
            newData: admin.firestore.FieldValue.delete(),
            rollbackPossible: false
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao confirmar log.' });
    }
});

// Apagar log individual (apenas se não reversível)
app.delete('/api/logs/clear', requireAdmin, async (req, res) => {
    // Rota fixa: limpar histórico (precisa vir antes de :id)
    try {
        if (!isSuperAdmin(req.user)) {
            return res.status(403).json({ error: 'Apenas superadministradores podem limpar o histórico.' });
        }
        const snap = await db.collection('logs')
            .where('rollbackPossible', '!=', true)
            .get();
        const batch = db.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        res.json({ success: true, deleted: snap.size });
    } catch (e) {
        console.error('Erro ao limpar histórico:', e);
        res.status(500).json({ error: 'Erro ao limpar histórico.' });
    }
});

app.delete('/api/logs/:id', requireAdmin, async (req, res) => {
    try {
        if (!isSuperAdmin(req.user)) {
            return res.status(403).json({ error: 'Apenas superadministradores podem apagar logs.' });
        }
        const docRef = db.collection('logs').doc(req.params.id);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
            return res.status(404).json({ error: 'Log não encontrado.' });
        }
        const log = docSnap.data();
        if (log.rollbackPossible === true) {
            return res.status(400).json({ error: 'Este log ainda é reversível. Confirme-o antes de apagar.' });
        }
        await docRef.delete();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao apagar log.' });
    }
});

// Confirmar todos os logs reversíveis (em massa)
app.post('/api/logs/confirm-all', requireAdmin, async (req, res) => {
    try {
        if (!isSuperAdmin(req.user)) {
            return res.status(403).json({ error: 'Apenas superadministradores podem confirmar logs em massa.' });
        }
        const snap = await db.collection('logs')
            .where('rollbackPossible', '==', true)
            .get();
        const batch = db.batch();
        snap.docs.forEach(doc => {
            batch.update(doc.ref, {
                previousData: admin.firestore.FieldValue.delete(),
                newData: admin.firestore.FieldValue.delete(),
                rollbackPossible: false
            });
        });
        await batch.commit();
        res.json({ success: true, confirmed: snap.size });
    } catch (e) {
        console.error('Erro ao confirmar todos os logs:', e);
        res.status(500).json({ error: 'Erro ao confirmar logs em massa.' });
    }
});

// Reverter todos os logs reversíveis (em massa)
app.post('/api/logs/rollback-all', requireAdmin, async (req, res) => {
    try {
        if (!isSuperAdmin(req.user)) {
            return res.status(403).json({ error: 'Apenas superadministradores podem reverter ações em massa.' });
        }
        const snap = await db.collection('logs')
            .where('rollbackPossible', '==', true)
            .orderBy('timestamp', 'desc')
            .get();
        if (snap.empty) {
            return res.json({ success: true, reverted: 0 });
        }

        const logs = [];
        snap.forEach(doc => logs.push({ id: doc.id, ...doc.data() }));

        let revertidos = 0;
        for (const log of logs) {
            try {
                const { collection, docId, previousData, action } = log;
                if (action === 'excluiu' || action === 'editou') {
                    await db.collection(collection).doc(docId).set(previousData);
                } else if (action === 'criou') {
                    await db.collection(collection).doc(docId).delete();
                } else {
                    continue;
                }
                await db.collection('logs').doc(log.id).update({
                    revertedAt: new Date(),
                    revertedBy: req.user.email,
                    rollbackPossible: false
                });
                await registrarLog(req.user.email, 'reverteu', collection, docId, null, null, `Rollback em massa do log ${log.id}`);
                revertidos++;
            } catch (innerError) {
                console.error(`Falha ao reverter log ${log.id}:`, innerError);
            }
        }
        res.json({ success: true, reverted: revertidos });
    } catch (e) {
        console.error('Erro no rollback em massa:', e);
        res.status(500).json({ error: 'Erro ao executar rollback em massa.' });
    }
});

// ══════════════════════════════════════════════════════════════════
// BIBLIOTECA — ALUNOS/PROFESSORES
// ══════════════════════════════════════════════════════════════════
app.get('/api/alunosBib', requireAdmin, async (req, res) => {
    try {
        const snap = await db.collection('alunosBib').get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
        res.status(500).json({ error: 'Erro ao listar cadastros.' });
    }
});

app.get('/api/alunosBib/:id', requireAdmin, async (req, res) => {
    try {
        const doc = await db.collection('alunosBib').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Cadastro não encontrado.' });
        res.json({ id: doc.id, ...doc.data() });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao buscar cadastro.' });
    }
});

async function gerarMatricula(tipo) {
    const prefixo = tipo === 'professor' ? 'SGBGP' : 'SGBG';
    const query = await db.collection('alunosBib')
        .where('tipo', '==', tipo)
        .get();
    const count = query.size;
    const numero = String(count + 1).padStart(4, '0');
    return prefixo + numero;
}

app.post('/api/alunosBib', requireAdmin, async (req, res) => {
    try {
        const { tipo, nome } = req.body;
        if (!tipo || !nome) return res.status(400).json({ error: 'Tipo e nome são obrigatórios.' });
        if (tipo !== 'aluno' && tipo !== 'professor') {
            return res.status(400).json({ error: 'Tipo inválido. Use "aluno" ou "professor".' });
        }

        const matricula = await gerarMatricula(tipo);
        const ref = await db.collection('alunosBib').add({
            matricula,
            nome,
            tipo,
            criadoEm: new Date()
        });
        await registrarLog(req.user.email, 'criou', 'alunosBib', ref.id, null, { matricula, nome, tipo }, `${nome} (${matricula})`);
        res.json({ success: true, id: ref.id, matricula });
    } catch (e) {
        console.error('Erro ao cadastrar:', e);
        res.status(500).json({ error: 'Erro ao cadastrar.', detalhe: e.message });
    }
});

app.put('/api/alunosBib/:id', requireAdmin, async (req, res) => {
    try {
        const { matricula, nome, tipo } = req.body;
        if (!matricula || !nome || !tipo) {
            return res.status(400).json({ error: 'Matrícula, nome e tipo são obrigatórios.' });
        }

        const docRef = db.collection('alunosBib').doc(req.params.id);
        const oldDoc = await docRef.get();
        const previousData = oldDoc.exists ? oldDoc.data() : null;

        await docRef.update({ matricula, nome, tipo, atualizadoEm: new Date() });
        await registrarLog(req.user.email, 'editou', 'alunosBib', req.params.id, previousData, { matricula, nome, tipo }, `${nome} (${matricula})`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao editar cadastro.' });
    }
});

app.delete('/api/alunosBib/:id', requireAdmin, async (req, res) => {
    try {
        const empAtivos = await db.collection('emprestimos')
            .where('alunoId', '==', req.params.id)
            .where('devolvido', '==', false)
            .get();
        if (!empAtivos.empty) {
            return res.status(400).json({ error: 'Não é possível excluir um cadastro com empréstimos em andamento.' });
        }

        const docRef = db.collection('alunosBib').doc(req.params.id);
        const oldDoc = await docRef.get();
        const previousData = oldDoc.exists ? oldDoc.data() : null;

        await docRef.delete();
        await registrarLog(req.user.email, 'excluiu', 'alunosBib', req.params.id, previousData, null, req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao excluir cadastro.' });
    }
});

// ══════════════════════════════════════════════════════════════════
// BIBLIOTECA — LIVROS
// ══════════════════════════════════════════════════════════════════
app.get('/api/livros', async (req, res) => {
    try {
        const snap = await db.collection('livros').get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
        res.status(500).json({ error: 'Erro ao listar livros.' });
    }
});

app.get('/api/livros/:id', async (req, res) => {
    try {
        const doc = await db.collection('livros').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Livro não encontrado.' });
        res.json({ id: doc.id, ...doc.data() });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao buscar livro.' });
    }
});

app.post('/api/livros', requireAdmin, async (req, res) => {
    try {
        const { codigo, nome, autor, quantidade } = req.body;
        if (!codigo || !nome || !autor) {
            return res.status(400).json({ error: 'Código, título e autor são obrigatórios.' });
        }

        const qtd = parseInt(quantidade, 10) || 1;
        if (qtd < 1) return res.status(400).json({ error: 'Quantidade deve ser pelo menos 1.' });

        const existente = await db.collection('livros')
            .where('codigo', '==', codigo)
            .limit(1)
            .get();
        if (!existente.empty) return res.status(400).json({ error: 'Já existe um livro com esse código.' });

        const data = {
            codigo,
            nome,
            autor,
            quantidade: qtd,
            quantidadeDisponivel: qtd,
            emprestado: false,
            criadoEm: new Date()
        };
        const ref = await db.collection('livros').add(data);
        await registrarLog(req.user.email, 'criou', 'livros', ref.id, null, data, `${nome} — ${autor} (${qtd}x)`);
        res.json({ success: true, id: ref.id });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao cadastrar livro.' });
    }
});

app.put('/api/livros/:id', requireAdmin, async (req, res) => {
    try {
        const { codigo, nome, autor, quantidade } = req.body;
        if (!codigo || !nome || !autor) {
            return res.status(400).json({ error: 'Código, título e autor são obrigatórios.' });
        }

        const existente = await db.collection('livros')
            .where('codigo', '==', codigo)
            .limit(1)
            .get();
        if (!existente.empty && existente.docs[0].id !== req.params.id) {
            return res.status(400).json({ error: 'Já existe outro livro com esse código.' });
        }

        const docRef = db.collection('livros').doc(req.params.id);
        const oldDoc = await docRef.get();
        const previousData = oldDoc.exists ? oldDoc.data() : null;

        const docAtual = await docRef.get();
        const atual = docAtual.data() || {};
        const novaQtd = parseInt(quantidade, 10) || atual.quantidade || 1;
        const emprestados = (atual.quantidade || 1) - (atual.quantidadeDisponivel ?? (atual.emprestado ? 0 : 1));
        const novaDisp = Math.max(0, novaQtd - emprestados);

        const data = {
            codigo,
            nome,
            autor,
            quantidade: novaQtd,
            quantidadeDisponivel: novaDisp,
            emprestado: novaDisp <= 0,
            atualizadoEm: new Date()
        };
        await docRef.update(data);
        await registrarLog(req.user.email, 'editou', 'livros', req.params.id, previousData, data, `${nome} — ${autor}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao editar livro.' });
    }
});

app.delete('/api/livros/:id', requireAdmin, async (req, res) => {
    try {
        const docRef = db.collection('livros').doc(req.params.id);
        const doc = await docRef.get();
        if (!doc.exists) return res.status(404).json({ error: 'Livro não encontrado.' });
        const livro = doc.data();

        const disponiveis = livro.quantidadeDisponivel ?? (livro.emprestado ? 0 : 1);
        const quantidade = livro.quantidade || 1;
        if (disponiveis < quantidade) {
            return res.status(400).json({
                error: `Não é possível excluir: ${quantidade - disponiveis} cópia(s) deste livro estão emprestadas no momento.`
            });
        }

        const historico = await db.collection('emprestimos')
            .where('livroId', '==', req.params.id)
            .limit(1)
            .get();
        const temHistorico = !historico.empty;
        const deleteHistory = req.query.deleteHistory === 'true';

        if (temHistorico && !deleteHistory) {
            return res.status(409).json({
                error: 'Este livro possui histórico de empréstimos.',
                temHistorico: true,
                message: 'Confirme se deseja excluir o histórico também.'
            });
        }

        const previousData = livro;

        if (deleteHistory && temHistorico) {
            const hist = await db.collection('emprestimos')
                .where('livroId', '==', req.params.id)
                .get();
            const batch = db.batch();
            hist.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
        }

        await docRef.delete();
        await registrarLog(req.user.email, 'excluiu', 'livros', req.params.id, previousData, null, `${livro.nome}${deleteHistory ? ' (histórico incluído)' : ''}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao excluir livro.' });
    }
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
    } catch (e) {
        res.status(500).json({ error: 'Erro ao listar empréstimos.' });
    }
});

app.get('/api/emprestimos/aluno/:id', requireAdmin, async (req, res) => {
    try {
        const snap = await db.collection('emprestimos')
            .where('alunoId', '==', req.params.id)
            .get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
        res.status(500).json({ error: 'Erro ao buscar empréstimos do cadastrado.' });
    }
});

app.get('/api/emprestimos/livro/:id', requireAdmin, async (req, res) => {
    try {
        const snap = await db.collection('emprestimos')
            .where('livroId', '==', req.params.id)
            .get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
        res.status(500).json({ error: 'Erro ao buscar empréstimos do livro.' });
    }
});

app.post('/api/emprestimos', requireAdmin, async (req, res) => {
    try {
        const { alunoId, livroId, quantidade } = req.body;
        if (!alunoId || !livroId) {
            return res.status(400).json({ error: 'Cadastrado e livro são obrigatórios.' });
        }

        const qtd = parseInt(quantidade, 10) || 1;
        if (qtd < 1) return res.status(400).json({ error: 'Quantidade inválida.' });

        const alunoRef = db.collection('alunosBib').doc(alunoId);
        const livroRef = db.collection('livros').doc(livroId);
        let logNomeAluno = '', logNomeLivro = '';

        await db.runTransaction(async t => {
            const [alunoSnap, livroSnap] = await Promise.all([
                t.get(alunoRef),
                t.get(livroRef)
            ]);

            if (!alunoSnap.exists) throw Object.assign(new Error('Cadastrado não encontrado.'), { code: 404 });
            if (!livroSnap.exists) throw Object.assign(new Error('Livro não encontrado.'), { code: 404 });

            const livro = livroSnap.data();
            const disponiveis = livro.quantidadeDisponivel ?? (livro.emprestado ? 0 : 1);

            if (disponiveis <= 0) {
                throw Object.assign(new Error('Não há cópias disponíveis para empréstimo.'), { code: 400 });
            }
            if (qtd > disponiveis) {
                throw Object.assign(
                    new Error(`Só existem ${disponiveis} exemplar(es) disponível(is).`),
                    { code: 400 }
                );
            }

            const aluno = alunoSnap.data();
            logNomeAluno = aluno.nome;
            logNomeLivro = livro.nome;

            const empRef = db.collection('emprestimos').doc();
            t.set(empRef, {
                alunoId,
                livroId,
                alunoNome: aluno.nome,
                alunoMatricula: aluno.matricula,
                livroNome: livro.nome,
                livroCodigo: livro.codigo,
                quantidade: qtd,
                dataEmprestimo: new Date(),
                devolvido: false
            });

            const novaDisp = disponiveis - qtd;
            t.update(livroRef, {
                quantidadeDisponivel: novaDisp,
                emprestado: novaDisp <= 0
            });
        });

        await registrarLog(req.user.email, 'emprestou', 'emprestimos', null, null, { alunoId, livroId, qtd }, `${logNomeAluno} ← ${qtd}x ${logNomeLivro}`);
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
        const { quantidade } = req.body;
        let logDetalhes = '';

        await db.runTransaction(async t => {
            const empSnap = await t.get(empRef);
            if (!empSnap.exists) {
                throw Object.assign(new Error('Empréstimo não encontrado.'), { code: 404 });
            }

            const emprestimo = empSnap.data();
            const { livroId, alunoNome, livroNome, devolvido, quantidade: qtdEmprestada } = emprestimo;

            if (devolvido) {
                throw Object.assign(new Error('Este livro já foi devolvido.'), { code: 400 });
            }

            const totalEmprestado = qtdEmprestada || 1;
            const qtdDevolver = parseInt(quantidade, 10) || totalEmprestado;

            if (qtdDevolver < 1 || qtdDevolver > totalEmprestado) {
                throw Object.assign(
                    new Error(`Quantidade inválida. O empréstimo tem ${totalEmprestado} exemplar(es).`),
                    { code: 400 }
                );
            }

            const livroRef = db.collection('livros').doc(livroId);
            const livroSnap = await t.get(livroRef);
            const livro = livroSnap.data() || {};
            const novaDisp = (livro.quantidadeDisponivel ?? 0) + qtdDevolver;

            if (qtdDevolver < totalEmprestado) {
                const novaQtd = totalEmprestado - qtdDevolver;
                t.update(empRef, { quantidade: novaQtd });
                logDetalhes = `${alunoNome} → ${qtdDevolver}x ${livroNome} (parcial, resta ${novaQtd})`;
            } else {
                t.update(empRef, { devolvido: true, dataDevolucao: new Date() });
                logDetalhes = `${alunoNome} → ${qtdDevolver}x ${livroNome} (total)`;
            }

            t.update(livroRef, {
                quantidadeDisponivel: novaDisp,
                emprestado: false
            });
        });

        await registrarLog(req.user.email, 'devolveu', 'emprestimos', req.params.id, null, { quantidade }, logDetalhes);
        res.json({ success: true });
    } catch (e) {
        if (e.code === 404) return res.status(404).json({ error: e.message });
        if (e.code === 400) return res.status(400).json({ error: e.message });
        console.error('ERRO ao registrar devolução:', e);
        res.status(500).json({ error: 'Erro ao registrar devolução.' });
    }
});

// ══════════════════════════════════════════════════════════════════
// NOVA ABA: ADMINISTRADORES (apenas super admins)
// ══════════════════════════════════════════════════════════════════

// Lista todos os admins aprovados
app.get('/api/admins', requireAdmin, async (req, res) => {
    try {
        if (!isSuperAdmin(req.user)) {
            return res.status(403).json({ error: 'Acesso negado.' });
        }
        const snap = await db.collection('registrations')
            .where('status', '==', 'approved')
            .get();
        const admins = [];
        snap.forEach(doc => {
            const data = doc.data();
            admins.push({
                uid: doc.id,
                email: data.email,
                nivel: data.nivel
            });
        });
        res.json(admins);
    } catch (e) {
        res.status(500).json({ error: 'Erro ao listar administradores.' });
    }
});

app.post('/api/admin-solicitations', requireAdmin, async (req, res) => {
    try {
        if (!isSuperAdmin(req.user)) {
            return res.status(403).json({ error: 'Apenas superadministradores podem criar este tipo de solicitação.' });
        }
        const { type, targetUid, targetEmail, newNivel } = req.body;
        if (!type || !targetUid || !targetEmail) {
            return res.status(400).json({ error: 'Dados incompletos.' });
        }
        if (type !== 'edit' && type !== 'delete') {
            return res.status(400).json({ error: 'Tipo inválido.' });
        }
        if (type === 'edit' && (newNivel === undefined || newNivel < 1 || newNivel > 8)) {
            return res.status(400).json({ error: 'Nível inválido.' });
        }

        const solicitation = {
            type,
            targetUid,
            targetEmail,
            requestedBy: req.user.email,
            requestedAt: new Date(),
            status: 'pending',
            approvals: [],
            requiredApprovals: 2
        };
        if (type === 'edit') {
            solicitation.newNivel = newNivel;
        }

        const ref = await db.collection('adminSolicitations').add(solicitation);
        res.json({ success: true, id: ref.id });
    } catch (e) {
        console.error('Erro ao criar solicitação admin:', e);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// Listar solicitações pendentes de admin
app.get('/api/admin-solicitations', requireAdmin, async (req, res) => {
    try {
        if (!isSuperAdmin(req.user)) {
            return res.status(403).json({ error: 'Acesso negado.' });
        }
        const snap = await db.collection('adminSolicitations')
            .where('status', '==', 'pending')
            .get();
        const solicitations = [];
        snap.forEach(doc => {
            solicitations.push({ id: doc.id, ...doc.data() });
        });
        res.json(solicitations);
    } catch (e) {
        res.status(500).json({ error: 'Erro ao listar solicitações.' });
    }
});

// Aprovar solicitação de admin (ao atingir 2 aprovações, executa a ação)
app.post('/api/admin-solicitations/:id/approve', requireAdmin, async (req, res) => {
    try {
        if (!isSuperAdmin(req.user)) {
            return res.status(403).json({ error: 'Apenas superadministradores podem aprovar.' });
        }

        const docRef = db.collection('adminSolicitations').doc(req.params.id);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
            return res.status(404).json({ error: 'Solicitação não encontrada.' });
        }
        const solicitation = docSnap.data();
        if (solicitation.status !== 'pending') {
            return res.status(400).json({ error: 'Solicitação já foi processada.' });
        }
        if (solicitation.approvals.includes(req.user.email)) {
            return res.status(400).json({ error: 'Você já aprovou esta solicitação.' });
        }

        const newApprovals = [...solicitation.approvals, req.user.email];
        let newStatus = 'pending';
        if (newApprovals.length >= solicitation.requiredApprovals) {
            newStatus = 'approved';
        }

        await docRef.update({ approvals: newApprovals, status: newStatus });

        if (newStatus === 'approved') {
            const { type, targetUid, newNivel } = solicitation;
            try {
                if (type === 'edit') {
                    await auth.setCustomUserClaims(targetUid, { nivel: newNivel, isAdmin: true });
                    await db.collection('registrations').doc(targetUid).update({ nivel: newNivel });
                } else if (type === 'delete') {
                    await auth.deleteUser(targetUid);
                    await db.collection('registrations').doc(targetUid).delete();
                }
                await docRef.update({ executedAt: new Date() });
                await registrarLog(
                    req.user.email,
                    `executou ação admin (${type})`,
                    'admins',
                    targetUid,
                    null,
                    null,
                    `Ação solicitada por ${solicitation.requestedBy} aprovada por ${newApprovals.join(', ')}`
                );
            } catch (execError) {
                console.error('Erro ao executar ação admin:', execError);
                await docRef.update({ status: 'error', errorMessage: execError.message });
                return res.status(500).json({ error: 'Ação aprovada mas falhou na execução: ' + execError.message });
            }
        }

        res.json({ success: true, executed: newStatus === 'approved' });
    } catch (e) {
        console.error('Erro ao aprovar solicitação admin:', e);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// ══════════════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
    console.log(`Admin Server rodando em http://localhost:${PORT}`);

    db.collection('logs').limit(1).get()
        .then(() => console.log('✅ Conexão Firestore aquecida.'))
        .catch(err => console.error('⚠️ Warm-up Firestore falhou:', err.message));

    const PING_INTERVAL = 5 * 60 * 1000;
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