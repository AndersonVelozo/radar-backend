// ====== CONFIGURAÇÃO DO BACKEND (LOCAL x PRODUÇÃO) ======
const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

const BACKEND_BASE_URL = isLocalHost
  ? "http://localhost:3000" // quando estiver testando local
  : "https://radar-backend-omjv.onrender.com"; // URL do Render em produção

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

const loteStatusEl = document.getElementById("loteStatus");
const loteProgressBar = document.getElementById("loteProgressBar");

// ---------- LOCALSTORAGE ----------
const STORAGE_KEY = "radar_registros_habilitacao";

// agora o registro guarda também os campos cadastrais
// e Município + UF separados
// { cnpj, contribuinte, situacao, dataSituacao, submodalidade,
//   razaoSocial, nomeFantasia, municipio, uf,
//   dataConstituicao, regimeTributario, capitalSocial }
let registros = [];

function salvarNoLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(registros));
  } catch (e) {
    console.error("Erro ao salvar no localStorage:", e);
  }
}

function carregarDoLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.error("Erro ao carregar do localStorage:", e);
    return [];
  }
}

function normalizarCNPJ(v) {
  return v.replace(/\D/g, "");
}

function removerLinhaVazia() {
  const noDataRow = tableBody.querySelector(".no-data-row");
  if (noDataRow) tableBody.removeChild(noDataRow);
}

// ---------- RENDERIZAÇÃO DA TABELA ----------
function criarLinhaDOM(registro) {
  const tr = document.createElement("tr");
  const sitUpper = (registro.situacao || "").toUpperCase();

  tr.innerHTML = `
  <td>${registro.cnpj || ""}</td>
  <td>${registro.contribuinte || ""}</td>
  <td>
    <span class="tag ${
      /INDEFERIDA|CANCELADA|SUSPENSA|ERRO|N[ÃA]O HABILITADA/.test(sitUpper)
        ? "negado"
        : ""
    }">
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
    <td>${registro.capitalSocial || ""}</td>
  `;

  tableBody.appendChild(tr);
}

function adicionarLinhaTabela(
  cnpj,
  contribuinte,
  situacao,
  dataSituacao,
  submodalidade,
  razaoSocial,
  nomeFantasia,
  municipio,
  uf,
  dataConstituicao,
  regimeTributario,
  capitalSocial
) {
  removerLinhaVazia();

  const registro = {
    cnpj: cnpj || "",
    contribuinte: contribuinte || "",
    situacao: situacao || "",
    dataSituacao: dataSituacao || "",
    submodalidade: submodalidade || "",
    razaoSocial: razaoSocial || "",
    nomeFantasia: nomeFantasia || "",
    municipio: municipio || "",
    uf: uf || "",
    dataConstituicao: dataConstituicao || "",
    regimeTributario: regimeTributario || "",
    capitalSocial: capitalSocial || "",
  };

  registros.push(registro);
  criarLinhaDOM(registro);
  salvarNoLocalStorage();
}

function renderizarTodos() {
  tableBody.innerHTML = `
    <tr class="no-data-row">
      <td colspan="12" class="no-data">Nenhum registro adicionado ainda</td>
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

      const cnpjs = rows
        .slice(1)
        .map((row) => normalizarCNPJ(String(row[0] || "")))
        .filter((c) => c.length > 0);

      if (!cnpjs.length) {
        alert(
          "Não foi possível encontrar CNPJs na primeira coluna da planilha."
        );
        return;
      }

      if (
        !confirm(
          `Foram encontrados ${cnpjs.length} CNPJs. Deseja iniciar a consulta em lote (via API)?`
        )
      ) {
        return;
      }

      await processarLoteCnpjs(cnpjs);
    } catch (err) {
      console.error(err);
      alert(
        "Ocorreu um erro ao ler a planilha. Verifique o arquivo e tente novamente."
      );
    } finally {
      fileInput.value = "";
    }
  };

  reader.readAsArrayBuffer(file);
});

// ---------- CONSULTAS VIA BACKEND ----------

// RADAR
async function consultarRadarPorCnpj(cnpj) {
  const resp = await fetch(
    `${BACKEND_BASE_URL}/consulta-radar?cnpj=${encodeURIComponent(cnpj)}`
  );

  if (!resp.ok) {
    throw new Error("Erro ao consultar backend (RADAR)");
  }

  const data = await resp.json();
  console.log("Resposta RADAR backend para", cnpj, data);

  return data; // { contribuinte, situacao, dataSituacao, submodalidade }
}

// --------- ReceitaWS – backend já devolve campos prontos (com retry) ---------
// --------- ReceitaWS – backend já devolve campos prontos (com retry) ---------
async function consultarReceitaWsComRetry(cnpj, maxTentativas = 5) {
  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      const resp = await fetch(
        `${BACKEND_BASE_URL}/consulta-receitaws?cnpj=${encodeURIComponent(
          cnpj
        )}`
      );

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const dados = await resp.json();
      console.log(
        `ReceitaWS OK (tentativa ${tentativa}/${maxTentativas}) para`,
        cnpj,
        dados
      );

      // Validação mínima: se nem razão social vier, considero falha
      if (!dados || !dados.razaoSocial) {
        throw new Error("Resposta da ReceitaWS incompleta");
      }

      return dados; // sucesso
    } catch (e) {
      ultimoErro = e;
      console.warn(
        `Falha ReceitaWS (tentativa ${tentativa}/${maxTentativas}) para ${cnpj}:`,
        e
      );

      // Se ainda tem tentativas, espera um pouco antes de tentar de novo
      if (tentativa < maxTentativas) {
        // backoff simples: 1500ms, depois 3000ms, 4500ms, 6000ms, 7500ms...
        const delayMs = 1500 * tentativa;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  console.error(
    `Todas as tentativas da ReceitaWS falharam para ${cnpj}:`,
    ultimoErro
  );
  return null; // para ser tratado no processarLoteCnpjs
}

// Versão simples que reaproveita o retry (usada em reconsultarErros e outros pontos)
async function consultarReceitaWs(cnpj) {
  return consultarReceitaWsComRetry(cnpj);
}

// ---------- PROCESSAR LOTE ----------
async function processarLoteCnpjs(cnpjs) {
  const total = cnpjs.length;
  let processados = 0;

  atualizarProgressoLote(0, total);

  for (const cnpj of cnpjs) {
    let radar = null;
    let receita = null;

    try {
      // --- RADAR ---
      try {
        radar = await consultarRadarPorCnpj(cnpj);
        console.log("RADAR lote OK para", cnpj, radar);
      } catch (e) {
        console.error("Falha RADAR no lote para", cnpj, e);
      }

      // --- ReceitaWS (com retry) ---
      receita = await consultarReceitaWsComRetry(cnpj);
      if (receita) {
        console.log("ReceitaWS lote OK para", cnpj, receita);
      } else {
        console.warn(
          "ReceitaWS falhou mesmo após múltiplas tentativas para",
          cnpj
        );
      }

      // ------- MONTAR CAMPOS DE CADASTRO (Receita) -------
      let razaoSocial = "";
      let nomeFantasiaFront = "";
      let municipio = "";
      let uf = "";
      let dataConstituicao = "";
      let regimeTributario = "";
      let capitalSocial = "";

      if (receita) {
        razaoSocial = receita.razaoSocial || "";
        nomeFantasiaFront =
          receita.nomeFantasia && receita.nomeFantasia.trim().length > 0
            ? receita.nomeFantasia.trim()
            : "Sem nome fantasia";
        municipio = receita.municipio || "";
        uf = receita.uf || "";
        dataConstituicao = receita.dataConstituicao || "";
        regimeTributario = receita.regimeTributario || "";
        capitalSocial = receita.capitalSocial || "";
      }

      // ------- MONTAR CAMPOS DE HABILITAÇÃO (RADAR) -------
      let contribuinte = "";
      let situacao = "";
      let dataSituacao = "";
      let submodalidade = "";

      if (radar) {
        contribuinte = radar.contribuinte || "";
        situacao = radar.situacao || "";
        dataSituacao = radar.dataSituacao || "";
        submodalidade = radar.submodalidade || "";
      }

      // ------- CASO ESPECIAL: NÃO HABILITADA A OPERAR -------
      // Se o RADAR respondeu (radar != null), mas não trouxe NENHUM campo preenchido,
      // e a ReceitaWS trouxe os dados cadastrais, consideramos "não habilitada a operar".
      const nenhumCampoRadarPreenchido =
        !contribuinte && !situacao && !dataSituacao && !submodalidade;

      if (radar && nenhumCampoRadarPreenchido && receita) {
        situacao = "NÃO HABILITADA A OPERAR";
      }

      // ------- SE ALGUMA COISA DEU CERTO, NÃO É ERRO -------
      if (radar || receita) {
        adicionarLinhaTabela(
          cnpj,
          contribuinte,
          situacao,
          dataSituacao,
          submodalidade,
          razaoSocial,
          nomeFantasiaFront,
          municipio,
          uf,
          dataConstituicao,
          regimeTributario,
          capitalSocial
        );
      } else {
        // Nenhuma API respondeu -> aqui sim marcado como ERRO
        adicionarLinhaTabela(
          cnpj,
          "(erro na consulta)",
          "ERRO",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          ""
        );
      }
    } catch (err) {
      console.error("Erro inesperado no lote para", cnpj, err);
      // fallback: marca como erro
      adicionarLinhaTabela(
        cnpj,
        "(erro na consulta)",
        "ERRO",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
      );
    } finally {
      processados++;
      atualizarProgressoLote(processados, total);

      // Pequeno delay para não estourar limite da API (ajuste se quiser)
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// ---------- CONSULTA UNITÁRIA (COLANDO O TEXTO RADAR) ----------
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

  // --- NOVO LAYOUT: "não habilitada a operar no Comércio Exterior" ---
  if (!situacao) {
    const naoHabMatch = t.match(
      /n[ãa]o habilitad[ao] a operar no Com[eé]rcio Exterior/i
    );
    if (naoHabMatch) {
      situacao = "NÃO HABILITADA A OPERAR";
      // nesses casos a página realmente não mostra Data da Situação nem Submodalidade
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
    alert("Informe o CNPJ.");
    return;
  }
  if (!texto) {
    alert("Cole o texto da página de resultado da Receita antes de extrair.");
    return;
  }

  const {
    contribuinte,
    situacao,
    dataSituacao,
    submodalidade,
    ehNaoHabilitada,
  } = extrairDadosDoTexto(texto);

  // Caso normal: exige todos os campos
  if (
    !ehNaoHabilitada &&
    (!contribuinte || !situacao || !dataSituacao || !submodalidade)
  ) {
    alert(
      "Não foi possível encontrar todos os campos no texto colado. Confira se copiou a página inteira."
    );
    return;
  }

  const extras = await consultarReceitaWsComRetry(cnpj);

  let razaoSocial = "";
  let nomeFantasiaFront = "";
  let municipio = "";
  let uf = "";
  let dataConstituicao = "";
  let regimeTributario = "";
  let capitalSocial = "";

  if (!extras) {
    alert(
      "Não foi possível obter os dados cadastrais pela ReceitaWS mesmo após várias tentativas.\n" +
        "Os dados de habilitação do RADAR foram adicionados, mas os campos cadastrais ficarão vazios."
    );
  } else {
    razaoSocial = extras.razaoSocial || "";
    nomeFantasiaFront =
      extras.nomeFantasia && extras.nomeFantasia.trim().length > 0
        ? extras.nomeFantasia.trim()
        : "Sem nome fantasia";
    municipio = extras.municipio || "";
    uf = extras.uf || "";
    dataConstituicao = extras.dataConstituicao || "";
    regimeTributario = extras.regimeTributario || "";
    capitalSocial = extras.capitalSocial || "";
  }

  adicionarLinhaTabela(
    cnpj,
    contribuinte,
    situacao,
    dataSituacao,
    submodalidade,
    razaoSocial,
    nomeFantasiaFront,
    municipio,
    uf,
    dataConstituicao,
    regimeTributario,
    capitalSocial
  );

  rawText.value = "";
});

// ---------- RECONSULTAR ERROS ----------
async function reconsultarErros() {
  // Helpers
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
    return sit === "ERRO" || r.contribuinte === "(erro na consulta)";
  };

  // 1) Sem habilitação E sem cadastro -> erro "hard" -> reconsulta RADAR + Receita
  const faltandoTudo = registros.filter(
    (r) => !temHabilitacao(r) && !temCadastro(r) && isErroFlag(r)
  );

  // 2) Sem habilitação, MAS com cadastro -> só RADAR (Infosimples)
  const faltandoRadar = registros.filter(
    (r) => !temHabilitacao(r) && temCadastro(r)
  );

  // 3) Com habilitação, MAS sem cadastro -> só ReceitaWS
  const faltandoReceita = registros.filter(
    (r) => temHabilitacao(r) && !temCadastro(r)
  );

  const total =
    faltandoTudo.length + faltandoRadar.length + faltandoReceita.length;

  if (!total) {
    alert(
      "Não há registros com falha de habilitação ou de dados cadastrais para reconsultar."
    );
    return;
  }

  if (
    !confirm(
      `Serão reconsultados ${total} registros:\n` +
        `- ${faltandoTudo.length} sem habilitação e sem cadastro (RADAR + Receita)\n` +
        `- ${faltandoRadar.length} com cadastro mas sem habilitação (somente RADAR)\n` +
        `- ${faltandoReceita.length} com habilitação mas sem cadastro (somente Receita)`
    )
  ) {
    return;
  }

  let processados = 0;
  atualizarProgressoLote(0, total);

  // --- 1) Reconsultar RADAR + Receita (faltandoTudo) ---
  for (const reg of faltandoTudo) {
    try {
      let radar = null;
      let receita = null;

      // RADAR
      try {
        radar = await consultarRadarPorCnpj(reg.cnpj);
        console.log("RADAR (reconsulta ambos) OK para", reg.cnpj, radar);
      } catch (e) {
        console.error("Falha RADAR (reconsulta ambos) para", reg.cnpj, e);
      }

      // Receita (com retry)
      try {
        receita = await consultarReceitaWsComRetry(reg.cnpj);
        if (receita) {
          console.log(
            "ReceitaWS (reconsulta ambos) OK para",
            reg.cnpj,
            receita
          );
        } else {
          console.warn(
            "ReceitaWS (reconsulta ambos) falhou mesmo com retry para",
            reg.cnpj
          );
        }
      } catch (e) {
        console.error("Falha ReceitaWS (reconsulta ambos) para", reg.cnpj, e);
      }

      // Atualiza habilitação se RADAR respondeu
      if (radar) {
        reg.contribuinte = radar.contribuinte || "";
        reg.situacao = radar.situacao || "";
        reg.dataSituacao = radar.dataSituacao || "";
        reg.submodalidade = radar.submodalidade || "";
      }

      // Atualiza cadastro se Receita respondeu
      if (receita) {
        const nomeFantasiaFront =
          receita.nomeFantasia && receita.nomeFantasia.trim().length > 0
            ? receita.nomeFantasia.trim()
            : "Sem nome fantasia";

        reg.razaoSocial = receita.razaoSocial || "";
        reg.nomeFantasia = nomeFantasiaFront;
        reg.municipio = receita.municipio || "";
        reg.uf = receita.uf || "";
        reg.dataConstituicao = receita.dataConstituicao || "";
        reg.regimeTributario = receita.regimeTributario || "";
        reg.capitalSocial = receita.capitalSocial || "";
      }

      // Se RADAR respondeu, deixa de ser ERRO
      if (radar && isErroFlag(reg)) {
        reg.situacao = radar.situacao || "";
      }
    } catch (err) {
      console.error(
        "Erro inesperado ao reconsultar (ambos) CNPJ",
        reg.cnpj,
        err
      );
    } finally {
      processados++;
      atualizarProgressoLote(processados, total);
    }
  }

  // --- 2) Reconsultar apenas RADAR (faltandoRadar) ---
  for (const reg of faltandoRadar) {
    try {
      let radar = null;

      try {
        radar = await consultarRadarPorCnpj(reg.cnpj);
        console.log("RADAR (reconsulta só RADAR) OK para", reg.cnpj, radar);
      } catch (e) {
        console.error("Falha RADAR (reconsulta só RADAR) para", reg.cnpj, e);
      }

      if (radar) {
        reg.contribuinte = radar.contribuinte || "";
        reg.situacao = radar.situacao || reg.situacao || "";
        reg.dataSituacao = radar.dataSituacao || "";
        reg.submodalidade = radar.submodalidade || "";
      }
    } catch (err) {
      console.error(
        "Erro inesperado ao reconsultar só RADAR para CNPJ",
        reg.cnpj,
        err
      );
    } finally {
      processados++;
      atualizarProgressoLote(processados, total);
    }
  }

  // --- 3) Reconsultar apenas Receita (faltandoReceita) ---
  for (const reg of faltandoReceita) {
    try {
      const receita = await consultarReceitaWsComRetry(reg.cnpj);

      if (receita) {
        console.log(
          "ReceitaWS (reconsulta só cadastro) OK para",
          reg.cnpj,
          receita
        );

        const nomeFantasiaFront =
          receita.nomeFantasia && receita.nomeFantasia.trim().length > 0
            ? receita.nomeFantasia.trim()
            : "Sem nome fantasia";

        reg.razaoSocial = receita.razaoSocial || "";
        reg.nomeFantasia = nomeFantasiaFront;
        reg.municipio = receita.municipio || "";
        reg.uf = receita.uf || "";
        reg.dataConstituicao = receita.dataConstituicao || "";
        reg.regimeTributario = receita.regimeTributario || "";
        reg.capitalSocial = receita.capitalSocial || "";
      } else {
        console.warn(
          "ReceitaWS (reconsulta só cadastro) falhou para",
          reg.cnpj
        );
      }
    } catch (err) {
      console.error(
        "Erro inesperado ao reconsultar só Receita para CNPJ",
        reg.cnpj,
        err
      );
    } finally {
      processados++;
      atualizarProgressoLote(processados, total);
    }
  }

  salvarNoLocalStorage();
  renderizarTodos();
}

// ---------- MODAL BONITO PARA RECONSULTAR ERROS ----------
const confirmRetryOverlay = document.getElementById("confirmRetryOverlay");
const confirmRetryBtn = document.getElementById("confirmRetry");
const cancelRetryBtn = document.getElementById("cancelRetry");

// abrir modal ao clicar no botão
retryErrorsBtn.addEventListener("click", () => {
  confirmRetryOverlay.classList.remove("hidden");
});

// cancelar
cancelRetryBtn.addEventListener("click", () => {
  confirmRetryOverlay.classList.add("hidden");
});

// confirmar -> chama a função real
confirmRetryBtn.addEventListener("click", () => {
  confirmRetryOverlay.classList.add("hidden");
  reconsultarErros(); // chamada real
});

// fechar com ESC
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    confirmRetryOverlay.classList.add("hidden");
  }
});

// ---------- LIMPAR TABELA (COM MODAL BONITO) ----------
const confirmClearOverlay = document.getElementById("confirmClearOverlay");
const confirmClearBtn = document.getElementById("confirmClear");
const cancelClearBtn = document.getElementById("cancelClear");

// só abre o modal, NÃO limpa nada aqui
clearTableBtn.addEventListener("click", () => {
  console.log("Cliquei em limpar -> abrindo modal");
  confirmClearOverlay.classList.remove("hidden");
});

// cancelar -> fecha o modal
cancelClearBtn.addEventListener("click", () => {
  confirmClearOverlay.classList.add("hidden");
});

// confirmar -> limpa tabela + localStorage
confirmClearBtn.addEventListener("click", () => {
  console.log("Confirmado: limpando tabela e localStorage");
  registros = [];
  salvarNoLocalStorage();
  renderizarTodos();
  atualizarProgressoLote(0, 0);
  confirmClearOverlay.classList.add("hidden");
});

// (opcional) fechar com ESC
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    confirmClearOverlay.classList.add("hidden");
  }
});

// ---------- EXPORTAR PARA EXCEL ----------
exportExcelBtn.addEventListener("click", () => {
  const rows = Array.from(tableBody.querySelectorAll("tr")).filter(
    (tr) => !tr.classList.contains("no-data-row")
  );

  if (!rows.length) {
    alert("Não há dados para exportar.");
    return;
  }

  const data = [];
  data.push([
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
    "Capital Social",
  ]);

  rows.forEach((tr) => {
    const tds = tr.querySelectorAll("td");
    data.push([
      tds[0].innerText,
      tds[1].innerText,
      tds[2].innerText,
      tds[3].innerText,
      tds[4].innerText,
      tds[5].innerText,
      tds[6].innerText,
      tds[7].innerText,
      tds[8].innerText,
      tds[9].innerText,
      tds[10].innerText,
      tds[11].innerText,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Habilitações");

  XLSX.writeFile(wb, "habilitacoes_comercio_exterior.xlsx");
});

// ---------- CARREGAR DADOS AO ABRIR A PÁGINA ----------
window.addEventListener("DOMContentLoaded", () => {
  registros = carregarDoLocalStorage();
  renderizarTodos();
  atualizarProgressoLote(0, 0);
});
