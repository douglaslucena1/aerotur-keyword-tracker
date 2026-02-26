// scripts/collect.js
//
// Chama a API DataForSEO SERP para cada keyword, extrai resultados orgânicos
// e salva em docs/data/rankings.json.
//
// Variáveis de ambiente necessárias:
//   DATAFORSEO_LOGIN    - E-mail da conta DataForSEO
//   DATAFORSEO_PASSWORD - Senha da API DataForSEO
//
// Uso: node scripts/collect.js

const fs = require("fs");
const path = require("path");

// ─── Configuração ────────────────────────────────────────────
const CONFIG = {
  domain: "aerotur.com.br",
  keywords: [
    "agência de viagens em natal",
    "agência de viagens corporativas em natal",
  ],
  locationCode: 2076, // Brasil
  languageCode: "pt",
  device: "desktop",
  apiUrl:
    "https://api.dataforseo.com/v3/serp/google/organic/live/advanced",
  dataFile: path.join(__dirname, "..", "docs", "data", "rankings.json"),
};

// ─── Main ────────────────────────────────────────────────────
async function main() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    console.error(
      "ERRO: DATAFORSEO_LOGIN e DATAFORSEO_PASSWORD precisam estar definidos"
    );
    process.exit(1);
  }

  const authHeader =
    "Basic " + Buffer.from(`${login}:${password}`).toString("base64");

  const today = new Date().toISOString().slice(0, 10); // "2026-02-26"

  // Carregar dados existentes ou criar estrutura vazia
  let data;
  try {
    data = JSON.parse(fs.readFileSync(CONFIG.dataFile, "utf-8"));
  } catch {
    data = { lastUpdated: null, keywords: CONFIG.keywords, collections: [] };
  }

  // Manter lista de keywords atualizada
  data.keywords = CONFIG.keywords;

  for (const keyword of CONFIG.keywords) {
    console.log(`Buscando: "${keyword}"...`);

    const payload = [
      {
        keyword,
        location_code: CONFIG.locationCode,
        language_code: CONFIG.languageCode,
        device: CONFIG.device,
        os: "windows",
        depth: 100,
      },
    ];

    try {
      const response = await fetch(CONFIG.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify(payload),
      });

      const json = await response.json();

      if (json.status_code !== 20000) {
        console.error(
          `Erro API para "${keyword}": ${json.status_message}`
        );
        continue;
      }

      // Extrair resultados orgânicos
      const organics = [];
      for (const task of json.tasks || []) {
        for (const result of task.result || []) {
          for (const item of result.items || []) {
            if (item.type === "organic") {
              organics.push(item);
            }
          }
        }
      }

      // Encontrar posição do domínio
      let sitePosition = 0;
      let siteUrl = "";
      for (const item of organics) {
        if (item.url && item.url.includes(CONFIG.domain)) {
          sitePosition = item.rank_group || item.rank_absolute || 0;
          siteUrl = item.url;
          break;
        }
      }

      // Montar top 10
      const top10 = organics.slice(0, 10).map((item, i) => ({
        position: item.rank_group || item.rank_absolute || i + 1,
        domain: item.domain || "",
        url: item.url || "",
        title: item.title || "",
      }));

      // Adicionar entrada
      data.collections.push({
        date: today,
        keyword,
        sitePosition,
        siteUrl,
        totalOrganicResults: organics.length,
        top10,
      });

      console.log(
        `  Posição: ${sitePosition || "Não encontrado"} | Top 10 coletado`
      );
    } catch (err) {
      console.error(`Exceção para "${keyword}": ${err.message}`);
    }

    // Pausa entre requests (2s)
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Atualizar timestamp e salvar
  data.lastUpdated = new Date().toISOString();

  fs.mkdirSync(path.dirname(CONFIG.dataFile), { recursive: true });
  fs.writeFileSync(CONFIG.dataFile, JSON.stringify(data, null, 2), "utf-8");

  console.log(`Dados salvos em ${CONFIG.dataFile}`);
}

main();
