// ✅ ARQUIVO CORRIGIDO PARA: testeRegistro/js/dashboard.js

// ============================================================
// ✅ CORREÇÃO 1: URL BASE CORRETA (porto 3000, não 5000)
// ============================================================
const API_BASE = "http://localhost:3000/api";  // ✅ CORRETO - Admin server
// Antes era: const API_BASE = "http://localhost:5000/api";  ❌ ERRADO


// Elementos do DOM
const form = document.getElementById("configForm");
const siteTitle = document.getElementById("siteTitle");
const description = document.getElementById("description");
const statusMessage = document.getElementById("statusMessage");

// ============================================================
// ✅ CORREÇÃO 2: FETCH COM TRATAMENTO DE ERRO ADEQUADO
// ============================================================

// Buscar dados de configuração do admin server
fetch(`${API_BASE}/config`)
  .then(res => {
    // ✅ NOVO: Validar se a resposta foi bem-sucedida
    if (!res.ok) {
      throw new Error(`Erro ${res.status}: ${res.statusText}`);
    }
    return res.json();
  })
  .then(data => {
    // Preencher campos do formulário
    siteTitle.value = data.siteTitle || "";
    description.value = data.description || "";
    console.log("✅ Configuração carregada com sucesso");
  })
  .catch(err => {
    console.error("❌ Erro ao carregar configuração:", err);
    statusMessage.textContent = "Erro ao carregar configuração: " + err.message;
    statusMessage.style.color = "red";
  });


// ============================================================
// ✅ CORREÇÃO 3: ENVIAR ALTERAÇÕES COM VALIDAÇÃO
// ============================================================

form.addEventListener("submit", function (e) {
  e.preventDefault();

  // Validar se os campos não estão vazios
  if (!siteTitle.value.trim() || !description.value.trim()) {
    statusMessage.textContent = "Por favor, preencha todos os campos!";
    statusMessage.style.color = "orange";
    return;
  }

  const updatedConfig = {
    siteTitle: siteTitle.value.trim(),
    description: description.value.trim(),
  };

  fetch(`${API_BASE}/update-config`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json"
    },
    body: JSON.stringify(updatedConfig),
  })
    .then(res => {
      // ✅ NOVO: Validar resposta
      if (!res.ok) {
        throw new Error(`Erro ${res.status}: ${res.statusText}`);
      }
      return res.json();
    })
    .then(response => {
      // ✅ NOVO: Validar se a operação foi bem-sucedida
      if (response.success) {
        statusMessage.textContent = "✅ Configurações atualizadas com sucesso!";
        statusMessage.style.color = "green";
        console.log("✅ Configuração salva");
      } else {
        throw new Error(response.error || "Falha ao atualizar");
      }
    })
    .catch((err) => {
      console.error("❌ Erro ao atualizar configuração:", err);
      statusMessage.textContent = "❌ Erro ao atualizar: " + err.message;
      statusMessage.style.color = "red";
    });
});


// ============================================================
// EXEMPLO: COMO CARREGAR DADOS DE OUTRAS COLEÇÕES
// ============================================================

// Exemplo para carregar notícias do Firebase (via admin server)
async function carregarNoticias() {
  try {
    const response = await fetch(`${API_BASE}/noticias`);
    
    if (!response.ok) {
      throw new Error(`Erro ao buscar notícias: ${response.status}`);
    }
    
    const noticias = await response.json();
    console.log("✅ Notícias carregadas:", noticias);
    
    // Aqui você pode processar e exibir as notícias
    return noticias;
  } catch (error) {
    console.error("❌ Erro ao carregar notícias:", error);
    return [];
  }
}

// Exemplo para criar uma notícia
async function criarNoticia(titulo, conteudo, imagem = null) {
  try {
    const formData = new FormData();
    formData.append('titulo', titulo);
    formData.append('conteudo', conteudo);
    
    if (imagem) {
      formData.append('imagem', imagem);
    }

    const response = await fetch(`${API_BASE}/noticias`, {
      method: 'POST',
      body: formData
      // ❌ NÃO coloque headers: 'Content-Type' quando usar FormData
      // O navegador define automaticamente com boundary
    });

    if (!response.ok) {
      throw new Error(`Erro ao criar notícia: ${response.status}`);
    }

    const result = await response.json();
    console.log("✅ Notícia criada:", result);
    return result;
  } catch (error) {
    console.error("❌ Erro ao criar notícia:", error);
  }
}

// Exemplo para deletar uma notícia
async function deletarNoticia(id) {
  try {
    const response = await fetch(`${API_BASE}/noticias/${id}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error(`Erro ao deletar notícia: ${response.status}`);
    }

    const result = await response.json();
    console.log("✅ Notícia deletada:", result);
    return result;
  } catch (error) {
    console.error("❌ Erro ao deletar notícia:", error);
  }
}

// Exemplo para buscar pendentes (apenas admin)
async function buscarPendentes() {
  try {
    const response = await fetch(`${API_BASE}/pendentes`);

    if (response.status === 401) {
      console.error("❌ Você não tem permissão para acessar pendentes");
      return [];
    }

    if (!response.ok) {
      throw new Error(`Erro ao buscar pendentes: ${response.status}`);
    }

    const pendentes = await response.json();
    console.log("✅ Pendentes carregados:", pendentes);
    return pendentes;
  } catch (error) {
    console.error("❌ Erro ao buscar pendentes:", error);
    return [];
  }
}
