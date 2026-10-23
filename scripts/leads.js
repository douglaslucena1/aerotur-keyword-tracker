// scripts/leads.js
//
// Leads do WhatsApp: os cliques em links do WhatsApp no site da Aerotur, lidos do Google Analytics 4 (evento "click"
// de link externo, da medição otimizada). Guarda, por dia, a página onde a pessoa clicou, o canal de origem da visita,
// o setor do número e o tipo de link (botão da página, botão flutuante ou banner do blog) em docs/data/leads.json.
//
// Autenticação: token OAuth (só leitura do Analytics) de uma conta com acesso à propriedade.
// Variáveis de ambiente: GA4_CLIENT_ID, GA4_CLIENT_SECRET, GA4_REFRESH_TOKEN
//   opcionais: GA4_PROPRIEDADE (padrão 466651177, aerotur.com.br) e GA4_INICIO (padrão 2024-11-01, início dos dados)
// Uso: node scripts/leads.js

const fs = require("fs");
const path = require("path");
const { KEYWORDS, SITE } = require("./keywords");

const PROPRIEDADE = process.env.GA4_PROPRIEDADE || "466651177";
const INICIO = process.env.GA4_INICIO || "2024-11-01";
const ARQUIVO = path.join(__dirname, "..", "docs", "data", "leads.json");
const UA = "Mozilla/5.0 (compatible; RadarAerotur/1.0; +https://douglaslucena1.github.io/aerotur-keyword-tracker/)";

// Setor de cada número, como aparece no botão flutuante e na página de contato do site.
// Se a Aerotur trocar algum número, atualizar aqui.
const SETORES = {
  "5584994191753": "Viagens",
  "5584994238726": "Corporativo",
  "5584991294891": "Disney",
  "5584994191758": "Disney",
  "5584981534419": "Intercâmbios",
  "5584991036321": "Viagens escolares",
  "5584994192970": "Consolidadora",
  "5584981386283": "Casas para aluguel",
  "5584994022999": "Plantão",
  "5581992475648": "Unidade Recife",
  "5581979013350": "Unidade Recife",
  "5585998130102": "Unidade Fortaleza",
  "5585981648163": "Unidade Fortaleza",
};
const FORMAS = ["botao", "flutuante", "banner", "outro"];

/** Setor do número; aceita o número sem o nono dígito (alguns botões ainda usam o formato antigo). */
function setorDe(numero) {
  if (!numero) return "Link sem número";
  if (SETORES[numero]) return SETORES[numero];
  if (/^55\d{10}$/.test(numero)) {
    const comNove = `${numero.slice(0, 4)}9${numero.slice(4)}`;
    if (SETORES[comNove]) return SETORES[comNove];
  }
  const m = numero.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : `+${numero}`;
}

// Páginas de SEO: as 54 páginas de capital e os dois hubs.
const PAGINAS_SEO = new Map();
for (const kw of KEYWORDS) PAGINAS_SEO.set(new URL(kw.urlAlvo).pathname, { tipo: kw.familia, kw: kw.id });
PAGINAS_SEO.set("/agencia-de-viagens-corporativas/", { tipo: "hub", familia: "corporativo" });
PAGINAS_SEO.set("/agencia-de-viagens/", { tipo: "hub", familia: "lazer" });

// ─── Utilidades ──────────────────────────────────────────────────────────────
function normalizarCaminho(p) {
  let c = String(p || "").trim();
  if (!c || c.startsWith("(")) return "(sem página)";
  try {
    c = decodeURI(c);
  } catch {}
  c = c.toLowerCase();
  if (!c.startsWith("/")) c = "/" + c;
  if (!c.endsWith("/") && !/\.[a-z0-9]{2,5}$/.test(c)) c += "/";
  return c;
}

/** O telefone de um link wa.me/... ou api.whatsapp.com/send?phone=... (aceita espaços, traços e parênteses). */
function numeroDe(url) {
  let u = String(url);
  try {
    u = decodeURIComponent(u);
  } catch {}
  const m = u.match(/wa\.me\/([+\d\s().-]{8,25})/i) || u.match(/[?&]phone=([+\d\s().-]{8,25})/i);
  if (!m) return null;
  const digitos = m[1].replace(/\D/g, "");
  return digitos.length >= 10 ? digitos : null;
}

const cacheWaLink = new Map();
/** wa.link/xxxx redireciona para api.whatsapp.com/send?phone=...: segue o redirecionamento para achar o número. */
async function numeroDoWaLink(url) {
  const m = String(url).match(/wa\.link\/([a-z0-9]+)/i);
  if (!m) return null;
  const codigo = m[1].toLowerCase();
  if (!cacheWaLink.has(codigo)) {
    let numero = null;
    try {
      const r = await fetch(`https://wa.link/${codigo}`, { redirect: "manual", headers: { "User-Agent": UA } });
      numero = numeroDe(r.headers.get("location") || "");
    } catch {}
    cacheWaLink.set(codigo, numero);
  }
  return cacheWaLink.get(codigo);
}

function formaDe(linkUrl, classes, numero) {
  if (/rock-convert/i.test(classes) || /utm_medium=rock-convert/i.test(linkUrl)) return "banner";
  if (/elementor-button/i.test(classes)) return "botao";
  // O botão flutuante usa links wa.me/+55... sem classe; os outros links sem classe ficam no conteúdo das páginas.
  const semClasse = !classes || classes === "(not set)";
  if (semClasse && numero && SETORES[numero] && /wa\.me\/\+/i.test(linkUrl)) return "flutuante";
  return "outro";
}

/** Os posts do blog, pelo sitemap do WordPress. Se falhar, devolve null (o script usa a classificação anterior). */
async function caminhosDoBlog() {
  const caminhos = new Set();
  try {
    for (let n = 1; n <= 20; n++) {
      const r = await fetch(`${SITE}/wp-sitemap-posts-post-${n}.xml`, { headers: { "User-Agent": UA } });
      if (!r.ok) break;
      const locs = [...(await r.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => normalizarCaminho(new URL(m[1].trim()).pathname));
      if (!locs.length) break;
      locs.forEach((c) => caminhos.add(c));
    }
  } catch (e) {
    console.warn("Aviso: não consegui ler o sitemap do blog:", e.message);
  }
  return caminhos.size ? caminhos : null;
}

// ─── GA4 ─────────────────────────────────────────────────────────────────────
async function tokenDeAcesso() {
  const { GA4_CLIENT_ID: id, GA4_CLIENT_SECRET: segredo, GA4_REFRESH_TOKEN: refresh } = process.env;
  if (!id || !segredo || !refresh) {
    console.error("ERRO: defina GA4_CLIENT_ID, GA4_CLIENT_SECRET e GA4_REFRESH_TOKEN");
    process.exit(1);
  }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: segredo, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`token recusado pelo Google: ${j.error} ${j.error_description || ""}`.trim());
  return j.access_token;
}

async function relatorio(token, corpo) {
  const linhas = [];
  let offset = 0;
  for (;;) {
    const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPRIEDADE}:runReport`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...corpo, limit: 100000, offset }),
    });
    const j = await r.json();
    if (j.error) throw new Error(`GA4 ${j.error.code}: ${j.error.message}`);
    const rows = j.rows || [];
    for (const row of rows) linhas.push([...row.dimensionValues.map((d) => d.value), ...row.metricValues.map((m) => Number(m.value))]);
    offset += rows.length;
    if (!rows.length || offset >= (j.rowCount || 0)) {
      if (j.metadata?.dataLossFromOtherRow) console.warn("Aviso: o GA4 agrupou parte das linhas em (other).");
      return linhas;
    }
  }
}

// ─── Principal ───────────────────────────────────────────────────────────────
async function main() {
  let anterior = null;
  try {
    anterior = JSON.parse(fs.readFileSync(ARQUIVO, "utf-8"));
  } catch {}

  const token = await tokenDeAcesso();
  const brutas = await relatorio(token, {
    dateRanges: [{ startDate: INICIO, endDate: "yesterday" }],
    dimensions: [{ name: "date" }, { name: "pagePath" }, { name: "linkUrl" }, { name: "linkClasses" }, { name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: "click" } } },
          { filter: { fieldName: "linkUrl", stringFilter: { matchType: "PARTIAL_REGEXP", value: "wa\\.me|wa\\.link|whatsapp\\.com", caseSensitive: false } } },
        ],
      },
    },
  });
  console.log(`${brutas.length} linhas do GA4 (${INICIO} até ontem).`);

  // Classificação das páginas: SEO pelas keywords, blog pelo sitemap (ou pela coleta anterior, se o sitemap falhar).
  const blog = await caminhosDoBlog();
  const tipoAnterior = new Map((anterior?.paginas || []).map((p) => [p.caminho, p]));
  function pagina(caminho) {
    const seo = PAGINAS_SEO.get(caminho);
    if (seo) return { caminho, ...seo };
    if (caminho === "/") return { caminho, tipo: "home" };
    if (caminho.startsWith("/destinos/")) return { caminho, tipo: "destino" };
    if (/^\/pacotes?(-|\/)/.test(caminho)) return { caminho, tipo: "pacote" };
    if (blog) return { caminho, tipo: blog.has(caminho) ? "blog" : "outra" };
    return tipoAnterior.get(caminho) || { caminho, tipo: "outra" };
  }

  const paginas = [];
  const canais = [];
  const setores = [];
  const indice = { paginas: new Map(), canais: new Map(), setores: new Map() };
  const posicao = (lista, mapa, chave, valor) => {
    if (!mapa.has(chave)) {
      mapa.set(chave, lista.length);
      lista.push(valor);
    }
    return mapa.get(chave);
  };

  const somas = new Map();
  let total = 0;
  for (const [data, caminhoBruto, linkUrl, classes, canal, cliques] of brutas) {
    const numero = numeroDe(linkUrl) || (await numeroDoWaLink(linkUrl));
    const setor = setorDe(numero);
    const caminho = normalizarCaminho(caminhoBruto);
    const iPagina = posicao(paginas, indice.paginas, caminho, pagina(caminho));
    const iCanal = posicao(canais, indice.canais, canal, canal);
    const iSetor = posicao(setores, indice.setores, setor, setor);
    const iForma = FORMAS.indexOf(formaDe(linkUrl, classes, numero));
    const dia = `${data.slice(0, 4)}-${data.slice(4, 6)}-${data.slice(6, 8)}`;
    const chave = [dia, iPagina, iCanal, iSetor, iForma].join("|");
    somas.set(chave, (somas.get(chave) || 0) + cliques);
    total += cliques;
  }
  const linhas = [...somas.entries()]
    .map(([chave, cliques]) => {
      const [dia, ...resto] = chave.split("|");
      return [dia, ...resto.map(Number), cliques];
    })
    .sort((a, b) => a[0].localeCompare(b[0]) || b[5] - a[5]);

  const ontem = new Date(Date.now() - 3 * 3600 * 1000 - 24 * 3600 * 1000).toISOString().slice(0, 10); // dia anterior em Brasília
  const dados = {
    versao: 1,
    fonte: { api: "Google Analytics 4", propriedade: PROPRIEDADE, evento: "click (link externo)" },
    atualizadoEm: new Date().toISOString(),
    periodo: { inicio: linhas.length ? linhas[0][0] : INICIO, fim: ontem },
    formas: FORMAS,
    paginas,
    canais,
    setores,
    linhas,
  };
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(dados) + "\n", "utf-8");

  // Resumo dos últimos 28 dias, por tipo de página
  const desde = new Date(Date.parse(ontem) - 27 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const porTipo = {};
  for (const [dia, iPagina, , , , cliques] of linhas) {
    if (dia < desde) continue;
    const t = paginas[iPagina].tipo;
    porTipo[t] = (porTipo[t] || 0) + cliques;
  }
  console.log(`${total} cliques no WhatsApp desde ${dados.periodo.inicio}; ${linhas.length} linhas gravadas.`);
  console.log(`Últimos 28 dias por tipo de página: ${JSON.stringify(porTipo)}`);
}

main().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
