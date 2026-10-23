// scripts/collect.js
//
// Coleta semanal do radar: a posição da aerotur.com.br no Google (computador) para as keywords de
// scripts/keywords.js, pela API de SERP do DataForSEO, e salva em docs/data/rankings.json.
// Cada busca é feita a partir da própria capital (kw.local): é o que alguém de lá vê. Antes de 22/10/2026 era o
// Brasil em geral; as coletas guardam `local` para o painel não comparar posições medidas de lugares diferentes.
//
// Usa a FILA PADRÃO do DataForSEO (task_post + task_get), mais barata que a chamada ao vivo; o que não ficar pronto
// a tempo vai pela chamada ao vivo. Guarda, por coleta, a melhor posição da Aerotur, a URL que ranqueia e todas as
// URLs da Aerotur no top 100; o top 10 do Google fica só da coleta mais recente.
//
// Variáveis de ambiente: DATAFORSEO_LOGIN e DATAFORSEO_PASSWORD (opcional: PROFUNDIDADE, padrão 100).
// Uso:
//   node scripts/collect.js              coleta todas (fila padrão)
//   node scripts/collect.js --ao-vivo    coleta todas pela chamada ao vivo
//   node scripts/collect.js --so=id,id   só algumas keywords (teste)
//   node scripts/collect.js --ensaio     não chama a API: só converte o arquivo e mostra o plano

const fs = require("fs");
const path = require("path");
const { KEYWORDS } = require("./keywords");

const DOMINIO = "aerotur.com.br";
const API = "https://api.dataforseo.com/v3";
const ARQUIVO = path.join(__dirname, "..", "docs", "data", "rankings.json");
const PROFUNDIDADE = Number(process.env.PROFUNDIDADE || 100);
const BRASIL = 2076;
const PARAMETROS = {
  language_code: "pt",
  device: "desktop",
  os: "windows",
  depth: PROFUNDIDADE,
};
/** A tarefa do DataForSEO para uma keyword, buscada a partir da capital dela. */
const tarefa = (kw) => ({ ...PARAMETROS, location_code: kw.local || BRASIL, keyword: kw.keyword, tag: kw.id });
const ESPERA_MAXIMA_MS = 45 * 60 * 1000;
const INTERVALO_MS = 30 * 1000;

const args = process.argv.slice(2);
const ENSAIO = args.includes("--ensaio");
const AO_VIVO = args.includes("--ao-vivo");
const SO = (args.find((a) => a.startsWith("--so=")) || "").slice(5).split(",").filter(Boolean);

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const hoje = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); // data de Brasília

// ─── Arquivo de dados (com a conversão do formato antigo) ───────────────────
function carregar() {
  let bruto = null;
  try {
    bruto = JSON.parse(fs.readFileSync(ARQUIVO, "utf-8"));
  } catch {
    bruto = null;
  }
  if (bruto && bruto.versao === 2) return bruto;
  const dados = { versao: 2, dominio: DOMINIO, atualizadoEm: null, keywords: [], coletas: [], serp: {} };
  if (bruto && Array.isArray(bruto.collections)) {
    // formato antigo: uma linha por (data, keyword)
    const porTexto = new Map(KEYWORDS.map((k) => [k.keyword, k.id]));
    const porData = new Map();
    for (const c of bruto.collections) {
      const id = porTexto.get(c.keyword);
      if (!id) continue;
      if (!porData.has(c.date)) porData.set(c.date, {});
      porData.get(c.date)[id] = {
        pos: c.sitePosition || null,
        url: c.siteUrl || null,
        total: c.totalOrganicResults ?? null,
        aerotur: c.sitePosition ? [[c.sitePosition, c.siteUrl]] : [],
      };
      dados.serp[id] = {
        data: c.date,
        top10: (c.top10 || []).map((t) => [t.position, t.domain, t.url, t.title]),
      };
    }
    dados.coletas = [...porData.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([data, resultados]) => ({ data, resultados }));
    dados.atualizadoEm = bruto.lastUpdated || null;
    console.log(`Formato antigo convertido: ${dados.coletas.length} coletas.`);
  }
  return dados;
}

function salvar(dados) {
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(dados, null, 1) + "\n", "utf-8");
}

// ─── API ─────────────────────────────────────────────────────────────────────
function autorizacao() {
  const login = process.env.DATAFORSEO_LOGIN;
  const senha = process.env.DATAFORSEO_PASSWORD;
  if (!login || !senha) {
    console.error("ERRO: defina DATAFORSEO_LOGIN e DATAFORSEO_PASSWORD");
    process.exit(1);
  }
  return "Basic " + Buffer.from(`${login}:${senha}`).toString("base64");
}

async function chamar(metodo, rota, corpo, auth) {
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const r = await fetch(`${API}${rota}`, {
        method: metodo,
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
      const json = await r.json();
      if (json.status_code === 20000) return json;
      throw new Error(`${json.status_code} ${json.status_message}`);
    } catch (e) {
      if (tentativa === 3) throw e;
      await esperar(3000 * tentativa);
    }
  }
}

function hostDe(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Lê um resultado de SERP: a melhor posição da Aerotur, as URLs dela e o top 10. */
function ler(resultado) {
  const organicos = (resultado.items || []).filter((i) => i.type === "organic");
  const nossas = organicos.filter((i) => hostDe(i.url) === DOMINIO).map((i) => [i.rank_group, i.url]);
  return {
    pos: nossas.length ? nossas[0][0] : null,
    url: nossas.length ? nossas[0][1] : null,
    total: organicos.length,
    aerotur: nossas,
    top10: organicos.slice(0, 10).map((i) => [i.rank_group, i.domain || "", i.url || "", i.title || ""]),
  };
}

async function aoVivo(kw, auth) {
  const json = await chamar("POST", "/serp/google/organic/live/advanced", [tarefa(kw)], auth);
  const tarefa = json.tasks[0];
  if (tarefa.status_code !== 20000) throw new Error(`${tarefa.status_code} ${tarefa.status_message}`);
  return { ...ler(tarefa.result[0]), custo: tarefa.cost || 0 };
}

async function pelaFila(lista, auth) {
  const resultados = new Map();
  let custo = 0;
  // 1. Posta tudo (até 100 tarefas por chamada)
  const pendentes = new Map(); // id da tarefa -> keyword
  for (let i = 0; i < lista.length; i += 100) {
    const lote = lista.slice(i, i + 100);
    const json = await chamar("POST", "/serp/google/organic/task_post", lote.map(tarefa), auth);
    json.tasks.forEach((t, j) => {
      custo += t.cost || 0;
      if (t.status_code === 20100) pendentes.set(t.id, lote[j]);
      else console.error(`  não postou "${lote[j].keyword}": ${t.status_code} ${t.status_message}`);
    });
  }
  console.log(`${pendentes.size} tarefas na fila (custo US$ ${custo.toFixed(4)}). Esperando...`);
  // 2. Busca até ficarem prontas
  const inicio = Date.now();
  while (pendentes.size && Date.now() - inicio < ESPERA_MAXIMA_MS) {
    await esperar(INTERVALO_MS);
    for (const [id, kw] of [...pendentes]) {
      try {
        const json = await chamar("GET", `/serp/google/organic/task_get/advanced/${id}`, null, auth);
        const t = json.tasks[0];
        if (t.status_code === 20000 && t.result && t.result[0]) {
          resultados.set(kw.id, ler(t.result[0]));
          pendentes.delete(id);
        } else if (![40601, 40602].includes(t.status_code)) {
          resultados.set(kw.id, { erro: `${t.status_code} ${t.status_message}` });
          pendentes.delete(id);
        }
      } catch {
        // tenta de novo na próxima volta
      }
    }
    console.log(`  prontas: ${lista.length - pendentes.size}/${lista.length} (${Math.round((Date.now() - inicio) / 1000)} s)`);
  }
  // 3. O que não ficou pronto vai ao vivo
  for (const kw of pendentes.values()) {
    try {
      const r = await aoVivo(kw, auth);
      custo += r.custo;
      resultados.set(kw.id, r);
    } catch (e) {
      resultados.set(kw.id, { erro: e.message });
    }
  }
  return { resultados, custo };
}

async function saldo(auth) {
  try {
    const json = await chamar("GET", "/appendix/user_data", null, auth);
    return json.tasks[0].result[0].money.balance;
  } catch {
    return null;
  }
}

// ─── Principal ───────────────────────────────────────────────────────────────
async function main() {
  const dados = carregar();
  dados.versao = 2;
  dados.dominio = DOMINIO;
  dados.keywords = KEYWORDS;
  dados.fonte = { api: "DataForSEO", localizacao: "a própria capital de cada busca", idioma: "pt", dispositivo: "desktop", profundidade: PROFUNDIDADE };

  const lista = SO.length ? KEYWORDS.filter((k) => SO.includes(k.id)) : KEYWORDS;
  console.log(`${lista.length} keywords · profundidade ${PROFUNDIDADE} · ${AO_VIVO ? "ao vivo" : "fila padrão"}`);
  if (ENSAIO) {
    salvar(dados);
    console.log("ENSAIO: arquivo convertido, nenhuma chamada à API.");
    return;
  }

  const auth = autorizacao();
  let resultados = new Map();
  let custo = 0;
  if (AO_VIVO) {
    for (const kw of lista) {
      try {
        const r = await aoVivo(kw, auth);
        custo += r.custo;
        resultados.set(kw.id, r);
      } catch (e) {
        resultados.set(kw.id, { erro: e.message });
      }
    }
  } else {
    ({ resultados, custo } = await pelaFila(lista, auth));
  }

  const data = hoje();
  let coleta = dados.coletas.find((c) => c.data === data);
  if (!coleta) {
    coleta = { data, local: "capital", resultados: {} };
    dados.coletas.push(coleta);
    dados.coletas.sort((a, b) => a.data.localeCompare(b.data));
  } else if (coleta.local !== "capital") {
    // a coleta do mesmo dia foi feita para o Brasil em geral: é substituída, para não misturar os dois jeitos
    coleta.local = "capital";
    coleta.resultados = {};
  }
  let comPosicao = 0;
  let erros = 0;
  for (const kw of lista) {
    const r = resultados.get(kw.id) || { erro: "sem resposta" };
    if (r.erro) {
      erros++;
      coleta.resultados[kw.id] = { pos: null, url: null, total: null, aerotur: [], erro: r.erro };
      console.log(`  ✗ ${kw.keyword}: ${r.erro}`);
      continue;
    }
    coleta.resultados[kw.id] = { pos: r.pos, url: r.url, total: r.total, aerotur: r.aerotur };
    dados.serp[kw.id] = { data, top10: r.top10 };
    if (r.pos) comPosicao++;
    console.log(`  ${r.pos ? String(r.pos).padStart(3) : "  –"}  ${kw.keyword}${r.url && r.url !== kw.urlAlvo ? `  (ranqueia: ${r.url})` : ""}`);
  }
  dados.atualizadoEm = new Date().toISOString();
  dados.ultimaColeta = { data, keywords: lista.length, comPosicao, erros, custoUsd: Number(custo.toFixed(4)) };
  salvar(dados);

  const restante = await saldo(auth);
  console.log(`\n${comPosicao}/${lista.length} com posição no top ${PROFUNDIDADE} · ${erros} erro(s) · custo US$ ${custo.toFixed(4)}${restante !== null ? ` · saldo da conta US$ ${restante.toFixed(2)}` : ""}`);
  if (erros === lista.length) process.exit(1);
}

main().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
