// scripts/collect.js
//
// Coleta semanal do radar: a posição da aerotur.com.br no Google, no computador e no celular, para as keywords de
// scripts/keywords.js, pela API de SERP do DataForSEO, e salva em docs/data/rankings.json.
// Cada busca é feita a partir da própria capital (kw.local): é o que alguém de lá vê. Antes de 22/10/2026 era o
// Brasil em geral, só no computador; as coletas guardam `local` para o painel não comparar posições medidas de
// lugares diferentes.
//
// O Google alterna entre versões diferentes da página de resultados para a mesma busca (teste de 22/10/2026: em
// "agência de viagens corporativas em salvador", a Aerotur aparecia em 3º em 2 de 5 buscas iguais e sumia nas outras).
// Por isso cada busca é feita AMOSTRAS vezes: guarda a melhor posição, a URL dela e a lista de posições de cada
// busca (`amostras`, null = fora do top PROFUNDIDADE).
//
// Usa a FILA PADRÃO do DataForSEO (task_post + task_get), mais barata que a chamada ao vivo; o que não ficar pronto
// a tempo vai pela chamada ao vivo. Computador fica em `resultados` e celular em `celular`. O top 10 do Google fica
// só da coleta mais recente (`serp` e `serpCelular`), da busca em que a Aerotur ficou mais bem colocada.
//
// Variáveis de ambiente: DATAFORSEO_LOGIN e DATAFORSEO_PASSWORD
//   opcionais: PROFUNDIDADE (padrão 50), AMOSTRAS (padrão 3) e DISPOSITIVOS (padrão "desktop,mobile")
// Uso:
//   node scripts/collect.js                        coleta todas, nos dois dispositivos (fila padrão)
//   node scripts/collect.js --ao-vivo              pela chamada ao vivo
//   node scripts/collect.js --so=id,id             só algumas keywords (teste)
//   node scripts/collect.js --dispositivos=mobile  só um dispositivo
//   node scripts/collect.js --ensaio               não chama a API: só atualiza o arquivo e mostra o plano

const fs = require("fs");
const path = require("path");
const { KEYWORDS } = require("./keywords");

const DOMINIO = "aerotur.com.br";
const API = "https://api.dataforseo.com/v3";
const ARQUIVO = process.env.ARQUIVO_RANKINGS || path.join(__dirname, "..", "docs", "data", "rankings.json");
const PROFUNDIDADE = Number(process.env.PROFUNDIDADE || 50);
const AMOSTRAS = Math.max(1, Number(process.env.AMOSTRAS || 3));
const BRASIL = 2076;
const PARAMETROS = { language_code: "pt", depth: PROFUNDIDADE };
const DISPOSITIVOS = {
  desktop: { device: "desktop", os: "windows", campo: "resultados", serp: "serp", nome: "computador" },
  mobile: { device: "mobile", os: "android", campo: "celular", serp: "serpCelular", nome: "celular" },
};
const ESPERA_MAXIMA_MS = 60 * 60 * 1000;
const INTERVALO_MS = 30 * 1000;

const args = process.argv.slice(2);
const ENSAIO = args.includes("--ensaio");
const AO_VIVO = args.includes("--ao-vivo");
const SO = (args.find((a) => a.startsWith("--so=")) || "").slice(5).split(",").filter(Boolean);
const QUAIS = ((args.find((a) => a.startsWith("--dispositivos=")) || "").slice(15) || process.env.DISPOSITIVOS || "desktop,mobile")
  .split(",")
  .map((d) => d.trim())
  .filter((d) => DISPOSITIVOS[d]);

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const hoje = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); // data de Brasília

/** A tarefa do DataForSEO para uma busca (keyword × dispositivo), feita a partir da capital da keyword. */
const tarefa = ({ kw, disp, tag }) => ({
  ...PARAMETROS,
  device: DISPOSITIVOS[disp].device,
  os: DISPOSITIVOS[disp].os,
  location_code: kw.local || BRASIL,
  keyword: kw.keyword,
  tag,
});

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

async function aoVivo(busca, auth) {
  const json = await chamar("POST", "/serp/google/organic/live/advanced", [tarefa(busca)], auth);
  const t = json.tasks[0];
  if (t.status_code !== 20000) throw new Error(`${t.status_code} ${t.status_message}`);
  return { ...ler(t.result[0]), custo: t.cost || 0 };
}

/** Coleta as buscas pela fila padrão; devolve os resultados por `tag` (keyword|dispositivo). */
async function pelaFila(buscas, auth) {
  const resultados = new Map();
  let custo = 0;
  // 1. Posta tudo (até 100 tarefas por chamada)
  const pendentes = new Map(); // id da tarefa -> busca
  for (let i = 0; i < buscas.length; i += 100) {
    const lote = buscas.slice(i, i + 100);
    const json = await chamar("POST", "/serp/google/organic/task_post", lote.map(tarefa), auth);
    json.tasks.forEach((t, j) => {
      custo += t.cost || 0;
      if (t.status_code === 20100) pendentes.set(t.id, lote[j]);
      else console.error(`  não postou "${lote[j].kw.keyword}" (${DISPOSITIVOS[lote[j].disp].nome}): ${t.status_code} ${t.status_message}`);
    });
  }
  console.log(`${pendentes.size} tarefas na fila (custo US$ ${custo.toFixed(4)}). Esperando...`);
  // 2. Busca até ficarem prontas. tasks_ready diz quais terminaram; se ele falhar, pergunta por todas as pendentes.
  const inicio = Date.now();
  const buscar = async (id) => {
    const busca = pendentes.get(id);
    try {
      const json = await chamar("GET", `/serp/google/organic/task_get/advanced/${id}`, null, auth);
      const t = json.tasks[0];
      if (t.status_code === 20000 && t.result && t.result[0]) {
        resultados.set(busca.tag, ler(t.result[0]));
        pendentes.delete(id);
      } else if (![40601, 40602].includes(t.status_code)) {
        resultados.set(busca.tag, { erro: `${t.status_code} ${t.status_message}` });
        pendentes.delete(id);
      }
    } catch {
      // tenta de novo na próxima volta
    }
  };
  for (let volta = 1; pendentes.size && Date.now() - inicio < ESPERA_MAXIMA_MS; volta++) {
    await esperar(INTERVALO_MS);
    let prontas = null;
    try {
      if (volta % 4 === 0) throw new Error("de tempos em tempos, pergunta por todas");
      const json = await chamar("GET", "/serp/google/organic/tasks_ready", null, auth);
      prontas = (json.tasks?.[0]?.result || []).map((r) => r.id).filter((id) => pendentes.has(id));
    } catch {
      prontas = [...pendentes.keys()];
    }
    for (let i = 0; i < prontas.length; i += 20) await Promise.all(prontas.slice(i, i + 20).map(buscar));
    console.log(`  prontas: ${buscas.length - pendentes.size}/${buscas.length} (${Math.round((Date.now() - inicio) / 1000)} s)`);
  }
  // 3. O que não ficou pronto vai ao vivo
  for (const busca of pendentes.values()) {
    try {
      const r = await aoVivo(busca, auth);
      custo += r.custo;
      resultados.set(busca.tag, r);
    } catch (e) {
      resultados.set(busca.tag, { erro: e.message });
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
  dados.fonte = { api: "DataForSEO", localizacao: "a própria capital de cada busca", idioma: "pt", dispositivos: ["computador", "celular"], amostras: AMOSTRAS, profundidade: PROFUNDIDADE };
  dados.serpCelular = dados.serpCelular || {};

  if (!QUAIS.length) {
    console.error("ERRO: nenhum dispositivo válido (use desktop, mobile ou os dois)");
    process.exit(1);
  }
  const lista = SO.length ? KEYWORDS.filter((k) => SO.includes(k.id)) : KEYWORDS;
  const buscas = lista.flatMap((kw) => QUAIS.flatMap((disp) => Array.from({ length: AMOSTRAS }, (_, n) => ({ kw, disp, tag: `${kw.id}|${disp}|${n + 1}` }))));
  const nomes = QUAIS.map((d) => DISPOSITIVOS[d].nome).join(" e ");
  console.log(`${lista.length} keywords × ${nomes} × ${AMOSTRAS} vezes = ${buscas.length} buscas · profundidade ${PROFUNDIDADE} · ${AO_VIVO ? "ao vivo" : "fila padrão"}`);
  if (ENSAIO) {
    salvar(dados);
    console.log("ENSAIO: arquivo atualizado, nenhuma chamada à API.");
    return;
  }

  const auth = autorizacao();
  let resultados = new Map();
  let custo = 0;
  if (AO_VIVO) {
    for (const busca of buscas) {
      try {
        const r = await aoVivo(busca, auth);
        custo += r.custo;
        resultados.set(busca.tag, r);
      } catch (e) {
        resultados.set(busca.tag, { erro: e.message });
      }
    }
  } else {
    ({ resultados, custo } = await pelaFila(buscas, auth));
  }

  const data = hoje();
  let coleta = dados.coletas.find((c) => c.data === data);
  if (!coleta) {
    coleta = { data, local: "capital", resultados: {}, celular: {} };
    dados.coletas.push(coleta);
    dados.coletas.sort((a, b) => a.data.localeCompare(b.data));
  } else if (coleta.local !== "capital" || (coleta.amostras || 1) !== AMOSTRAS) {
    // a coleta do mesmo dia foi feita de outro jeito (Brasil em geral ou outro número de buscas): é substituída
    coleta.local = "capital";
    coleta.resultados = {};
    coleta.celular = {};
  }
  coleta.resultados = coleta.resultados || {};
  coleta.celular = coleta.celular || {};
  coleta.amostras = AMOSTRAS;

  // Junta as AMOSTRAS buscas de cada keyword × dispositivo: melhor posição, a URL dela e a posição em cada busca.
  const resumo = Object.fromEntries(QUAIS.map((d) => [d, { comPosicao: 0, erros: 0 }]));
  for (const kw of lista) {
    for (const disp of QUAIS) {
      const conf = DISPOSITIVOS[disp];
      const lidas = Array.from({ length: AMOSTRAS }, (_, n) => resultados.get(`${kw.id}|${disp}|${n + 1}`) || { erro: "sem resposta" });
      const boas = lidas.filter((r) => !r.erro);
      if (!boas.length) {
        resumo[disp].erros++;
        coleta[conf.campo][kw.id] = { pos: null, url: null, total: null, aerotur: [], amostras: [], erro: lidas[0].erro };
        console.log(`  ✗ [${conf.nome}] ${kw.keyword}: ${lidas[0].erro}`);
        continue;
      }
      const melhor = boas.reduce((a, b) => (b.pos && (!a.pos || b.pos < a.pos) ? b : a));
      const amostras = boas.map((r) => r.pos || null);
      coleta[conf.campo][kw.id] = { pos: melhor.pos, url: melhor.url, total: melhor.total, aerotur: melhor.aerotur, amostras };
      dados[conf.serp][kw.id] = { data, top10: melhor.top10 };
      if (melhor.pos) resumo[disp].comPosicao++;
      const vezes = amostras.filter(Boolean).length;
      console.log(`  ${melhor.pos ? String(melhor.pos).padStart(3) : "  –"}  [${conf.nome}] ${kw.keyword} (${vezes}/${boas.length})${melhor.url && melhor.url !== kw.urlAlvo ? `  (ranqueia: ${melhor.url})` : ""}`);
    }
  }
  dados.atualizadoEm = new Date().toISOString();
  dados.ultimaColeta = { data, keywords: lista.length, buscas: buscas.length, amostras: AMOSTRAS, porDispositivo: resumo, custoUsd: Number(custo.toFixed(4)) };
  salvar(dados);

  const restante = await saldo(auth);
  const partes = QUAIS.map((d) => `${DISPOSITIVOS[d].nome}: ${resumo[d].comPosicao}/${lista.length} no top ${PROFUNDIDADE}, ${resumo[d].erros} erro(s)`);
  console.log(`\n${partes.join(" · ")} · custo US$ ${custo.toFixed(4)}${restante !== null ? ` · saldo da conta US$ ${restante.toFixed(2)}` : ""}`);
  const erros = Object.values(resumo).reduce((t, r) => t + r.erros, 0);
  if (erros === lista.length * QUAIS.length) process.exit(1);
}

main().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
