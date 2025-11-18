// backend.js (Node/Express + Postgres + Cache 90 dias)
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch"); // versão 2 (CommonJS)
const { Pool } = require("pg");

const app = express();

// ========== CONFIG GERAL ==========
const PORT = process.env.PORT || 3000;
const INFOSIMPLES_TOKEN = process.env.API_TOKEN;
const URL_RADAR = process.env.URL_RADAR;
const CACHE_DIAS = Number(process.env.CACHE_DIAS || 90);

// ========== POSTGRES ==========
const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
});

// cria tabela se não existir
async function initDb() {
  const sql = `
    CREATE TABLE IF NOT EXISTS consultas_radar (
      id                BIGSERIAL PRIMARY KEY,
      cnpj              VARCHAR(14) NOT NULL,
      data_consulta     DATE        NOT NULL,
      contribuinte      TEXT,
      situacao          TEXT,
      data_situacao     TEXT,
      submodalidade     TEXT,
      razao_social      TEXT,
      nome_fantasia     TEXT,
      municipio         TEXT,
      uf                VARCHAR(2),
      data_constituicao TEXT,
      regime_tributario TEXT,
      data_opcao_simples TEXT,
      capital_social    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_consultas_radar_cnpj_data
      ON consultas_radar (cnpj, data_consulta DESC);
  `;
  await pool.query(sql);
  console.log("✔ Tabela consultas_radar verificada/criada.");
}

// busca consulta recente (dentro do CACHE_DIAS)
async function getConsultaRecente(cnpjLimpo) {
  const sql = `
    SELECT *
    FROM consultas_radar
    WHERE cnpj = $1
      AND data_consulta >= CURRENT_DATE - INTERVAL '${CACHE_DIAS} days'
    ORDER BY data_consulta DESC
    LIMIT 1;
  `;
  const { rows } = await pool.query(sql, [cnpjLimpo]);
  return rows[0] || null;
}

// grava nova consulta
async function salvarConsulta(cnpjLimpo, dados) {
  const sql = `
    INSERT INTO consultas_radar (
      cnpj,
      data_consulta,
      contribuinte,
      situacao,
      data_situacao,
      submodalidade,
      razao_social,
      nome_fantasia,
      municipio,
      uf,
      data_constituicao,
      regime_tributario,
      data_opcao_simples,
      capital_social
    ) VALUES (
      $1, CURRENT_DATE,
      $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
    )
    RETURNING *;
  `;
  const params = [
    cnpjLimpo,
    dados.contribuinte || null,
    dados.situacao || null,
    dados.dataSituacao || null,
    dados.submodalidade || null,
    dados.razaoSocial || null,
    dados.nomeFantasia || null,
    dados.municipio || null,
    dados.uf || null,
    dados.dataConstituicao || null,
    dados.regimeTributario || null,
    dados.dataOpcaoSimples || null,
    dados.capitalSocial || null,
  ];

  const { rows } = await pool.query(sql, params);
  return rows[0];
}

// apaga tudo que tiver mais de 90 dias
async function limparConsultasAntigas() {
  const sql = `
    DELETE FROM consultas_radar
    WHERE data_consulta < CURRENT_DATE - INTERVAL '${CACHE_DIAS} days';
  `;
  const { rowCount } = await pool.query(sql);
  if (rowCount > 0) {
    console.log(`🧹 Limpeza: ${rowCount} registro(s) antigo(s) removido(s).`);
  }
}

// ========== CORS ==========
app.use(
  cors({
    origin: [
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "https://andersonvelozo.github.io",
    ],
  })
);

// só pra testar rápido no navegador
app.get("/", (req, res) => {
  res.json({ ok: true, msg: "Backend RADAR/ReceitaWS rodando" });
});

// ========== HELPERS GERAIS ==========
function normalizarCNPJ(v) {
  return (v || "").replace(/\D/g, "");
}

function formatarCapitalSocial(valorBruto) {
  if (!valorBruto) return "";
  const num = Number(String(valorBruto).replace(",", "."));
  if (!isNaN(num)) {
    return (
      "R$ " +
      num.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  return `R$ ${valorBruto}`;
}

// ================= RECEITAWS (APENAS DADOS) =================
async function consultaReceitaWsAPI(cnpjLimpo) {
  const url = `https://www.receitaws.com.br/v1/CNPJ/${cnpjLimpo}`;
  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(`Erro na ReceitaWS: HTTP ${resp.status}`);
  }

  const d = await resp.json();

  if (d.status && d.status !== "OK") {
    throw new Error(d.message || "Erro na ReceitaWS (status != OK)");
  }

  const razaoSocial = d.nome || "";
  const nomeFantasia = d.fantasia || "";

  const municipio = d.municipio || "";
  const uf = d.uf || "";

  const dataConstituicao = d.abertura || "";

  // *** Regime + data opção simples SEPARADOS ***
  let regimeTributario = "";
  let dataOpcaoSimples = "N/A";

  if (d.simples && typeof d.simples.optante === "boolean") {
    if (d.simples.optante) {
      regimeTributario = "Simples Nacional";
      if (d.simples.data_opcao) {
        dataOpcaoSimples = d.simples.data_opcao;
      } else {
        dataOpcaoSimples = "";
      }
    } else {
      regimeTributario = "Regime Normal (Lucro Real ou Presumido)";
      dataOpcaoSimples = "N/A";
    }
  }

  const capitalSocial = formatarCapitalSocial(d.capital_social);

  return {
    razaoSocial,
    nomeFantasia,
    municipio,
    uf,
    dataConstituicao,
    regimeTributario,
    dataOpcaoSimples,
    capitalSocial,
  };
}

// ================= RADAR / INFOSIMPLES (APENAS DADOS) =================
async function consultaRadarAPI(cnpjLimpo) {
  if (!INFOSIMPLES_TOKEN || !URL_RADAR) {
    throw new Error(
      "Backend não configurado: defina API_TOKEN e URL_RADAR no arquivo .env"
    );
  }

  const params = new URLSearchParams();
  params.append("cnpj", cnpjLimpo);
  params.append("token", INFOSIMPLES_TOKEN);
  params.append("timeout", "300");

  const resp = await fetch(URL_RADAR, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    timeout: 300000,
  });

  if (!resp.ok) {
    throw new Error(`Erro na Infosimples RADAR: HTTP ${resp.status}`);
  }

  const json = await resp.json();
  const rawData = json && json.data;
  let dados = null;

  if (Array.isArray(rawData)) {
    dados = rawData[0] || null;
  } else if (rawData && typeof rawData === "object") {
    dados = rawData[0] || rawData["0"] || rawData;
  }

  let contribuinte = "";
  let situacao = "";
  let dataSituacao = "";
  let submodalidade = "";

  if (dados) {
    contribuinte =
      dados.contribuinte || dados.nome_contribuinte || dados.contr_nome || "";
    situacao =
      dados.situacao || dados.situacao_habilitacao || dados.status || "";
    dataSituacao =
      dados.data_situacao ||
      dados.situacao_data ||
      dados.data_situacao_habilitacao ||
      "";
    submodalidade =
      dados.submodalidade ||
      dados.submodalidade_texto ||
      dados.submodalidade_descricao ||
      "";
  }

  const nenhumCampoRadarPreenchido =
    !contribuinte && !situacao && !dataSituacao && !submodalidade;

  if (dados && nenhumCampoRadarPreenchido) {
    situacao = "DADOS INDISPONÍVEIS (RADAR)";
  }

  return {
    contribuinte,
    situacao,
    dataSituacao,
    submodalidade,
  };
}

// ================= ENDPOINTS ORIGINAIS (opcionalmente mantidos) =================

app.get("/consulta-receitaws", async (req, res) => {
  try {
    const cnpj = normalizarCNPJ(req.query.cnpj);
    if (!cnpj) {
      return res.status(400).json({ error: "CNPJ obrigatório" });
    }
    const dados = await consultaReceitaWsAPI(cnpj);
    return res.json(dados);
  } catch (err) {
    console.error("Erro /consulta-receitaws:", err);
    return res.status(500).json({ error: err.message || "Erro ReceitaWS" });
  }
});

app.get("/consulta-radar", async (req, res) => {
  try {
    const cnpj = normalizarCNPJ(req.query.cnpj);
    if (!cnpj) {
      return res.status(400).json({ error: "CNPJ obrigatório" });
    }
    const dados = await consultaRadarAPI(cnpj);
    return res.json(dados);
  } catch (err) {
    console.error("Erro /consulta-radar:", err);
    return res.status(500).json({ error: err.message || "Erro RADAR" });
  }
});

// ================= NOVO ENDPOINT UNIFICADO + CACHE POSTGRES =================
/**
 * GET /consulta-completa?cnpj=...&force=1
 * - Verifica cache Postgres (últimos CACHE_DIAS)
 * - Se tiver e NÃO tiver force=1 -> devolve do banco
 * - Se não tiver ou force=1 -> chama RADAR + ReceitaWS, salva no banco e devolve
 * - Sempre devolve dataConsulta (dia de hoje ou do registro do banco)
 */
app.get("/consulta-completa", async (req, res) => {
  try {
    const cnpj = normalizarCNPJ(req.query.cnpj);
    const force = req.query.force === "1" || req.query.force === "true";

    if (!cnpj) {
      return res.status(400).json({ error: "CNPJ obrigatório" });
    }

    // limpa registros antigos (90 dias)
    await limparConsultasAntigas();

    if (!force) {
      const cache = await getConsultaRecente(cnpj);
      if (cache) {
        return res.json({
          fromCache: true,
          dataConsulta: cache.data_consulta,
          cnpj,
          contribuinte: cache.contribuinte || "",
          situacao: cache.situacao || "",
          dataSituacao: cache.data_situacao || "",
          submodalidade: cache.submodalidade || "",
          razaoSocial: cache.razao_social || "",
          nomeFantasia: cache.nome_fantasia || "",
          municipio: cache.municipio || "",
          uf: cache.uf || "",
          dataConstituicao: cache.data_constituicao || "",
          regimeTributario: cache.regime_tributario || "",
          dataOpcaoSimples: cache.data_opcao_simples || "",
          capitalSocial: cache.capital_social || "",
        });
      }
    }

    // se não veio do cache -> consulta APIs
    let radar = null;
    let receita = null;

    try {
      radar = await consultaRadarAPI(cnpj);
    } catch (e) {
      console.warn("Falha RADAR em /consulta-completa:", cnpj, e.message);
    }

    try {
      receita = await consultaReceitaWsAPI(cnpj);
    } catch (e) {
      console.warn("Falha ReceitaWS em /consulta-completa:", cnpj, e.message);
    }

    if (!radar && !receita) {
      return res
        .status(502)
        .json({ error: "Nenhuma das APIs (RADAR/Receita) respondeu." });
    }

    const dados = {
      contribuinte: (radar && radar.contribuinte) || "",
      situacao: (radar && radar.situacao) || "",
      dataSituacao: (radar && radar.dataSituacao) || "",
      submodalidade: (radar && radar.submodalidade) || "",
      razaoSocial: (receita && receita.razaoSocial) || "",
      nomeFantasia:
        receita && receita.nomeFantasia && receita.nomeFantasia.trim().length
          ? receita.nomeFantasia.trim()
          : receita
          ? "Sem nome fantasia"
          : "",
      municipio: (receita && receita.municipio) || "",
      uf: (receita && receita.uf) || "",
      dataConstituicao: (receita && receita.dataConstituicao) || "",
      regimeTributario: (receita && receita.regimeTributario) || "",
      dataOpcaoSimples: (receita && receita.dataOpcaoSimples) || "",
      capitalSocial: (receita && receita.capitalSocial) || "",
    };

    const linha = await salvarConsulta(cnpj, dados);

    return res.json({
      fromCache: false,
      dataConsulta: linha.data_consulta, // yyyy-mm-dd
      cnpj,
      ...dados,
    });
  } catch (err) {
    console.error("Erro /consulta-completa:", err);
    return res.status(500).json({ error: "Erro interno em consulta-completa" });
  }
});

// ================= HISTÓRICO =================

/**
 * GET /historico/datas
 * -> traz todas as datas de consulta disponíveis no banco (para montar tela de histórico)
 */
app.get("/historico/datas", async (req, res) => {
  try {
    const sql = `
      SELECT data_consulta, COUNT(*) AS total
      FROM consultas_radar
      GROUP BY data_consulta
      ORDER BY data_consulta DESC;
    `;
    const { rows } = await pool.query(sql);
    return res.json(
      rows.map((r) => ({
        dataConsulta: r.data_consulta,
        total: Number(r.total),
      }))
    );
  } catch (err) {
    console.error("Erro /historico/datas:", err);
    return res.status(500).json({ error: "Erro ao listar datas do histórico" });
  }
});

/**
 * GET /historico?data=2025-11-18
 * GET /historico?from=2025-11-01&to=2025-11-30
 * -> devolve registros para exportar pro Excel
 */
app.get("/historico", async (req, res) => {
  try {
    const { data, from, to } = req.query;

    let sql;
    let params;

    if (data) {
      sql = `
        SELECT *
        FROM consultas_radar
        WHERE data_consulta = $1
        ORDER BY cnpj;
      `;
      params = [data];
    } else if (from && to) {
      sql = `
        SELECT *
        FROM consultas_radar
        WHERE data_consulta BETWEEN $1 AND $2
        ORDER BY data_consulta, cnpj;
      `;
      params = [from, to];
    } else {
      return res.status(400).json({
        error:
          "Informe ?data=YYYY-MM-DD ou ?from=YYYY-MM-DD&to=YYYY-MM-DD para consultar o histórico.",
      });
    }

    const { rows } = await pool.query(sql, params);

    const resultado = rows.map((linha) => ({
      dataConsulta: linha.data_consulta,
      cnpj: linha.cnpj,
      contribuinte: linha.contribuinte || "",
      situacao: linha.situacao || "",
      dataSituacao: linha.data_situacao || "",
      submodalidade: linha.submodalidade || "",
      razaoSocial: linha.razao_social || "",
      nomeFantasia: linha.nome_fantasia || "",
      municipio: linha.municipio || "",
      uf: linha.uf || "",
      dataConstituicao: linha.data_constituicao || "",
      regimeTributario: linha.regime_tributario || "",
      dataOpcaoSimples: linha.data_opcao_simples || "",
      capitalSocial: linha.capital_social || "",
    }));

    return res.json(resultado);
  } catch (err) {
    console.error("Erro /historico:", err);
    return res.status(500).json({ error: "Erro ao consultar histórico" });
  }
});

// ========== SOBE O SERVIDOR ==========
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Backend rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Erro ao inicializar DB:", err);
    process.exit(1);
  });
