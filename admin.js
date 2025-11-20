// ====== CONFIG BACKEND (LOCAL x PRODUÇÃO) ======
const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

const API_BASE = isLocalHost
  ? "http://localhost:3000"
  : "https://radar-backend-omjv.onrender.com";

// ====== ELEMENTOS ======
const inputNome = document.querySelector("#usuario-nome");
const inputEmail = document.querySelector("#usuario-email");
const inputSenha = document.querySelector("#usuario-senha");
const selectPerfil = document.querySelector("#usuario-perfil");
const toggleAtivo = document.querySelector("#usuario-ativo");
const togglePodeLote = document.querySelector("#usuario-pode-lote");
const btnSalvar = document.querySelector("#btn-salvar-usuario");
const spanErro = document.querySelector("#msg-erro-usuario");

const tbodyUsuarios = document.querySelector("#lista-usuarios tbody");
const campoBusca = document.querySelector("#busca-usuarios");

let usuariosCache = [];
let usuarioEditandoId = null;

// ====== AUTENTICAÇÃO ======
function getToken() {
  const t =
    localStorage.getItem("radar_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    "";
  return t;
}

function requireAuth() {
  const token = getToken();
  if (!token) {
    window.location.href = "login.html";
  }
}

requireAuth();

// ====== HELPERS UI ======
function showErro(msg) {
  if (!spanErro) return;
  spanErro.textContent = msg || "";
  spanErro.style.visibility = msg ? "visible" : "hidden";
}

function limparFormulario() {
  usuarioEditandoId = null;
  inputNome.value = "";
  inputEmail.value = "";
  inputSenha.value = "";
  selectPerfil.value = "user"; // padrão
  toggleAtivo.checked = true;
  togglePodeLote.checked = true;
  showErro("");
}

// ====== CHAMADAS API ======
async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }

  const resp = await fetch(API_BASE + path, {
    ...options,
    headers,
  });

  let data = null;
  try {
    data = await resp.json();
  } catch (e) {
    data = null;
  }

  if (!resp.ok) {
    const msg = (data && data.error) || `Erro HTTP ${resp.status}`;
    throw new Error(msg);
  }

  return data;
}

// ====== LISTAR USUÁRIOS ======
async function carregarUsuarios() {
  try {
    showErro("");
    const data = await apiFetch("/admin/usuarios");
    usuariosCache = Array.isArray(data) ? data : [];
    renderizarUsuarios();
  } catch (err) {
    console.error("Erro ao carregar usuários:", err);
    showErro(err.message || "Erro ao carregar usuários.");
  }
}

function renderizarUsuarios() {
  if (!tbodyUsuarios) return;
  tbodyUsuarios.innerHTML = "";

  const filtro = (campoBusca?.value || "").toLowerCase().trim();

  const listaFiltrada = usuariosCache.filter((u) => {
    if (!filtro) return true;
    return (
      String(u.nome || "")
        .toLowerCase()
        .includes(filtro) ||
      String(u.email || "")
        .toLowerCase()
        .includes(filtro)
    );
  });

  if (!listaFiltrada.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "Nenhum usuário cadastrado.";
    tr.appendChild(td);
    tbodyUsuarios.appendChild(tr);
    return;
  }

  for (const u of listaFiltrada) {
    const tr = document.createElement("tr");

    const tdNome = document.createElement("td");
    tdNome.textContent = u.nome || "";
    tr.appendChild(tdNome);

    const tdEmail = document.createElement("td");
    tdEmail.textContent = u.email || "";
    tr.appendChild(tdEmail);

    const tdPerfil = document.createElement("td");
    tdPerfil.textContent = u.role === "admin" ? "Administrador" : "Usuário";
    tr.appendChild(tdPerfil);

    const tdLote = document.createElement("td");
    tdLote.textContent = u.pode_lote ? "Sim" : "Não";
    tr.appendChild(tdLote);

    const tdStatus = document.createElement("td");
    tdStatus.textContent = u.ativo ? "Ativo" : "Inativo";
    tr.appendChild(tdStatus);

    const tdAcoes = document.createElement("td");
    const btnEditar = document.createElement("button");
    btnEditar.textContent = "Editar";
    btnEditar.className = "btn-acao";
    btnEditar.onclick = () => preencherFormularioParaEdicao(u);

    const btnDesativar = document.createElement("button");
    btnDesativar.textContent = u.ativo ? "Desativar" : "Reativar";
    btnDesativar.className = "btn-acao";
    btnDesativar.onclick = () => toggleAtivoUsuario(u);

    tdAcoes.appendChild(btnEditar);
    tdAcoes.appendChild(btnDesativar);
    tr.appendChild(tdAcoes);

    tbodyUsuarios.appendChild(tr);
  }
}

// ====== FORM ======
function preencherFormularioParaEdicao(u) {
  usuarioEditandoId = u.id;
  inputNome.value = u.nome || "";
  inputEmail.value = u.email || "";
  inputSenha.value = "";
  selectPerfil.value = u.role === "admin" ? "admin" : "user";
  toggleAtivo.checked = !!u.ativo;
  togglePodeLote.checked = !!u.pode_lote;
  showErro("");
}

async function salvarUsuario(e) {
  e?.preventDefault?.();
  try {
    showErro("");

    const payload = {
      nome: inputNome.value.trim(),
      email: inputEmail.value.trim(),
      senha: inputSenha.value.trim(),
      perfil: selectPerfil.value,
      status: toggleAtivo.checked,
      podeLote: togglePodeLote.checked,
    };

    if (!payload.nome || !payload.email || !payload.senha) {
      showErro("Nome, e-mail e senha são obrigatórios.");
      return;
    }

    if (usuarioEditandoId) {
      await apiFetch(`/admin/usuarios/${usuarioEditandoId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      await apiFetch("/admin/usuarios", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }

    await carregarUsuarios();
    limparFormulario();
  } catch (err) {
    console.error("Erro ao salvar usuário:", err);
    showErro(err.message || "Erro inesperado ao salvar usuário.");
  }
}

async function toggleAtivoUsuario(u) {
  try {
    await apiFetch(`/admin/usuarios/${u.id}`, {
      method: "PUT",
      body: JSON.stringify({ status: !u.ativo }),
    });
    await carregarUsuarios();
  } catch (err) {
    console.error("Erro ao alterar status:", err);
    showErro(err.message || "Erro ao alterar status do usuário.");
  }
}

// ====== EVENTOS ======
if (btnSalvar) {
  btnSalvar.addEventListener("click", salvarUsuario);
}
if (campoBusca) {
  campoBusca.addEventListener("input", () => renderizarUsuarios());
}

// carrega tudo ao abrir a página
carregarUsuarios().catch((err) => {
  console.error(err);
  showErro("Erro ao carregar usuários.");
});
