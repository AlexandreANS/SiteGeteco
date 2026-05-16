# 🔍 ERROS ENCONTRADOS NOS ARQUIVOS HTML

## ❌ ERRO 1: HARDCODE DE `localhost` NO INDEX.HTML

### Arquivo Afetado:
`ProjetoGetecoTeste/views/index.html` - Script do fetch de notícias

### Problema:
```javascript
fetch(`http://localhost:3000/api/noticias`)  // ❌ ERRADO EM SERVIDOR REAL
```

**Em servidor real:**
- Domínio pode ser: `meusite.com` ou `192.168.1.100`
- Mas o código tenta acessar `localhost:3000` - **FALHA COMPLETA**

### Consequência:
- ❌ CORS error (requisição bloqueada)
- ❌ Notícias não carregam em produção
- ❌ Console mostra: "Access to XMLHttpRequest at 'http://localhost:3000/api/noticias' from origin 'http://meusite.com:5000' has been blocked by CORS policy"

### Solução:
```javascript
// ✅ USAR HOSTNAME DINÂMICO
const API_HOST = window.location.hostname;  // Pega o hostname real
const API_PORT = 3000;

fetch(`http://${API_HOST}:${API_PORT}/api/noticias`)
```

---

## ❌ ERRO 2: ARQUIVO NOTICIAS.HTML NÃO CARREGA NOTÍCIAS

### Arquivo Afetado:
`ProjetoGetecoTeste/views/noticias.html`

### Problema:
Arquivo existe mas **NÃO TEM SCRIPT** para carregar notícias do banco de dados.

```html
<!-- SEM FETCH! -->
<div id="noticias-content">Carregando...</div>
<!-- Fica assim para sempre! -->
```

### Consequência:
- ❌ Página fica com "Carregando..." eternamente
- ❌ Nenhuma notícia é exibida
- ❌ Usuário não vê conteúdo

### Solução:
Adicionar o mesmo script de fetch que está em `index.html` (com hostname dinâmico)

---

## ❌ ERRO 3: CREDENCIAIS FIREBASE NO HTML (SEGURANÇA)

### Arquivo Afetado:
`testeRegistro/views/login.html` - Config Firebase inline

### Problema:
```javascript
const firebaseConfig = {
    apiKey: "AIzaSyDAl-UN5A0Ei8K-8XuMyNGOJgPRyzr35NE",  // ❌ EXPOSTO!
    authDomain: "geteco-9ae02.firebaseapp.com",
    projectId: "geteco-9ae02",
    // ... mais credenciais
};
```

**Em servidor real:**
- Credenciais ficam visíveis no HTML
- Qualquer pessoa pode inspecionar o código fonte
- Possibilidade de abuso da API Firebase

### Consequência:
- ⚠️ Risco de segurança
- ⚠️ Possibilidade de falsificar requisições
- ⚠️ Custo de Firebase pode explodir se alguém usar suas credenciais

### Solução:
Carregar config de um arquivo seguro no servidor:

```javascript
// Carregar do servidor (NÃO exposto)
fetch('/firebase-config.json')
  .then(res => res.json())
  .then(firebaseConfig => {
    firebase.initializeApp(firebaseConfig);
  });
```

---

## ❌ ERRO 4: VALIDAÇÃO INADEQUADA NO LOGIN

### Arquivo Afetado:
`testeRegistro/views/login.html`

### Problema:
```javascript
// Pouquíssimo tratamento de erro
.catch(error) { 
    console.error('Erro de login:', error);
    alert(error.message || "Utilizador ou senha incorretos!");
}
```

**Problemas:**
- Mensagens genéricas e confusas
- Não diferencia entre erro de Firebase vs servidor
- Sem feedback visual claro

### Solução:
```javascript
// Mensagens específicas para cada tipo de erro
if (error.code === 'auth/user-not-found') {
    mensagem = "Utilizador não encontrado.";
} else if (error.code === 'auth/wrong-password') {
    mensagem = "Senha incorreta.";
} else if (error.code === 'auth/too-many-requests') {
    mensagem = "Muitas tentativas. Tente mais tarde.";
}
```

---

## ❌ ERRO 5: VALIDAÇÃO SÓ NO CLIENTE NO REGISTER

### Arquivo Afetado:
`testeRegistro/views/register.html`

### Problema:
```javascript
// Validação APENAS no JavaScript
if (pass !== confirm) {
    alert('As senhas não coincidem!');
    e.preventDefault();
}
```

**Em servidor real:**
- Usuário pode desabilitar JavaScript
- Usuário pode enviar dados diretamente via API
- Sem validação no servidor, qualquer coisa passa

### Consequência:
- ⚠️ Dados inválidos entram no banco
- ⚠️ Contas criadas com senhas fracas
- ⚠️ Fácil de contornar

### Solução:
1. ✅ Validação no cliente (UX)
2. ✅ Validação robusta no servidor (segurança)

```javascript
// Cliente: validação de UX
if (password.length < 6) {
    showError('Senha deve ter 6+ caracteres.');
}

// Servidor: validação de segurança
app.post('/register', (req, res) => {
    const { email, password } = req.body;
    
    // Validar novamente no servidor!
    if (!email || !password || password.length < 6) {
        return res.status(400).json({ error: 'Dados inválidos' });
    }
    
    // Prosseguir...
});
```

---

## ❌ ERRO 6: SEM TRATAMENTO DE ERRO NOS FETCH

### Arquivo Afetado:
`ProjetoGetecoTeste/views/index.html`, `novidades.html`

### Problema:
```javascript
fetch(...)
  .then(res => res.json())  // ❌ Não valida res.ok
  .then(data => {
    // Se status for 500, ainda tenta usar dados
  })
  .catch(() => {
    // Mensagem genérica
  });
```

### Consequência:
- ❌ Erros de servidor (500) não são tratados
- ❌ Usuário vê mensagem confusa
- ❌ Difícil debugar em produção

### Solução:
```javascript
fetch(...)
  .then(res => {
    if (!res.ok) {
      throw new Error(`Erro ${res.status}: ${res.statusText}`);
    }
    return res.json();
  })
  .catch(error => {
    console.error('Erro real:', error);
    // Mostrar mensagem útil
  });
```

---

## ❌ ERRO 7: XSS (CROSS-SITE SCRIPTING)

### Arquivo Afetado:
Todos os que usam `.innerHTML` com dados do BD

### Problema:
```javascript
card.innerHTML = `<h3>${noticia.titulo}</h3><p>${noticia.conteudo}</p>`;
```

Se alguém colocar `<script>alert('hacked')</script>` no título no BD, será executado!

### Solução:
```javascript
// ✅ Usar textContent (text puro, sem HTML)
const titulo = document.createElement('h3');
titulo.textContent = noticia.titulo;  // Seguro!
card.appendChild(titulo);
```

---

## 📋 CHECKLIST PARA SERVIDOR REAL

- [ ] **Remover `localhost`** - Usar `window.location.hostname`
- [ ] **Carregar config Firebase do servidor** - Não hardcode
- [ ] **Adicionar validação robusta no cliente**
- [ ] **Adicionar validação no servidor** (MUITO IMPORTANTE!)
- [ ] **Usar textContent ao invés de innerHTML** para dados do BD
- [ ] **Melhorar mensagens de erro**
- [ ] **Sempre validar `res.ok`** nos fetchs
- [ ] **Testar em domínio real** antes de colocar em produção

---

## 🧪 COMO TESTAR ANTES DE COLOCAR EM PRODUÇÃO

```bash
# 1. Teste localmente com um domínio fake
# Adicionar em /etc/hosts (ou C:\Windows\System32\drivers\etc\hosts):
127.0.0.1  geteco.local

# 2. Acessar via: http://geteco.local:5000
# Verificar se:
# - Notícias carregam
# - Login funciona
# - Register funciona
# - Nenhum erro de CORS

# 3. Abrir console (F12) e verificar:
# - Nenhum erro vermelho
# - Todos os fetchs retornam 200
```

---

Arquivos corrigidos nesta pasta:
- ✅ `index-corrigido.html`
- ✅ `noticias-corrigido.html`
- ✅ `login-corrigido.html`
- ✅ `register-corrigido.html`
