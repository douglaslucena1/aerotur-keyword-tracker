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
      urlAlvo: `${SITE}/agencia-de-viagens-${artigoLazer}-${slug}/`,
    });
  }
  return lista;
}

const KEYWORDS = montar();

module.exports = { KEYWORDS, CAPITAIS, SITE };
