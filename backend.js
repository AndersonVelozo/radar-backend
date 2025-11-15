// backend.js (Node/Express)
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch"); // versão 2 (CommonJS)

const app = express();

const PORT = process.env.PORT || 3000;
const INFOSIMPLES_TOKEN = process.env.API_TOKEN;
const URL_RADAR = process.env.URL_RADAR;

// ========== CORS ==========
// Pode deixar assim por enquanto (origem "*") ou, se quiser travar mais:
app.use(
  cors({
    origin: [
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "https://andersonvelozo.github.io",
    ],
  })
);

// Só pra testar rápido no navegador
app.get("/", (req, res) => {
  res.json({ ok: true, msg: "Backend RADAR/ReceitaWS rodando" });
});

/**
 * ========= ENDPOINT RECEITAWS =========
 * GET /consulta-receitaws?cnpj=44342670000161
 */
app.get("/consulta-receitaws", async (req, res) => {
  try {
    const cnpj = (req.query.cnpj || "").replace(/\D/g, "");
    if (!cnpj) {
      return res.status(400).json({ error: "CNPJ obrigatório" });
    }

    const url = `https://www.receitaws.com.br/v1/CNPJ/${cnpj}`;
    const resp = await fetch(url);

    if (!resp.ok) {
      return res
        .status(resp.status)
        .json({ error: `Erro na ReceitaWS: HTTP ${resp.status}` });
    }

    const d = await resp.json();

    if (d.status && d.status !== "OK") {
      return res.status(400).json({
        error: d.message || "Erro na ReceitaWS",
      });
    }

    // --------- CAMPOS QUE O FRONT PRECISA ---------
    const razaoSocial = d.nome || "";
    const nomeFantasia = d.fantasia || ""; // pode vir vazio, o front trata

    const municipio = d.municipio || "";
    const uf = d.uf || "";
    const municipioUf =
      municipio && uf ? `${municipio} (${uf})` : municipio || uf || "";

    const dataConstituicao = d.abertura || "";

    let regimeTributario = "";
    if (d.simples && typeof d.simples.optante === "boolean") {
      if (d.simples.optante) {
        regimeTributario = "Simples Nacional";
        if (d.simples.data_opcao) {
          regimeTributario += ` desde ${d.simples.data_opcao}`;
        }
      } else {
        regimeTributario = "Regime Normal (Lucro Real ou Presumido)";
      }
    }

    let capitalSocial = "";
    if (d.capital_social) {
      const num = Number(String(d.capital_social).replace(",", "."));
      if (!isNaN(num)) {
        capitalSocial =
          "R$ " +
          num.toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
      } else {
        capitalSocial = `R$ ${d.capital_social}`;
      }
    }

    return res.json({
      razaoSocial,
      nomeFantasia,
      municipio,
      uf,
      municipioUf,
      dataConstituicao,
      regimeTributario,
      capitalSocial,
    });
  } catch (err) {
    console.error("Erro /consulta-receitaws:", err);
    return res
      .status(500)
      .json({ error: "Erro interno ao consultar ReceitaWS" });
  }
});

/**
 * ========= ENDPOINT RADAR (INFOSIMPLES) =========
 * GET /consulta-radar?cnpj=50543565000193
 */
app.get("/consulta-radar", async (req, res) => {
  try {
    const cnpj = (req.query.cnpj || "").replace(/\D/g, "");
    if (!cnpj) {
      return res.status(400).json({ error: "CNPJ obrigatório" });
    }

    if (!INFOSIMPLES_TOKEN || !URL_RADAR) {
      return res.status(500).json({
        error:
          "Backend não configurado: defina API_TOKEN e URL_RADAR no arquivo .env",
      });
    }

    const url = `${URL_RADAR}?token=${INFOSIMPLES_TOKEN}&cnpj=${cnpj}`;
    const resp = await fetch(url);

    if (!resp.ok) {
      return res
        .status(resp.status)
        .json({ error: `Erro na Infosimples RADAR: HTTP ${resp.status}` });
    }

    const json = await resp.json();
    console.log("Resposta bruta Infosimples RADAR para", cnpj, json);

    // ---- NORMALIZAÇÃO DO CAMPO data ----
    let dados = null;
    const rawData = json && json.data;

    if (Array.isArray(rawData)) {
      // data é array normal
      dados = rawData[0] || null;
    } else if (rawData && typeof rawData === "object") {
      // data é objeto com chave "0" ou 0 ou já vem direto
      dados = rawData[0] || rawData["0"] || rawData;
    }

    let contribuinte = "";
    let situacao = "";
    let dataSituacao = "";
    let submodalidade = "";

    if (dados) {
      console.log("Dados normalizados RADAR para", cnpj, dados);

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

    return res.json({
      contribuinte,
      situacao,
      dataSituacao,
      submodalidade,
    });
  } catch (err) {
    console.error("Erro /consulta-radar:", err);
    return res.status(500).json({
      error: "Erro interno ao consultar RADAR (Infosimples)",
    });
  }
});

// Sobe o servidor
app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});
