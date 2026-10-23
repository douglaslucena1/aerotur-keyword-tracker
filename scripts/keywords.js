// scripts/keywords.js
//
// As keywords do radar: "agência de viagens corporativas em X" e "agência de viagens em X", X = as 27 capitais.
// A preposição e a página-alvo seguem as páginas do site: "no Rio de Janeiro" nas duas famílias; Recife é "em Recife"
// no corporativo (a página já estava indexada assim) e "no Recife" no lazer.

const CAPITAIS = [
  // [slug, nome, UF, região, artigo no corporativo, artigo no lazer]
  ["fortaleza", "Fortaleza", "CE", "Nordeste"],
  ["salvador", "Salvador", "BA", "Nordeste"],
  ["recife", "Recife", "PE", "Nordeste", "em", "no"],
  ["natal", "Natal", "RN", "Nordeste"],
  ["maceio", "Maceió", "AL", "Nordeste"],
  ["joao-pessoa", "João Pessoa", "PB", "Nordeste"],
  ["aracaju", "Aracaju", "SE", "Nordeste"],
  ["teresina", "Teresina", "PI", "Nordeste"],
  ["sao-luis", "São Luís", "MA", "Nordeste"],
  ["sao-paulo", "São Paulo", "SP", "Sudeste"],
  ["rio-de-janeiro", "Rio de Janeiro", "RJ", "Sudeste", "no", "no"],
  ["belo-horizonte", "Belo Horizonte", "MG", "Sudeste"],
  ["vitoria", "Vitória", "ES", "Sudeste"],
  ["curitiba", "Curitiba", "PR", "Sul"],
  ["porto-alegre", "Porto Alegre", "RS", "Sul"],
  ["florianopolis", "Florianópolis", "SC", "Sul"],
  ["brasilia", "Brasília", "DF", "Centro-Oeste"],
  ["goiania", "Goiânia", "GO", "Centro-Oeste"],
  ["cuiaba", "Cuiabá", "MT", "Centro-Oeste"],
  ["campo-grande", "Campo Grande", "MS", "Centro-Oeste"],
  ["manaus", "Manaus", "AM", "Norte"],
  ["belem", "Belém", "PA", "Norte"],
  ["porto-velho", "Porto Velho", "RO", "Norte"],
  ["rio-branco", "Rio Branco", "AC", "Norte"],
  ["boa-vista", "Boa Vista", "RR", "Norte"],
  ["macapa", "Macapá", "AP", "Norte"],
  ["palmas", "Palmas", "TO", "Norte"],
];

const SITE = "https://aerotur.com.br";

// De onde a busca é feita: a própria capital (código de cidade do DataForSEO, "Cidade,State of ...,Brazil").
// Buscas com nome de cidade mudam muito conforme o lugar: "agência de viagens corporativas em salvador" feita
// para o Brasil em geral não traz a Aerotur, e feita de Salvador traz em 3º (teste de 22/10/2026).
const LOCAIS = {
  fortaleza: 1001538,
  salvador: 1001533,
  recife: 1001625,
  natal: 1001662,
  maceio: 1001506,
  "joao-pessoa": 1001622,
  aracaju: 1001715,
  teresina: 1001629,
  "sao-luis": 1001561,
  "sao-paulo": 1001773,
  "rio-de-janeiro": 1001655,
  "belo-horizonte": 1001566,
  vitoria: 1001549,
  curitiba: 1001634,
  "porto-alegre": 1001686,
  florianopolis: 1001706,
  brasilia: 1001541,
  goiania: 1001552,
  cuiaba: 1001602,
  "campo-grande": 1001593,
  manaus: 1001511,
  belem: 1001610,
  "porto-velho": 1001666,
  "rio-branco": 1001504,
  "boa-vista": 1031488,
  macapa: 1001515,
  palmas: 1031867,
};

function montar() {
  const lista = [];
  for (const [slug, nome, uf, regiao, artigoCorp = "em", artigoLazer = "em"] of CAPITAIS) {
    const cidade = nome.toLowerCase();
    lista.push({
      id: `corporativo-${slug}`,
      keyword: `agência de viagens corporativas ${artigoCorp} ${cidade}`,
      familia: "corporativo",
      cidade: nome,
      slug,
      uf,
      regiao,
      local: LOCAIS[slug],
      urlAlvo: `${SITE}/agencia-de-viagens-corporativas-${artigoCorp}-${slug}/`,
    });
    lista.push({
      id: `lazer-${slug}`,
      keyword: `agência de viagens ${artigoLazer} ${cidade}`,
      familia: "lazer",
      cidade: nome,
      slug,
      uf,
      regiao,
      local: LOCAIS[slug],
      urlAlvo: `${SITE}/agencia-de-viagens-${artigoLazer}-${slug}/`,
    });
  }
  return lista;
}

const KEYWORDS = montar();

module.exports = { KEYWORDS, CAPITAIS, LOCAIS, SITE };
