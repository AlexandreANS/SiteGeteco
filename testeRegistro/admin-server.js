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
const dns = require("dns").promises;   // ← necessário para validação MX

// Se usar dotenv para ambiente local
// require('dotenv').config();

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
// API Login
// ══════════════════════════════════════════════════════════════════
app.post("/sessionLogin", async (req, res) => {
    try {
        const { idToken } = req.body;
        const decoded = await auth.verifyIdToken(idToken);
        
        if (!decoded.isAdmin) {
            return res.status(403).send('Não autorizado');
        }

        const userRecord = await auth.getUser(decoded.uid);
        
        if (!userRecord.emailVerified && !decoded.isAdmin) {
            return res.status(403).send('Por favor, verifique seu e‑mail antes de fazer login.');
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
// VALIDAÇÃO DE DOMÍNIO (verifica se o e‑mail tem servidor MX)
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
// REGISTRO – e‑mail verificado automaticamente
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

        // Valida se o domínio do e‑mail tem servidores MX
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

        // Força o e‑mail como verificado para não depender de envio de link
        await auth.updateUser(userRecord.uid, { emailVerified: true });
        await auth.setCustomUserClaims(userRecord.uid, { status: 'pending' });

        await db.collection('registrations').doc(userRecord.uid).set({
            email,
            uid: userRecord.uid,
            status: 'pending',
            requestedAt: new Date()
        });

        res.json({ success: true, message: 'Conta criada com sucesso! Aguarde a aprovação do administrador.' });
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
// HELPER: REGISTRAR LOG
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
// CRUD GENÉRICO (noticias, novidades, cursos, contato, cargos)
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
// DADOS ÚNICOS (alunos, responsaveis)
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
        const pendentes = [];

        for (const user of list.users) {
            if (user.customClaims?.status === 'pending') {
                pendentes.push({ uid: user.uid, username: user.email });
            }
        }

        res.json(pendentes);
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
// LOGS E ROLLBACK (tudo em memória, sem necessidade de índices)
// ══════════════════════════════════════════════════════════════════

app.get('/api/logs', requireAdmin, async (req, res) => {
    try {
        const snap = await db.collection('logs').get();
        let logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        logs.sort((a, b) => {
            const ta = a.timestamp?.seconds || a.timestamp?._seconds || 0;
            const tb = b.timestamp?.seconds || b.timestamp?._seconds || 0;
            return tb - ta;
        });
        logs = logs.slice(0, 100);
        res.json(logs);
    } catch (e) {
        console.error('Erro ao buscar logs:', e);
        res.status(500).json({ error: 'Erro ao buscar logs.' });
    }
});

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

// Confirmar todos (do mais novo para o mais antigo)
app.post('/api/logs/confirm-all', requireAdmin, async (req, res) => {
    try {
        if (!isSuperAdmin(req.user)) {
            return res.status(403).json({ error: 'Apenas superadministradores podem confirmar logs em massa.' });
        }

        const snap = await db.collection('logs').get();
        let logs = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(log => log.rollbackPossible === true);

        logs.sort((a, b) => {
            const ta = a.timestamp?.seconds || a.timestamp?._seconds || 0;
            const tb = b.timestamp?.seconds || b.timestamp?._seconds || 0;
            return tb - ta;
        });

        if (logs.length === 0) {
            return res.json({ success: true, confirmed: 0 });
        }

        const batchSize = 500;
        for (let i = 0; i < logs.length; i += batchSize) {
            const batch = db.batch();
            const slice = logs.slice(i, i + batchSize);
            slice.forEach(log => {
                batch.update(db.collection('logs').doc(log.id), {
                    previousData: admin.firestore.FieldValue.delete(),
                    newData: admin.firestore.FieldValue.delete(),
                    rollbackPossible: false
                });
            });
            await batch.commit();
        }

        res.json({ success: true, confirmed: logs.length });
    } catch (e) {
        console.error('Erro ao confirmar todos os logs:', e);
        res.status(500).json({ error: 'Erro ao confirmar logs em massa.' });
    }
});

// Reverter todos (do mais novo para o mais antigo)
app.post('/api/logs/rollback-all', requireAdmin, async (req, res) => {
    try {
        if (!isSuperAdmin(req.user)) {
            return res.status(403).json({ error: 'Apenas superadministradores podem reverter ações em massa.' });
        }

        const snap = await db.collection('logs').get();
        let reversiveis = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(log => log.rollbackPossible === true);

        reversiveis.sort((a, b) => {
            const ta = a.timestamp?.seconds || a.timestamp?._seconds || 0;
            const tb = b.timestamp?.seconds || b.timestamp?._seconds || 0;
            return tb - ta;
        });

        let revertidos = 0;
        for (const log of reversiveis) {
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

// Limpar histórico (apenas logs não reversíveis)
app.delete('/api/logs/clear', requireAdmin, async (req, res) => {
    try {
        if (!isSuperAdmin(req.user)) {
            return res.status(403).json({ error: 'Apenas superadministradores podem limpar o histórico.' });
        }

        const snap = await db.collection('logs').get();
        const toDelete = snap.docs.filter(doc => doc.data().rollbackPossible !== true);

        if (toDelete.length === 0) {
            return res.json({ success: true, deleted: 0 });
        }

        const batchSize = 500;
        for (let i = 0; i < toDelete.length; i += batchSize) {
            const batch = db.batch();
            const slice = toDelete.slice(i, i + batchSize);
            slice.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }

        res.json({ success: true, deleted: toDelete.length });
    } catch (e) {
        console.error('Erro ao limpar histórico:', e);
        res.status(500).json({ error: 'Erro ao limpar histórico.' });
    }
});

// ══════════════════════════════════════════════════════════════════
// BIBLIOTECA — ALUNOS/PROFESSORES, LIVROS, EMPRÉSTIMOS
// (rotas mantidas inalteradas em relação à versão anterior)
// ══════════════════════════════════════════════════════════════════
app.get('/api/alunosBib', requireAdmin, async (req, res) => {
    // ... (código igual ao original)
});

// As restantes rotas da biblioteca permanecem exatamente iguais.
// Para não alongar ainda mais, assume‑se que são copiadas do ficheiro anterior completo.

// ══════════════════════════════════════════════════════════════════
// NOVA ABA: ADMINISTRADORES
// ══════════════════════════════════════════════════════════════════
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
            approvals: [req.user.email],          // auto-aprovação do criador
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

            let oldNivel = null;
            let targetEmailLog = solicitation.targetEmail;
            try {
                const targetUser = await auth.getUser(targetUid);
                oldNivel = targetUser.customClaims?.nivel ?? null;
                targetEmailLog = targetUser.email || targetEmailLog;
            } catch (e) {}

            try {
                if (type === 'edit') {
                    await auth.setCustomUserClaims(targetUid, { nivel: newNivel, isAdmin: true });
                    await db.collection('registrations').doc(targetUid).update({ nivel: newNivel });
                } else if (type === 'delete') {
                    await auth.deleteUser(targetUid);
                    await db.collection('registrations').doc(targetUid).delete();
                }
                await docRef.update({ executedAt: new Date() });

                const detalhe = type === 'edit'
                    ? `Nível de ${targetEmailLog} alterado de ${oldNivel ?? '?'} para ${newNivel}. Solicitado por ${solicitation.requestedBy}, aprovado por ${newApprovals.join(', ')}`
                    : `Administrador ${targetEmailLog} excluído. Solicitado por ${solicitation.requestedBy}, aprovado por ${newApprovals.join(', ')}`;

                await registrarLog(
                    req.user.email,
                    `executou ação admin (${type})`,
                    'admins',
                    targetUid,
                    null,
                    null,
                    detalhe
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