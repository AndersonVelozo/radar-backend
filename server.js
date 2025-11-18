// ====== CONFIGURAÇÃO DO BACKEND (LOCAL x PRODUÇÃO) ======
const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

const BACKEND_BASE_URL = isLocalHost
  ? "http://localhost:3000"
  : "https://radar-backend-omjv.onrender.com";

// ---------- ELEMENTOS BÁSICOS ----------
const cnpjInput = document.getElementById("cnpj");
const rawText = document.getElementById("rawText");
const tableBody = document.querySelector("#resultTable tbody");

const openReceitaBtn = document.getElementById("openReceita");
const importExcelBtn = document.getElementById("importExcelBtn");
const fileInput = document.getElementById("fileInput");

const extractAddBtn = document.getElementById("extractAdd");
const clearTableBtn = document.getElementById("clearTable");
const exportExcelBtn = document.getElementById("exportExcel");
const retryErrorsBtn = document.getElementById("retryErrors");
const retrySelectedBtn = document.getElementById("retrySelected");
const historyBtn = document.getElementById("historyBtn");

const loteStatusEl = document.getElementById("loteStatus");
const loteProgressBar = document.getElementById("loteProgressBar");

// registros da sessão atual (tela)
let registros = [];

// ---------- HELPERS ----------
function normalizarCNPJ(v) {
  return (v || "").replace(/\D/g, "");
}

function removerLinhaVazia() {
  const noDataRow = tableBody.querySelector(".no-data-row");
  if (noDataRow) tableBody.removeChild(noDataRow);
}

function formatarDataBR(dataISO) {
  if (!dataISO) return "";
  // aceita Date, string yyyy-mm-dd, etc
  const d = new Date(dataISO);
  if (Number.isNaN(d.getTime())) return String(dataISO);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const ano = d.getFullYear();
  return `${dia}/${mes}/${ano}`;
}

// ---------- RENDERIZAÇÃO DA TABELA ----------
function criarLinhaDOM(registro) {
  const tr = document.createElement("tr");
  const sitUpper = (registro.situacao || "").toUpperCase();

  let classeSituacao = "neutro";

  if (/DEFERIDA/.test(sitUpper)) {
    classeSituacao = "aprovado";
  } else if (/DADOS INDISPON[ÍI]VEIS/.test(sitUpper)) {
    classeSituacao = "indisponivel";
  } else if (
    /INDEFERIDA|CANCELADA|SUSPENSA|ERRO|N[ÃA]O HABILITADA/.test(sitUpper)
  ) {
    classeSituacao = "negado";
  }

  tr.innerHTML = `
    <td>
      <input type="checkbox" class="select-cnpj" />
    </td>
    <td>${registro.dataConsultaBR || ""}</td>
    <td>${registro.cnpj || ""}</td>
    <td>${registro.contribuinte || ""}</td>
    <td>
      <span class="tag ${classeSituacao}">
        ${registro.situacao || ""}
      </span>
    </td>
    <td>${registro.dataSituacao || ""}</td>
    <td>${registro.submodalidade || ""}</td>
    <td>${registro.razaoSocial || ""}</td>
    <td>${registro.nomeFantasia || ""}</td>
    <td>${registro.municipio || ""}</td>
    <td>${registro.uf || ""}</td>
    <td>${registro.dataConstituicao || ""}</td>
    <td>${registro.regimeTributario || ""}</td>
    <td>${registro.dataOpcaoSimples || ""}</td>
    <td>${registro.capitalSocial || ""}</td>
  `;

  tableBody.appendChild(tr);
}

function adicionarLinhaTabela(dados) {
  removerLinhaVazia();

  const registro = {
    dataConsulta: dados.dataConsulta || null,
    dataConsultaBR: dados.dataConsultaBR || "",
    cnpj: dados.cnpj || "",
    contribuinte: dados.contribuinte || "",
    situacao: dados.situacao || "",
    dataSituacao: dados.dataSituacao || "",
    submodalidade: dados.submodalidade || "",
    razaoSocial: dados.razaoSocial || "",
    nomeFantasia: dados.nomeFantasia || "",
    municipio: dados.municipio || "",
    uf: dados.uf || "",
    dataConstituicao: dados.dataConstituicao || "",
    regimeTributario: dados.regimeTributario || "",
    dataOpcaoSimples: dados.dataOpcaoSimples || "",
    capitalSocial: dados.capitalSocial || "",
  };

  registros.push(registro);
  criarLinhaDOM(registro);
}

function renderizarTodos() {
  tableBody.innerHTML = `
    <tr class="no-data-row">
      <td colspan="15" class="no-data">Nenhum registro adicionado ainda</td>
    </tr>
  `;

  if (!registros.length) return;

  removerLinhaVazia();
  registros.forEach((r) => criarLinhaDOM(r));
}

// ---------- PROGRESSO DO LOTE ----------
function atualizarProgressoLote(processados, total) {
  if (!total || total <= 0) {
    loteStatusEl.textContent = "Nenhuma consulta em lote em andamento.";
    loteProgressBar.style.width = "0%";
    return;
  }

  const perc = Math.round((processados / total) * 100);
  loteStatusEl.textContent = `Consultas em lote: ${processados}/${total} (${perc}%)`;
  loteProgressBar.style.width = perc + "%";

  if (processados >= total) {
    loteStatusEl.textContent = `Consultas em lote concluídas: ${total}/${total} (100%)`;
  }
}

// ---------- MODAL GENÉRICO ----------
const infoModal = document.getElementById("infoModal");
const infoModalTitle = document.getElementById("infoModalTitle");
const infoModalMessage = document.getElementById("infoModalMessage");
const infoModalClose = document.getElementById("infoModalClose");

function showInfoModal(title, message) {
  infoModalTitle.textContent = title;
  infoModalMessage.textContent = message;
  infoModal.classList.remove("hidden");
}

infoModalClose.addEventListener("click", () => {
  infoModal.classList.add("hidden");
});

// ---------- MODAIS ESPECÍFICOS ----------
const confirmRetryOverlay = document.getElementById("confirmRetryOverlay");
const confirmRetryBtn = document.getElementById("confirmRetry");
const cancelRetryBtn = document.getElementById("cancelRetry");

const confirmImportOverlay = document.getElementById("confirmImportOverlay");
const confirmImportBtn = document.getElementById("confirmImport");
const cancelImportBtn = document.getElementById("cancelImport");
const confirmImportText = document.getElementById("confirmImportText");

const confirmClearOverlay = document.getElementById("confirmClearOverlay");
const confirmClearBtn = document.getElementById("confirmClear");
const cancelClearBtn = document.getElementById("cancelClear");

// ---------- BOTÃO: ABRIR RECEITA ----------
openReceitaBtn.addEventListener("click", () => {
  const url =
    "https://servicos.receita.fazenda.gov.br/servicos/radar/consultaSituacaoCpfCnpj.asp";
  window.open(url, "_blank");
});

// ---------- IMPORTAÇÃO DA PLANILHA (LOTE VIA API) ----------
importExcelBtn.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = async (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      const cnpjsRaw = rows
        .slice(1)
        .map((row) => normalizarCNPJ(String(row[0] || "")))
        .filter((c) => c.length > 0);

      const totalLidos = cnpjsRaw.length;

      if (!totalLidos) {
        showInfoModal(
          "Planilha sem CNPJs",
          "Não foi possível encontrar CNPJs na primeira coluna da planilha."
        );
        return;
      }

      loteStatusEl.textContent = `Lendo planilha: ${totalLidos} CNPJs encontrados. Filtrando duplicados...`;

      const vistos = new Set();
      const cnpjsUnicos = [];
      let removidos = 0;

      for (const c of cnpjsRaw) {
        if (!vistos.has(c)) {
          vistos.add(c);
          cnpjsUnicos.push(c);
        } else {
          removidos++;
        }
      }

      if (removidos > 0) {
        loteStatusEl.textContent = `Filtrando CNPJs: ${totalLidos} encontrados, removendo ${removidos} CNPJ(s) repetido(s)...`;
      } else {
        loteStatusEl.textContent = `Filtrando CNPJs: ${totalLidos} encontrados, nenhum duplicado para remover.`;
      }

      console.log(
        `CNPJs lidos: ${totalLidos} | Únicos: ${cnpjsUnicos.length} | Removidos: ${removidos}`
      );

      window.cnpjsParaImportar = cnpjsUnicos;

      confirmImportText.textContent = `Foram encontrados ${cnpjsUnicos.length} CNPJs únicos. Deseja iniciar a consulta em lote (via API)?`;
      confirmImportOverlay.classList.remove("hidden");
    } catch (err) {
      console.error(err);
      showInfoModal(
        "Erro ao ler planilha",
        "Ocorreu um erro ao ler a planilha. Verifique o arquivo e tente novamente."
      );
    } finally {
      fileInput.value = "";
    }
  };

  reader.readAsArrayBuffer(file);
});

// ----- confirmar/cancelar importação -----
cancelImportBtn.addEventListener("click", () => {
  confirmImportOverlay.classList.add("hidden");
});

confirmImportBtn.addEventListener("click", async () => {
  confirmImportOverlay.classList.add("hidden");
  await processarLoteCnpjs(window.cnpjsParaImportar || []);
});

// ---------- CONSULTA COMPLETA NO BACKEND ----------
async function consultarBackendCompleto(cnpj, { force = false } = {}) {
  const url = new URL(`${BACKEND_BASE_URL}/consulta-completa`);
  url.searchParams.set("cnpj", cnpj);
  if (force) url.searchParams.set("force", "1");

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(`Erro ao consultar backend: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  console.log("Resposta /consulta-completa para", cnpj, data);

  const dataConsultaBR = data.dataConsulta
    ? formatarDataBR(data.dataConsulta)
    : formatarDataBR(new Date());

  return {
    dataConsulta: data.dataConsulta || null,
    dataConsultaBR,
    cnpj,
    contribuinte: data.contribuinte || "",
    situacao: data.situacao || "",
    dataSituacao: data.dataSituacao || "",
    submodalidade: data.submodalidade || "",
    razaoSocial: data.razaoSocial || "",
    nomeFantasia: data.nomeFantasia || "",
    municipio: data.municipio || "",
    uf: data.uf || "",
    dataConstituicao: data.dataConstituicao || "",
    regimeTributario: data.regimeTributario || "",
    dataOpcaoSimples: data.dataOpcaoSimples || "",
    capitalSocial: data.capitalSocial || "",
  };
}

// ---------- PROCESSAR LOTE ----------
async function processarLoteCnpjs(cnpjs) {
  const total = cnpjs.length;
  let processados = 0;

  if (!total) {
    showInfoModal(
      "Nada para consultar",
      "Nenhum CNPJ foi encontrado para consulta em lote."
    );
    return;
  }

  atualizarProgressoLote(0, total);

  for (const cnpj of cnpjs) {
    try {
      const dados = await consultarBackendCompleto(cnpj);
      adicionarLinhaTabela(dados);
    } catch (err) {
      console.error("Erro inesperado no lote para", cnpj, err);
      adicionarLinhaTabela({
        dataConsulta: new Date(),
        dataConsultaBR: formatarDataBR(new Date()),
        cnpj,
        contribuinte: "(erro na consulta)",
        situacao: "ERRO",
        dataSituacao: "",
        submodalidade: "",
        razaoSocial: "",
        nomeFantasia: "",
        municipio: "",
        uf: "",
        dataConstituicao: "",
        regimeTributario: "",
        dataOpcaoSimples: "",
        capitalSocial: "",
      });
    } finally {
      processados++;
      atualizarProgressoLote(processados, total);
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
}

// ---------- EXTRATOR TEXTO (consulta unitária manual) ----------
function extrairDadosDoTexto(texto) {
  const t = texto.replace(/\r/g, "");

  const contribMatch = t.match(
    /Contribuinte:\s*(.+?)\s*Situa[cç][aã]o da Habilita[cç][aã]o:/s
  );
  const sitMatch = t.match(/Situa[cç][aã]o da Habilita[cç][aã]o:\s*([^\n\r]+)/);
  const dataMatch = t.match(/Data da Situa[cç][aã]o:\s*([^\n\r]+)/);
  const subMatch = t.match(/Submodalidade:\s*([^\n\r]+)/);

  let contribuinte = contribMatch ? contribMatch[1].trim() : "";
  let situacao = sitMatch ? sitMatch[1].trim() : "";
  let dataSituacao = dataMatch ? dataMatch[1].trim() : "";
  let submodalidade = subMatch ? subMatch[1].trim() : "";

  let ehNaoHabilitada = false;

  if (!situacao) {
    const naoHabMatch = t.match(
      /n[ãa]o habilitad[ao] a operar no Com[eé]rcio Exterior/i
    );
    if (naoHabMatch) {
      situacao = "NÃO HABILITADA";
      dataSituacao = "";
      submodalidade = "";
      ehNaoHabilitada = true;
    }
  }

  return {
    contribuinte,
    situacao,
    dataSituacao,
    submodalidade,
    ehNaoHabilitada,
  };
}

extractAddBtn.addEventListener("click", async () => {
  const cnpj = normalizarCNPJ(cnpjInput.value.trim());
  const texto = rawText.value.trim();

  if (!cnpj) {
    showInfoModal("Campo obrigatório", "Informe o CNPJ para continuar.");
    return;
  }
  if (!texto) {
    showInfoModal(
      "Texto não encontrado",
      "Cole o texto da página de resultado da Receita antes de extrair."
    );
    return;
  }

  const {
    contribuinte,
    situacao,
    dataSituacao,
    submodalidade,
    ehNaoHabilitada,
  } = extrairDadosDoTexto(texto);

  if (
    !ehNaoHabilitada &&
    (!contribuinte || !situacao || !dataSituacao || !submodalidade)
  ) {
    showInfoModal(
      "Campos incompletos",
      "Não foi possível encontrar todos os campos no texto colado. Confira se copiou a página inteira."
    );
    return;
  }

  try {
    const extras = await consultarBackendCompleto(cnpj);

    // sobrescreve com o que veio do texto RADAR (habilitação),
    // mantendo cadastro vindo do backend
    const dados = {
      ...extras,
      contribuinte,
      situacao,
      dataSituacao,
      submodalidade,
    };

    adicionarLinhaTabela(dados);
    rawText.value = "";
  } catch (err) {
    console.error("Erro na consulta unitária:", err);

    adicionarLinhaTabela({
      dataConsulta: new Date(),
      dataConsultaBR: formatarDataBR(new Date()),
      cnpj,
      contribuinte,
      situacao: situacao || "ERRO",
      dataSituacao,
      submodalidade,
      razaoSocial: "",
      nomeFantasia: "",
      municipio: "",
      uf: "",
      dataConstituicao: "",
      regimeTributario: "",
      dataOpcaoSimples: "",
      capitalSocial: "",
    });

    showInfoModal(
      "Erro na consulta",
      "Não foi possível obter os dados cadastrais pela API. Os dados do texto foram adicionados mesmo assim."
    );
  }
});

// ---------- RECONSULTAR ERROS (lógica antiga, mas usando /consulta-completa) ----------
async function reconsultarErros() {
  const temHabilitacao = (r) =>
    !!(
      (r.contribuinte && r.contribuinte.trim().length > 0) ||
      (r.dataSituacao && r.dataSituacao.trim().length > 0) ||
      (r.submodalidade && r.submodalidade.trim().length > 0)
    );

  const temCadastro = (r) =>
    !!(r.razaoSocial && r.razaoSocial.trim().length > 0);

  const isErroFlag = (r) => {
    const sit = (r.situacao || "").toUpperCase();
    return (
      sit === "ERRO" ||
      r.contribuinte === "(erro na consulta)" ||
      /DADOS INDISPON[ÍI]VEIS/.test(sit)
    );
  };

  const faltandoTudo = registros.filter(
    (r) => !temHabilitacao(r) && !temCadastro(r) && isErroFlag(r)
  );

  const faltandoRadar = registros.filter(
    (r) => !temHabilitacao(r) && temCadastro(r)
  );

  const faltandoReceita = registros.filter(
    (r) => temHabilitacao(r) && !temCadastro(r)
  );

  const total =
    faltandoTudo.length + faltandoRadar.length + faltandoReceita.length;

  if (!total) {
    showInfoModal(
      "Nada para reconsultar",
      "Não há registros com falha de habilitação ou de dados cadastrais para reconsultar."
    );
    return;
  }

  let processados = 0;
  atualizarProgressoLote(0, total);

  async function atualizarRegistro(reg) {
    try {
      const dados = await consultarBackendCompleto(reg.cnpj, { force: true });
      Object.assign(reg, dados);
    } catch (err) {
      console.error("Erro ao reconsultar CNPJ", reg.cnpj, err);
    } finally {
      processados++;
      atualizarProgressoLote(processados, total);
    }
  }

  for (const reg of [...faltandoTudo, ...faltandoRadar, ...faltandoReceita]) {
    await atualizarRegistro(reg);
  }

  renderizarTodos();
}

// ---------- RECONSULTAR APENAS SELECIONADOS ----------
async function reconsultarSelecionados() {
  const linhas = Array.from(tableBody.querySelectorAll("tr")).filter(
    (tr) => !tr.classList.contains("no-data-row")
  );

  const selecionados = [];

  linhas.forEach((tr, idx) => {
    const checkbox = tr.querySelector(".select-cnpj");
    if (checkbox && checkbox.checked) {
      const reg = registros[idx];
      if (reg) selecionados.push(reg);
    }
  });

  if (!selecionados.length) {
    showInfoModal(
      "Nenhum selecionado",
      "Selecione pelo menos um CNPJ na tabela para reconsultar."
    );
    return;
  }

  let processados = 0;
  const total = selecionados.length;
  atualizarProgressoLote(0, total);

  for (const reg of selecionados) {
    try {
      const dados = await consultarBackendCompleto(reg.cnpj, { force: true });
      Object.assign(reg, dados);
    } catch (err) {
      console.error("Erro ao reconsultar selecionado", reg.cnpj, err);
    } finally {
      processados++;
      atualizarProgressoLote(processados, total);
    }
  }

  renderizarTodos();
}

// ---------- BOTÕES DE MODAIS ----------
retryErrorsBtn.addEventListener("click", () => {
  confirmRetryOverlay.classList.remove("hidden");
});

cancelRetryBtn.addEventListener("click", () => {
  confirmRetryOverlay.classList.add("hidden");
});

confirmRetryBtn.addEventListener("click", () => {
  confirmRetryOverlay.classList.add("hidden");
  reconsultarErros();
});

// limpar tabela
clearTableBtn.addEventListener("click", () => {
  confirmClearOverlay.classList.remove("hidden");
});

cancelClearBtn.addEventListener("click", () => {
  confirmClearOverlay.classList.add("hidden");
});

confirmClearBtn.addEventListener("click", () => {
  registros = [];
  renderizarTodos();
  atualizarProgressoLote(0, 0);
  confirmClearOverlay.classList.add("hidden");
});

// ESC fecha modais
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    confirmClearOverlay.classList.add("hidden");
    confirmRetryOverlay.classList.add("hidden");
    confirmImportOverlay.classList.add("hidden");
    infoModal.classList.add("hidden");
  }
});

// ---------- EXPORTAR PARA EXCEL ----------
exportExcelBtn.addEventListener("click", () => {
  const rows = Array.from(tableBody.querySelectorAll("tr")).filter(
    (tr) => !tr.classList.contains("no-data-row")
  );

  if (!rows.length) {
    showInfoModal(
      "Nada para exportar",
      "Não há dados na tabela para exportar para o Excel."
    );
    return;
  }

  const data = [];
  data.push([
    "Data da Consulta",
    "CNPJ",
    "Contribuinte",
    "Situação da Habilitação",
    "Data da Situação",
    "Submodalidade",
    "Razão Social",
    "Nome Fantasia",
    "Município",
    "UF",
    "Data de Constituição",
    "Regime Tributário",
    "Data Opção Simples",
    "Capital Social",
  ]);

  rows.forEach((tr) => {
    const tds = tr.querySelectorAll("td");
    data.push([
      tds[1].innerText, // Data da Consulta
      tds[2].innerText, // CNPJ
      tds[3].innerText, // Contribuinte
      tds[4].innerText, // Situação
      tds[5].innerText, // Data Situação
      tds[6].innerText, // Submodalidade
      tds[7].innerText, // Razão Social
      tds[8].innerText, // Nome Fantasia
      tds[9].innerText, // Município
      tds[10].innerText, // UF
      tds[11].innerText, // Data Constituição
      tds[12].innerText, // Regime Tributário
      tds[13].innerText, // Data Opção Simples
      tds[14].innerText, // Capital Social  ✅ AGORA VAI
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Habilitações");

  const hojeISO = new Date().toISOString().slice(0, 10);
  let nomeArquivo = prompt(
    "Digite um nome para o arquivo Excel (sem extensão):",
    `habilitacoes_${hojeISO}`
  );

  if (!nomeArquivo || !nomeArquivo.trim()) {
    nomeArquivo = `habilitacoes_${hojeISO}`;
  }

  XLSX.writeFile(wb, `${nomeArquivo.trim()}.xlsx`);

  showInfoModal(
    "Exportação concluída",
    `Arquivo Excel gerado com sucesso: ${nomeArquivo.trim()}.xlsx`
  );
});

// ---------- HISTÓRICO (simples: por data ou intervalo) ----------
historyBtn.addEventListener("click", async () => {
  const tipo = prompt(
    "Digite 1 para histórico de um dia ou 2 para intervalo de datas:",
    "1"
  );

  if (!tipo) return;

  if (tipo === "1") {
    const data = prompt("Informe a data (YYYY-MM-DD):", "");
    if (!data) return;

    try {
      const resp = await fetch(
        `${BACKEND_BASE_URL}/historico?data=${encodeURIComponent(data)}`
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const linhas = await resp.json();

      if (!linhas.length) {
        showInfoModal(
          "Sem dados",
          "Não há registros para a data informada no histórico."
        );
        return;
      }

      exportarHistoricoExcel(linhas, `historico_${data}`);
    } catch (err) {
      console.error("Erro histórico (dia único):", err);
      showInfoModal(
        "Erro histórico",
        "Não foi possível carregar o histórico para a data informada."
      );
    }
  } else if (tipo === "2") {
    const from = prompt("Data inicial (YYYY-MM-DD):", "");
    const to = prompt("Data final (YYYY-MM-DD):", "");
    if (!from || !to) return;

    try {
      const url = `${BACKEND_BASE_URL}/historico?from=${encodeURIComponent(
        from
      )}&to=${encodeURIComponent(to)}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const linhas = await resp.json();

      if (!linhas.length) {
        showInfoModal("Sem dados", "Não há registros no intervalo informado.");
        return;
      }

      exportarHistoricoExcel(linhas, `historico_${from}_a_${to}`);
    } catch (err) {
      console.error("Erro histórico (intervalo):", err);
      showInfoModal(
        "Erro histórico",
        "Não foi possível carregar o histórico para o intervalo informado."
      );
    }
  }
});

function exportarHistoricoExcel(linhas, nomeBase) {
  const data = [];
  data.push([
    "Data da Consulta",
    "CNPJ",
    "Contribuinte",
    "Situação da Habilitação",
    "Data da Situação",
    "Submodalidade",
    "Razão Social",
    "Nome Fantasia",
    "Município",
    "UF",
    "Data de Constituição",
    "Regime Tributário",
    "Data Opção Simples",
    "Capital Social",
  ]);

  linhas.forEach((r) => {
    data.push([
      formatarDataBR(r.dataConsulta),
      r.cnpj,
      r.contribuinte,
      r.situacao,
      r.dataSituacao,
      r.submodalidade,
      r.razaoSocial,
      r.nomeFantasia,
      r.municipio,
      r.uf,
      r.dataConstituicao,
      r.regimeTributario,
      r.dataOpcaoSimples,
      r.capitalSocial,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Histórico");

  let nomeArquivo = prompt(
    "Nome do arquivo histórico (sem extensão):",
    nomeBase
  );
  if (!nomeArquivo || !nomeArquivo.trim()) {
    nomeArquivo = nomeBase;
  }

  XLSX.writeFile(wb, `${nomeArquivo.trim()}.xlsx`);

  showInfoModal(
    "Histórico exportado",
    `Arquivo Excel gerado com sucesso: ${nomeArquivo.trim()}.xlsx`
  );
}

// ---------- BOTÃO: RECONSULTAR SELECIONADOS ----------
retrySelectedBtn.addEventListener("click", () => {
  reconsultarSelecionados();
});

// ---------- AO CARREGAR A PÁGINA ----------
window.addEventListener("DOMContentLoaded", () => {
  registros = [];
  renderizarTodos();
  atualizarProgressoLote(0, 0);
});
