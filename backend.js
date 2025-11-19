// backend.js (Node/Express + Postgres + Cache 90 dias + Auth + Logs + Painel ADM)
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch"); // versão 2 (CommonJS)
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");

const app = express();

// ========== CONFIG GERAL ==========
const PORT = process.env.PORT || 3000;
const INFOSIMPLES_TOKEN = process.env.API_TOKEN;
const URL_RADAR = process.env.URL_RADAR;
const CACHE_DIAS = Number(process.env.CACHE_DIAS || 90);
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-mude-isso";

const path = require("path");

// Servir arquivos estáticos do front-end
app.use(express.static(path.join(__dirname, "./public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "./public/login.html"));
});

// ========== POSTGRES (Render) ==========
const isRender = !!process.env.RENDER; // o Render seta isso automaticamente

console.log("Iniciando Pool Postgres. RENDER =", isRender);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isRender ? { rejectUnauthorized: false } : false,
});

// cria tabelas se não existir + coluna extra do painel ADM
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
      capital_social    TEXT,
      exportado_por     TEXT              -- 👈 NOVO
    );

    CREATE INDEX IF NOT EXISTS idx_consultas_radar_cnpj_data
      ON consultas_radar (cnpj, data_consulta DESC);

    CREATE TABLE IF NOT EXISTS usuarios (
      id           BIGSERIAL PRIMARY KEY,
      nome         TEXT         NOT NULL,
      email        VARCHAR(120) NOT NULL UNIQUE,
      senha_hash   TEXT         NOT NULL,
      role         VARCHAR(20)  NOT NULL DEFAULT 'user',
      ativo        BOOLEAN      NOT NULL DEFAULT TRUE,
      criado_em    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS consultas_log (
      id           BIGSERIAL PRIMARY KEY,
      usuario_id   BIGINT      NOT NULL REFERENCES usuarios(id),
      cnpj         VARCHAR(14) NOT NULL,
      data_hora    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      origem       VARCHAR(20) NOT NULL,
      sucesso      BOOLEAN     NOT NULL,
      mensagem     TEXT
    );

    ALTER TABLE usuarios
      ADD COLUMN IF NOT EXISTS pode_lote BOOLEAN NOT NULL DEFAULT TRUE;

    -- garante que a coluna exista mesmo em bancos já criados
    ALTER TABLE consultas_radar
      ADD COLUMN IF NOT EXISTS exportado_por TEXT;

    -- 🔧 patch: se existir coluna 'senha' antiga NOT NULL, tornamos NULL
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'usuarios'
          AND column_name = 'senha'
      ) THEN
        BEGIN
          ALTER TABLE usuarios ALTER COLUMN senha DROP NOT NULL;
        EXCEPTION WHEN undefined_column THEN
          NULL;
        END;
      END IF;
    END $$;
  `;

  await pool.query(sql);
  console.log("✔ Tabelas verificadas/criadas.");

  await seedAdminUser();
}

// cria admin padrão se tabela estiver vazia
async function seedAdminUser() {
  try {
    const { rows } = await pool.query(
      "SELECT COUNT(*) AS total FROM usuarios;"
    );
    const total = Number(rows[0]?.total || 0);

    if (total === 0) {
      const nome = "Administrador";
      const email = "admin@radar.local";
      const senhaEmTexto = "admin123"; // TROQUE ISSO ASSIM QUE LOGAR
      const role = "admin";

      const sql = `
        INSERT INTO usuarios (nome, email, senha_hash, role, ativo, pode_lote)
        VALUES ($1, $2, $3, $4, TRUE, TRUE)
        ON CONFLICT (email) DO NOTHING;
      `;

      await pool.query(sql, [nome, email, senhaEmTexto, role]);
      console.log("⚙ Usuário ADMIN criado:");
      console.log(`   Email: ${email}`);
      console.log(`   Senha: ${senhaEmTexto}`);
      console.log("   >> Altere depois pelo painel ADM.");
    }
  } catch (err) {
    console.error("Erro ao criar admin padrão:", err.message);
  }
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

// apaga tudo que tiver mais de CACHE_DIAS dias
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

// ========== LOG DE CONSULTAS ==========
async function registrarLogConsulta(
  usuarioId,
  cnpj,
  origem,
  sucesso,
  mensagem
) {
  try {
    const sql = `
      INSERT INTO consultas_log (usuario_id, cnpj, origem, sucesso, mensagem)
      VALUES ($1, $2, $3, $4, $5);
    `;
    await pool.query(sql, [
      usuarioId,
      cnpj,
      origem || "desconhecida",
      !!sucesso,
      mensagem || null,
    ]);
  } catch (err) {
    console.error("Erro ao registrar log de consulta:", err.message);
  }
}

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

// ========== MIDDLEWARES ==========

// body JSON
app.use(express.json());

// CORS
app.use(
  cors({
    origin: [
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "https://andersonvelozo.github.io",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Middleware de autenticação (qualquer usuário logado)
function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(401).json({ error: "Token não informado" });
  }

  const [tipo, token] = authHeader.split(" ");
  if (tipo !== "Bearer" || !token) {
    return res.status(401).json({ error: "Formato de token inválido" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: payload.id,
      nome: payload.nome,
      email: payload.email,
      role: payload.role,
    };
    next();
  } catch (err) {
    console.error("Erro ao verificar token:", err.message);
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

// Middleware específico para rotas ADM
function authMiddlewareAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Não autenticado" });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Acesso restrito ao administrador" });
  }
  next();
}

// ========== ENDPOINT BÁSICO ==========
app.get("/", (req, res) => {
  res.json({ ok: true, msg: "Backend RADAR/ReceitaWS rodando" });
});

// ========== FUNÇÕES DE API (ReceitaWS / Radar) ==========

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

  return {
    contribuinte,
    situacao,
    dataSituacao,
    submodalidade,
  };
}

// ================= ENDPOINTS AUXILIARES (sem auth, se quiser manter) =================

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

// ================== AUTH ==================
// Login em modo SENHA SIMPLES (SEM BCRYPT)
app.post("/auth/login", async (req, res) => {
  try {
    const { email, senha } = req.body || {};

    console.log(">>> Tentativa login");
    console.log("Email:", email);
    console.log("Senha recebida:", senha);

    if (!email || !senha) {
      return res.status(400).json({ error: "Informe email e senha." });
    }

    const sql = `SELECT * FROM usuarios WHERE email = $1 AND ativo = TRUE`;
    const { rows } = await pool.query(sql, [email]);
    const user = rows[0];

    if (!user) {
      console.log("Usuário não encontrado no banco");
      return res.status(401).json({ error: "Usuário ou senha inválidos." });
    }

    console.log("Senha no banco:", user.senha_hash);

    // Comparação simples
    if (String(user.senha_hash).trim() !== String(senha).trim()) {
      console.log("Senha incorreta!");
      return res.status(401).json({ error: "Usuário ou senha inválidos." });
    }

    console.log(">>> LOGIN OK para:", user.email);

    const token = jwt.sign(
      {
        id: user.id,
        nome: user.nome,
        email: user.email,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.json({
      token,
      usuario: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Erro /auth/login:", err);
    return res.status(500).json({ error: "Erro no login" });
  }
});

// endpoint só pra testar token
app.get("/auth/me", authMiddleware, (req, res) => {
  res.json({ usuario: req.user });
});

// ================= PAINEL ADMIN – CRUD USUÁRIOS =================

// Listar todos os usuários (somente ADM)
app.get(
  "/admin/usuarios",
  authMiddleware,
  authMiddlewareAdmin,
  async (req, res) => {
    try {
      const sql = `
      SELECT id, nome, email, role, ativo, pode_lote, criado_em
      FROM usuarios
      ORDER BY id ASC;
    `;
      const { rows } = await pool.query(sql);
      res.json(rows);
    } catch (err) {
      console.error("Erro GET /admin/usuarios:", err);
      res.status(500).json({ error: "Erro ao listar usuários" });
    }
  }
);

// Criar usuário (somente ADM)
app.post(
  "/admin/usuarios",
  authMiddleware,
  authMiddlewareAdmin,
  async (req, res) => {
    try {
      const { nome, email, senha, role, ativo, pode_lote } = req.body || {};

      if (!nome || !email || !senha) {
        return res
          .status(400)
          .json({ error: "Nome, e-mail e senha são obrigatórios." });
      }

      const roleFinal = role === "admin" ? "admin" : "user";
      const ativoFinal = typeof ativo === "boolean" ? ativo : true;
      const podeLoteFinal = typeof pode_lote === "boolean" ? pode_lote : true;

      const sql = `
      INSERT INTO usuarios (nome, email, senha_hash, role, ativo, pode_lote)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, nome, email, role, ativo, pode_lote, criado_em;
    `;

      const { rows } = await pool.query(sql, [
        nome,
        email,
        senha, // texto simples
        roleFinal,
        ativoFinal,
        podeLoteFinal,
      ]);

      res.status(201).json(rows[0]);
    } catch (err) {
      console.error("Erro POST /admin/usuarios:", err);
      if (err.code === "23505") {
        return res
          .status(400)
          .json({ error: "Já existe um usuário com esse e-mail." });
      }
      res.status(500).json({ error: "Erro ao criar usuário" });
    }
  }
);

// Atualizar usuário (somente ADM)
app.put(
  "/admin/usuarios/:id",
  authMiddleware,
  authMiddlewareAdmin,
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) {
        return res.status(400).json({ error: "ID inválido." });
      }

      const { nome, email, senha, role, ativo, pode_lote } = req.body || {};

      const campos = [];
      const valores = [];
      let idx = 1;

      if (nome !== undefined) {
        campos.push(`nome = $${idx++}`);
        valores.push(nome);
      }
      if (email !== undefined) {
        campos.push(`email = $${idx++}`);
        valores.push(email);
      }
      if (senha !== undefined && senha !== "") {
        campos.push(`senha_hash = $${idx++}`);
        valores.push(senha); // texto simples
      }
      if (role !== undefined) {
        const roleFinal = role === "admin" ? "admin" : "user";
        campos.push(`role = $${idx++}`);
        valores.push(roleFinal);
      }
      if (typeof ativo === "boolean") {
        campos.push(`ativo = $${idx++}`);
        valores.push(ativo);
      }
      if (typeof pode_lote === "boolean") {
        campos.push(`pode_lote = $${idx++}`);
        valores.push(pode_lote);
      }

      if (!campos.length) {
        return res
          .status(400)
          .json({ error: "Nenhum campo informado para atualização." });
      }

      valores.push(id);
      const sql = `
        UPDATE usuarios
        SET ${campos.join(", ")}
        WHERE id = $${idx}
        RETURNING id, nome, email, role, ativo, pode_lote, criado_em;
      `;

      const { rows } = await pool.query(sql, valores);
      const user = rows[0];

      if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado." });
      }

      res.json(user);
    } catch (err) {
      console.error("Erro PUT /admin/usuarios/:id:", err);
      if (err.code === "23505") {
        return res
          .status(400)
          .json({ error: "Já existe um usuário com esse e-mail." });
      }
      res.status(500).json({ error: "Erro ao atualizar usuário" });
    }
  }
);

// "Excluir" usuário (desativar) – somente ADM
app.delete(
  "/admin/usuarios/:id",
  authMiddleware,
  authMiddlewareAdmin,
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) {
        return res.status(400).json({ error: "ID inválido." });
      }

      const sql = `
        UPDATE usuarios
        SET ativo = FALSE
        WHERE id = $1
        RETURNING id, nome, email, role, ativo, pode_lote, criado_em;
      `;

      const { rows } = await pool.query(sql, [id]);
      const user = rows[0];

      if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado." });
      }

      res.json({
        message: "Usuário desativado com sucesso.",
        usuario: user,
      });
    } catch (err) {
      console.error("Erro DELETE /admin/usuarios/:id:", err);
      res.status(500).json({ error: "Erro ao desativar usuário" });
    }
  }
);

// ================= NOVO ENDPOINT UNIFICADO + CACHE POSTGRES (COM AUTH & LOG) =================
/**
 * GET /consulta-completa?cnpj=...&force=1&origem=lote
 * Requer Authorization: Bearer <token>
 */
// ================= NOVO ENDPOINT UNIFICADO + CACHE POSTGRES (COM AUTH & LOG) =================
/**
 * GET /consulta-completa?cnpj=...&force=1&origem=lote
 * Requer Authorization: Bearer <token>
 */
app.get("/consulta-completa", authMiddleware, async (req, res) => {
  const usuarioId = req.user.id;
  const origem = req.query.origem || "unitaria";

  try {
    const cnpj = normalizarCNPJ(req.query.cnpj);
    const force =
      req.query.force === "1" || req.query.force === "true" ? true : false;

    if (!cnpj) {
      return res.status(400).json({ error: "CNPJ obrigatório" });
    }

    // se for consulta em lote, checa permissão (pode_lote) no banco
    if (origem === "lote") {
      const sql = `
        SELECT role, ativo, pode_lote
        FROM usuarios
        WHERE id = $1
      `;
      const { rows } = await pool.query(sql, [usuarioId]);
      const u = rows[0];

      if (!u || !u.ativo) {
        return res
          .status(403)
          .json({ error: "Usuário inativo ou não encontrado." });
      }

      if (!u.pode_lote && u.role !== "admin") {
        return res.status(403).json({
          error: "Você não tem permissão para consultas em lote.",
        });
      }
    }

    // 🔹 1) Tenta cache primeiro, se NÃO for "force"
    await limparConsultasAntigas();

    if (!force) {
      const cache = await getConsultaRecente(cnpj);

      if (cache) {
        // se vier um cache “podre” (sem nenhuma info de habilitação),
        // ignoramos e deixamos seguir para consulta via API
        const cacheSemRadar =
          !cache.situacao &&
          !cache.contribuinte &&
          !cache.submodalidade &&
          !cache.data_situacao;

        if (!cacheSemRadar) {
          await registrarLogConsulta(
            usuarioId,
            cnpj,
            origem,
            true,
            "resposta do cache"
          );

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
        } else {
          console.log(
            "⚠ Cache ignorado por estar sem dados de habilitação:",
            cnpj
          );
        }
      }
    }

    // 🔹 2) Não tem no cache (ou force=true) → consulta APIs
    let radar = null;
    let receita = null;

    let radarFalhou = false;
    let msgErroRadar = "";

    try {
      radar = await consultaRadarAPI(cnpj);
    } catch (e) {
      radarFalhou = true;
      msgErroRadar = e.message || "Falha RADAR";
      console.warn("Falha RADAR em /consulta-completa:", cnpj, msgErroRadar);
    }

    try {
      receita = await consultaReceitaWsAPI(cnpj);
    } catch (e) {
      console.warn("Falha ReceitaWS em /consulta-completa:", cnpj, e.message);
    }

    // se NENHUMA das duas respondeu, mantém o erro 502
    if (!radar && !receita) {
      await registrarLogConsulta(
        usuarioId,
        cnpj,
        origem,
        false,
        "RADAR e ReceitaWS não responderam"
      );
      return res.status(502).json({
        error: "Nenhuma das APIs (RADAR/Receita) respondeu.",
      });
    }

    // 🔹 Fallback: se a RADAR respondeu (não deu erro), mas não trouxe
    // NENHUM campo de habilitação, tratamos como "NÃO HABILITADA"
    if (radar && !radarFalhou) {
      const semCamposRadar =
        !radar.contribuinte &&
        !radar.situacao &&
        !radar.dataSituacao &&
        !radar.submodalidade;

      if (semCamposRadar) {
        radar.situacao = "NÃO HABILITADA";
      }
    }

    // texto padrão quando só o RADAR falha (Receita respondeu)
    const textoSemInfo = radarFalhou ? "Sem informação" : "";

    const dados = {
      // Campos de habilitação (RADAR)
      contribuinte: radar?.contribuinte || textoSemInfo,
      situacao: radar?.situacao || textoSemInfo,
      dataSituacao: radar?.dataSituacao || textoSemInfo,
      submodalidade: radar?.submodalidade || textoSemInfo,

      // Campos cadastrais (ReceitaWS)
      razaoSocial: receita?.razaoSocial || "",
      nomeFantasia:
        receita && receita.nomeFantasia && receita.nomeFantasia.trim().length
          ? receita.nomeFantasia.trim()
          : receita
          ? "Sem nome fantasia"
          : "",
      municipio: receita?.municipio || "",
      uf: receita?.uf || "",
      dataConstituicao: receita?.dataConstituicao || "",
      regimeTributario: receita?.regimeTributario || "",
      dataOpcaoSimples: receita?.dataOpcaoSimples || "",
      capitalSocial: receita?.capitalSocial || "",
    };

    // 🔹 3) DECIDE SE VAI SALVAR NO BANCO
    //
    // Regras:
    //  - Se NÃO tiver RADAR, mas tiver Receita, e o RADAR FALHOU (timeout / erro HTTP),
    //    NÃO salva no banco (consulta parcial, só cadastral).
    //  - Se tiver RADAR (mesmo que sem Receita) OU RADAR retornou "DADOS INDISPONÍVEIS (RADAR)",
    //    considera resposta válida e salva normal.
    let salvarNoBanco = true;
    if (!radar && receita && radarFalhou) {
      salvarNoBanco = false;
    }

    let dataConsultaResposta = new Date().toISOString().slice(0, 10); // fallback
    let linha = null;

    if (salvarNoBanco) {
      linha = await salvarConsulta(cnpj, dados);
      dataConsultaResposta = linha.data_consulta;

      console.log("✔ Consulta salva no banco:", linha.id, cnpj);

      await registrarLogConsulta(
        usuarioId,
        cnpj,
        origem,
        true,
        radarFalhou
          ? "consulta salva (RADAR falhou, mas dados parciais válidos)"
          : "consulta salva"
      );
    } else {
      console.log(
        "ℹ Consulta NÃO salva no banco (somente ReceitaWS, RADAR falhou):",
        cnpj
      );

      await registrarLogConsulta(
        usuarioId,
        cnpj,
        origem,
        true,
        "consulta parcial (somente ReceitaWS, não salva no banco)"
      );
    }

    return res.json({
      fromCache: false,
      dataConsulta: dataConsultaResposta,
      cnpj,
      ...dados,
    });
  } catch (err) {
    console.error("Erro /consulta-completa:", err);
    await registrarLogConsulta(
      usuarioId,
      normalizarCNPJ(req.query.cnpj),
      origem,
      false,
      err.message
    );
    return res.status(500).json({ error: "Erro interno em consulta-completa" });
  }
});

// ================= HISTÓRICO (COM AUTH) =================

app.get("/historico/datas", authMiddleware, async (req, res) => {
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

app.get("/historico", authMiddleware, async (req, res) => {
  try {
    const { data, from, to, registrarExport } = req.query;
    const deveRegistrarExport = registrarExport === "1";

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

    // 👇 Se for exportação, grava quem exportou no banco
    if (deveRegistrarExport && req.user && req.user.nome) {
      const nomeUsuario = req.user.nome;
      let updateSql;
      let updateParams;

      if (data) {
        updateSql = `
          UPDATE consultas_radar
          SET exportado_por = $1
          WHERE data_consulta = $2;
        `;
        updateParams = [nomeUsuario, data];
      } else {
        updateSql = `
          UPDATE consultas_radar
          SET exportado_por = $1
          WHERE data_consulta BETWEEN $2 AND $3;
        `;
        updateParams = [nomeUsuario, from, to];
      }

      await pool.query(updateSql, updateParams);
    }

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
      exportadoPor: linha.exportado_por || "", // 👈 devolve pro front se quiser usar
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
