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

// ══════════════════════════════════════════════════════════════════
// VALIDAÇÃO DE E-MAIL — AbstractAPI
// ══════════════════════════════════════════════════════════════════
<<<<<<< HEAD

=======
>>>>>>> 43bf2a31aa26e0303ba21da8656de17d98aa1577
const EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
const ABSTRACT_EMAIL_API_KEY = "16dafc1181bc4ee98d8da4206b21fca6";

async function validarEmail(email) {
    if (!email || typeof email !== 'string') {
        return { valid: false, reason: 'E-mail não informado.' };
    }
    const emailLimpo = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(emailLimpo)) {
        return { valid: false, reason: 'Formato de e-mail inválido.' };
    }
    try {
        const url = `https://emailvalidation.abstractapi.com/v1/?api_key=${ABSTRACT_EMAIL_API_KEY}&email=${encodeURIComponent(emailLimpo)}`;
        const res = await fetch(url);
        const data = await res.json();
<<<<<<< HEAD
        console.log(`[AbstractAPI] ${emailLimpo} → deliverability=${data.deliverability} is_disposable=${data.is_disposable_email?.value}`);
=======
        console.log(`[AbstractAPI] ${emailLimpo} → deliverability=${data.deliverability} is_disposable=${data.is_disposable_email?.value} is_valid_format=${data.is_valid_format?.value}`);
>>>>>>> 43bf2a31aa26e0303ba21da8656de17d98aa1577
        if (data.is_disposable_email?.value === true) {
            return { valid: false, reason: 'E-mails temporários ou descartáveis não são permitidos.' };
        }
        if (data.deliverability === 'UNDELIVERABLE') {
            return { valid: false, reason: 'Este e-mail não existe ou não pode receber mensagens.' };
        }
        return { valid: true };
    } catch (err) {
        console.warn('AbstractAPI indisponível, validação ignorada:', err.message);
        return { valid: true };
    }
}

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

async function requireSuperAdmin(req, res, next) {
    const sessionCookie = req.cookies.session || '';
    try {
        const claims = await auth.verifySessionCookie(sessionCookie, true);
        if (claims.isAdmin && isSuperAdmin(claims)) {
            req.user = claims;
            return next();
        }
        res.status(403).json({ error: 'Requer nível de super-administrador (Diretor ou TI).' });
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

// API Login
app.post("/sessionLogin", async (req, res) => {
    try {
        const { idToken } = req.body;
        const decoded = await auth.verifyIdToken(idToken);
        if (!decoded.isAdmin) return res.status(403).send('Não autorizado');
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

app.post('/register', async (req, res) => {
    try {
        const { uid, email, timestamp } = req.body;
        if (!uid || !email) return res.status(400).json({ error: 'Dados de registro incompletos.' });

        let firebaseUser;
        try {
            firebaseUser = await auth.getUser(uid);
        } catch (e) {
            return res.status(400).json({ error: 'Utilizador não encontrado. Por favor, tente criar a conta novamente.' });
        }

        if (firebaseUser.email !== email) {
            return res.status(400).json({ error: 'Dados de utilizador inválidos.' });
        }

        const existingDoc = await db.collection('registrations').doc(uid).get();
        if (existingDoc.exists) {
            const st = existingDoc.data().status;
            if (st === 'pending') return res.status(400).json({ error: 'Já existe um pedido de registo pendente para este e-mail.' });
            if (st === 'approved') return res.status(400).json({ error: 'Este e-mail já está aprovado como administrador.' });
        }

        const emailCheck = await validarEmail(email);
        if (!emailCheck.valid) {
            await auth.deleteUser(uid).catch(() => {});
            return res.status(400).json({ error: emailCheck.reason });
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

// ══════════════════════════════════════════════════════════════════
// HELPER: CRIAR SOLICITAÇÃO
// ══════════════════════════════════════════════════════════════════
async function criarSolicitacao({ user, collection, method, itemId = null, data, details, subAction = null }) {
    await db.collection('solicitacoes').add({
        collection,
        method,
        itemId,
        data: data || null,
        details,
        subAction,
        requestedBy: user.email,
        requestedByNivel: user.nivel ?? null,
        requestedAt: new Date(),
        status: 'pending'
    });
    db.collection('logs').add({
        adminEmail: user.email,
        action: `solicitou ${method === 'POST' ? 'criar' : method === 'PUT' ? 'editar' : 'excluir'}`,
        collection,
        details,
        timestamp: new Date()
    });
}

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

            if (!isSuperAdmin(req.user)) {
                await criarSolicitacao({ user: req.user, collection: col, method: 'POST', data, details });
                return res.status(202).json({ pending: true, message: 'Solicitação de criação enviada para aprovação.' });
            }

            const ref = await db.collection(col).add(data);
            db.collection('logs').add({
                adminEmail: req.user.email,
                action: 'criou',
                collection: col,
                details,
                timestamp: new Date()
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
                await criarSolicitacao({
                    user: req.user,
                    collection: col,
                    method: 'PUT',
                    itemId: req.params.id,
                    data,
                    details
                });
                return res.status(202).json({ pending: true, message: 'Solicitação de edição enviada para aprovação.' });
            }

            await db.collection(col).doc(req.params.id).update(data);
            db.collection('logs').add({
                adminEmail: req.user.email,
                action: 'editou',
                collection: col,
                details,
                timestamp: new Date()
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
                await criarSolicitacao({
                    user: req.user,
                    collection: col,
                    method: 'DELETE',
                    itemId: req.params.id,
                    data: null,
                    details: req.params.id
                });
                return res.status(202).json({ pending: true, message: 'Solicitação de exclusão enviada para aprovação.' });
            }

            await db.collection(col).doc(req.params.id).delete();
            db.collection('logs').add({
                adminEmail: req.user?.email || 'admin',
                action: 'excluiu',
                collection: col,
                details: req.params.id,
                timestamp: new Date()
            });
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

        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({
                user: req.user,
                collection: 'docente',
                method: 'POST',
                data,
                details: data.nome
            });
            return res.status(202).json({ pending: true, message: 'Solicitação de criação enviada para aprovação.' });
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

        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({
                user: req.user,
                collection: 'docente',
                method: 'PUT',
                itemId: req.params.id,
                data,
                details: data.nome || req.params.id
            });
            return res.status(202).json({ pending: true, message: 'Solicitação de edição enviada para aprovação.' });
        }

        await db.collection('docente').doc(req.params.id).update(data);
        db.collection('logs').add({
            adminEmail: req.user.email,
            action: 'editou',
            collection: 'docente',
            details: data.nome || req.params.id,
            timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) {
        console.error('ERRO ao editar docente:', JSON.stringify(e));
        res.status(500).json({ error: 'Erro ao editar docente.', detalhe: e.message });
    }
});

app.delete('/api/docente/:id', requireAdmin, async (req, res) => {
    try {
        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({
                user: req.user,
                collection: 'docente',
                method: 'DELETE',
                itemId: req.params.id,
                data: null,
                details: req.params.id
            });
            return res.status(202).json({ pending: true, message: 'Solicitação de exclusão enviada para aprovação.' });
        }

        await db.collection('docente').doc(req.params.id).delete();
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
            if (!isSuperAdmin(req.user)) {
                await criarSolicitacao({
                    user: req.user,
                    collection: col,
                    method: 'POST',
                    data: req.body,
                    details: `Atualização de ${col}`
                });
                return res.status(202).json({ pending: true, message: 'Solicitação enviada para aprovação.' });
            }
            await db.collection(col).doc('main').set(req.body, { merge: true });
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: 'Erro ao salvar dados.' });
        }
    });
});

// ══════════════════════════════════════════════════════════════════
// PENDENTES, LOGS E SOLICITAÇÕES
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

app.post('/api/pendentes/negar', requireSuperAdmin, async (req, res) => {
    try {
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
// GESTÃO DE ADMINISTRADORES
// ══════════════════════════════════════════════════════════════════
app.get('/api/admins', requireSuperAdmin, async (req, res) => {
    try {
        const list = await auth.listUsers(1000);
        const admins = list.users
            .filter(u => u.customClaims?.isAdmin === true)
            .map(u => ({
                uid: u.uid,
                email: u.email,
                nivel: u.customClaims?.nivel ?? null
            }));
        res.json(admins);
    } catch (e) {
        res.status(500).json({ error: 'Erro ao listar administradores.' });
    }
});

app.get('/api/admin-solicitations', requireSuperAdmin, async (req, res) => {
    try {
        const snap = await db.collection('admin_solicitations')
            .where('status', '==', 'pending')
            .get();
        const docs = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => {
                const ta = a.requestedAt?.toMillis ? a.requestedAt.toMillis() : 0;
                const tb = b.requestedAt?.toMillis ? b.requestedAt.toMillis() : 0;
                return tb - ta;
            });
        res.json(docs);
    } catch (e) {
        res.status(500).json({ error: 'Erro ao listar solicitações de admin.' });
    }
});

app.post('/api/admin-solicitations', requireSuperAdmin, async (req, res) => {
    try {
        const { type, targetUid, targetEmail, newNivel } = req.body;
        if (!type || !targetUid || !targetEmail) {
            return res.status(400).json({ error: 'Dados incompletos.' });
        }
        if (type === 'edit' && (isNaN(parseInt(newNivel)) || newNivel < 1 || newNivel > 8)) {
            return res.status(400).json({ error: 'Nível inválido (1-8).' });
        }
        const existingSnap = await db.collection('admin_solicitations')
            .where('targetUid', '==', targetUid)
            .get();
        const hasPending = existingSnap.docs.some(d => d.data().status === 'pending');
        if (hasPending) {
            return res.status(400).json({ error: 'Já existe uma solicitação pendente para este administrador.' });
        }

        const doc = {
            type,
            targetUid,
            targetEmail,
            newNivel: newNivel ?? null,
            requestedBy: req.user.email,
            requestedAt: new Date(),
            approvals: [req.user.email],
            requiredApprovals: 2,
            status: 'pending'
        };
        const ref = await db.collection('admin_solicitations').add(doc);
        res.json({ success: true, id: ref.id });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao criar solicitação.' });
    }
});

app.post('/api/admin-solicitations/:id/approve', requireSuperAdmin, async (req, res) => {
    try {
        const solRef = db.collection('admin_solicitations').doc(req.params.id);
        const solSnap = await solRef.get();
        if (!solSnap.exists) return res.status(404).json({ error: 'Solicitação não encontrada.' });
        const sol = solSnap.data();
        if (sol.status !== 'pending') return res.status(400).json({ error: 'Solicitação já resolvida.' });

        const approvals = sol.approvals || [];
        if (!approvals.includes(req.user.email)) {
            approvals.push(req.user.email);
        }
        await solRef.update({ approvals });

        if (approvals.length >= (sol.requiredApprovals || 2)) {
            if (sol.type === 'edit') {
                await auth.setCustomUserClaims(sol.targetUid, {
                    isAdmin: true,
                    nivel: parseInt(sol.newNivel),
                    status: null
                });
                await db.collection('registrations').doc(sol.targetUid).update({
                    nivel: parseInt(sol.newNivel),
                    updatedAt: new Date(),
                    updatedBy: req.user.email
                }).catch(() => {});
            } else if (sol.type === 'delete') {
                await auth.deleteUser(sol.targetUid);
                await db.collection('registrations').doc(sol.targetUid).update({
                    status: 'deleted',
                    deletedAt: new Date(),
                    deletedBy: req.user.email
                }).catch(() => {});
            }
            await solRef.update({
                status: 'approved',
                resolvedAt: new Date(),
                resolvedBy: req.user.email
            });
            db.collection('logs').add({
                adminEmail: req.user.email,
                action: `admin-solicitation/${sol.type} executada`,
                details: `Alvo: ${sol.targetEmail}`,
                timestamp: new Date()
            }).catch(() => {});
        }
        res.json({ success: true, approvals });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao aprovar solicitação.' });
    }
});

app.get('/api/logs', requireAdmin, async (req, res) => {
    try {
        const snap = await db.collection('logs')
            .orderBy('timestamp', 'desc')
            .limit(50)
            .get();
        res.json(snap.docs.map(d => d.data()));
    } catch (e) {
        res.status(500).json({ error: 'Erro ao buscar logs.' });
    }
});

<<<<<<< HEAD
=======
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

>>>>>>> 43bf2a31aa26e0303ba21da8656de17d98aa1577
app.get('/api/solicitacoes', requireAdmin, async (req, res) => {
    try {
        let snap;
        if (isSuperAdmin(req.user)) {
            snap = await db.collection('solicitacoes')
                .where('status', '==', 'pending')
                .orderBy('requestedAt', 'desc')
                .get();
        } else {
            snap = await db.collection('solicitacoes')
                .where('requestedBy', '==', req.user.email)
                .where('status', '==', 'pending')
                .orderBy('requestedAt', 'desc')
                .get();
        }
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
        res.status(500).json({ error: 'Erro ao listar solicitações.' });
    }
});

async function executarAcao(sol) {
    const { collection, method, itemId, data } = sol;

    if (method === 'DELETE' && collection === 'livros') {
        if (data?.deleteHistory) {
            const hist = await db.collection('emprestimos')
                .where('livroId', '==', itemId)
                .get();
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

        await solRef.update({
            status: 'approved',
            resolvedBy: req.user.email,
            resolvedAt: new Date()
        });
        db.collection('logs').add({
            adminEmail: req.user.email,
            action: 'aprovou solicitação',
            collection: sol.collection,
            details: sol.details,
            timestamp: new Date()
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

        await solRef.update({
            status: 'denied',
            resolvedBy: req.user.email,
            resolvedAt: new Date()
        });
        db.collection('logs').add({
            adminEmail: req.user.email,
            action: 'negou solicitação',
            collection: solSnap.data().collection,
            details: solSnap.data().details,
            timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao negar solicitação.' });
    }
});

// ══════════════════════════════════════════════════════════════════
// BIBLIOTECA — ALUNOS (com geração automática de matrícula)
// ══════════════════════════════════════════════════════════════════
app.get('/api/alunosBib', requireAdmin, async (req, res) => {
    try {
        const snap = await db.collection('alunosBib').get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
        res.status(500).json({ error: 'Erro ao listar alunos.' });
    }
});

app.get('/api/alunosBib/:id', requireAdmin, async (req, res) => {
    try {
        const doc = await db.collection('alunosBib').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Aluno não encontrado.' });
        res.json({ id: doc.id, ...doc.data() });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao buscar aluno.' });
    }
});

app.post('/api/alunosBib', requireAdmin, async (req, res) => {
    try {
        let { matricula, nome, tipo } = req.body;
        if (!nome || !tipo) {
            return res.status(400).json({ error: 'Nome e tipo são obrigatórios.' });
        }
<<<<<<< HEAD
=======

        // 🔧 GERAÇÃO AUTOMÁTICA DE MATRÍCULA PARA PROFESSOR
        if (tipo === 'professor' && !matricula) {
            const todosProfessores = await db.collection('alunosBib')
                .where('tipo', '==', 'professor')
                .get();

            let ultimoNumero = 0;
            todosProfessores.forEach(doc => {
                const mat = doc.data().matricula;
                if (mat && mat.startsWith('SGBGP')) {
                    const num = parseInt(mat.replace('SGBGP', ''), 10);
                    if (!isNaN(num) && num > ultimoNumero) {
                        ultimoNumero = num;
                    }
                }
            });

            const proximoNumero = ultimoNumero + 1;
            matricula = `SGBGP${String(proximoNumero).padStart(3, '0')}`;
        }

        if (!matricula) {
            return res.status(400).json({ error: 'Matrícula é obrigatória para alunos.' });
        }
>>>>>>> 43bf2a31aa26e0303ba21da8656de17d98aa1577

        // 🔧 Geração automática para professor se a matrícula não foi enviada
        if (tipo === 'professor' && !matricula) {
            const professoresSnap = await db.collection('alunosBib')
                .where('tipo', '==', 'professor')
                .orderBy('matricula', 'desc')
                .limit(1)
                .get();
            
            let ultimoNumero = 0;
            if (!professoresSnap.empty) {
                const ultimaMatricula = professoresSnap.docs[0].data().matricula;
                const numeroString = ultimaMatricula.replace('SGBGP', '');
                ultimoNumero = parseInt(numeroString, 10) || 0;
            }
            const proximoNumero = ultimoNumero + 1;
            matricula = `SGBGP${String(proximoNumero).padStart(3, '0')}`;
        }

        // Validação de matrícula obrigatória para aluno
        if (!matricula) {
            return res.status(400).json({ error: 'Matrícula é obrigatória para alunos.' });
        }

        // Verificar duplicidade de matrícula
        const existente = await db.collection('alunosBib')
            .where('matricula', '==', matricula)
            .limit(1)
            .get();
        if (!existente.empty) {
            return res.status(400).json({ error: 'Já existe um cadastro com essa matrícula.' });
        }

        // Salva via solicitação ou diretamente
        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({
                user: req.user,
                collection: 'alunosBib',
                method: 'POST',
                data: { matricula, nome, tipo },
                details: `${nome} (${matricula}) [${tipo}]`
            });
            return res.status(202).json({ pending: true, message: 'Solicitação de criação enviada para aprovação.' });
        }

        const ref = await db.collection('alunosBib').add({
            matricula,
            nome,
            tipo,
            criadoEm: new Date()
        });

        db.collection('logs').add({
            adminEmail: req.user.email,
            action: 'criou',
            collection: 'alunosBib',
            details: `${nome} (${matricula}) [${tipo}]`,
            timestamp: new Date()
        });
<<<<<<< HEAD
        res.json({ success: true, id: ref.id, matricula });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao cadastrar.' });
=======

        res.json({ success: true, id: ref.id, matricula });
    } catch (e) {
        console.error('Erro ao cadastrar:', e);
        res.status(500).json({ error: 'Erro ao cadastrar. ' + e.message });
>>>>>>> 43bf2a31aa26e0303ba21da8656de17d98aa1577
    }
});

app.put('/api/alunosBib/:id', requireAdmin, async (req, res) => {
    try {
        const { matricula, nome, tipo } = req.body;
        if (!matricula || !nome || !tipo) {
            return res.status(400).json({ error: 'Matrícula, nome e tipo são obrigatórios.' });
        }

        const existente = await db.collection('alunosBib')
            .where('matricula', '==', matricula)
            .limit(1)
            .get();
        if (!existente.empty && existente.docs[0].id !== req.params.id) {
            return res.status(400).json({ error: 'Já existe outro cadastro com essa matrícula.' });
        }

        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({
                user: req.user,
                collection: 'alunosBib',
                method: 'PUT',
                itemId: req.params.id,
                data: { matricula, nome, tipo },
                details: `${nome} (${matricula}) [${tipo}]`
            });
            return res.status(202).json({ pending: true, message: 'Solicitação de edição enviada para aprovação.' });
        }

        await db.collection('alunosBib').doc(req.params.id).update({
            matricula,
            nome,
            tipo,
            atualizadoEm: new Date()
        });
        db.collection('logs').add({
            adminEmail: req.user.email,
            action: 'editou',
            collection: 'alunosBib',
            details: `${nome} (${matricula}) [${tipo}]`,
            timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao editar.' });
    }
});

app.delete('/api/alunosBib/:id', requireAdmin, async (req, res) => {
    try {
        const empAtivos = await db.collection('emprestimos')
            .where('alunoId', '==', req.params.id)
            .where('devolvido', '==', false)
            .get();
        if (!empAtivos.empty) {
            return res.status(400).json({ error: 'Não é possível excluir um aluno com empréstimos em andamento.' });
        }

        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({
                user: req.user,
                collection: 'alunosBib',
                method: 'DELETE',
                itemId: req.params.id,
                data: null,
                details: req.params.id
            });
            return res.status(202).json({ pending: true, message: 'Solicitação de exclusão enviada para aprovação.' });
        }

        await db.collection('alunosBib').doc(req.params.id).delete();
        db.collection('logs').add({
            adminEmail: req.user?.email || 'admin',
            action: 'excluiu',
            collection: 'alunosBib',
            details: req.params.id,
            timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao excluir.' });
    }
});

// ══════════════════════════════════════════════════════════════════
// BIBLIOTECA — LIVROS (mantido igual, sem alterações)
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

        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({
                user: req.user,
                collection: 'livros',
                method: 'POST',
                data: { codigo, nome, autor, quantidade: qtd },
                details: `${nome} — ${autor} (${qtd}x)`
            });
            return res.status(202).json({ pending: true, message: 'Solicitação de criação enviada para aprovação.' });
        }

        const ref = await db.collection('livros').add({
            codigo,
            nome,
            autor,
            quantidade: qtd,
            quantidadeDisponivel: qtd,
            emprestado: false,
            criadoEm: new Date()
        });
        db.collection('logs').add({
            adminEmail: req.user.email,
            action: 'criou',
            collection: 'livros',
            details: `${nome} — ${autor} (${qtd}x)`,
            timestamp: new Date()
        });
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

        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({
                user: req.user,
                collection: 'livros',
                method: 'PUT',
                itemId: req.params.id,
                data: { codigo, nome, autor, quantidade: parseInt(quantidade, 10) || undefined },
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
            codigo,
            nome,
            autor,
            quantidade: novaQtd,
            quantidadeDisponivel: novaDisp,
            emprestado: novaDisp <= 0,
            atualizadoEm: new Date()
        });
        db.collection('logs').add({
            adminEmail: req.user.email,
            action: 'editou',
            collection: 'livros',
            details: `${nome} — ${autor}`,
            timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao editar livro.' });
    }
});

app.delete('/api/livros/:id', requireAdmin, async (req, res) => {
    try {
        const doc = await db.collection('livros').doc(req.params.id).get();
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

        if (!isSuperAdmin(req.user)) {
            await criarSolicitacao({
                user: req.user,
                collection: 'livros',
                method: 'DELETE',
                itemId: req.params.id,
                data: { deleteHistory },
                details: `${livro.nome} — ${livro.autor}${deleteHistory ? ' (com histórico)' : ''}`
            });
            return res.status(202).json({ pending: true, message: 'Solicitação de exclusão enviada para aprovação.' });
        }

        if (deleteHistory && temHistorico) {
            const hist = await db.collection('emprestimos')
                .where('livroId', '==', req.params.id)
                .get();
            const batch = db.batch();
            hist.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
        }

        await db.collection('livros').doc(req.params.id).delete();
        db.collection('logs').add({
            adminEmail: req.user?.email || 'admin',
            action: 'excluiu',
            collection: 'livros',
            details: `${livro.nome}${deleteHistory ? ' (histórico incluído)' : ''}`,
            timestamp: new Date()
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao excluir livro.' });
    }
});

// ══════════════════════════════════════════════════════════════════
<<<<<<< HEAD
// BIBLIOTECA — EMPRÉSTIMOS (mantido igual)
=======
// BIBLIOTECA — EMPRÉSTIMOS
>>>>>>> 43bf2a31aa26e0303ba21da8656de17d98aa1577
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
        res.status(500).json({ error: 'Erro ao buscar empréstimos do aluno.' });
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
            return res.status(400).json({ error: 'Aluno e livro são obrigatórios.' });
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

            if (!alunoSnap.exists) throw Object.assign(new Error('Aluno não encontrado.'), { code: 404 });
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

        db.collection('logs').add({
            adminEmail: req.user.email,
            action: 'emprestou',
            collection: 'emprestimos',
            details: `${logNomeAluno} ← ${qtd}x ${logNomeLivro}`,
            timestamp: new Date()
        });
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

        db.collection('logs').add({
            adminEmail: req.user.email,
            action: 'devolveu',
            collection: 'emprestimos',
            details: logDetalhes,
            timestamp: new Date()
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