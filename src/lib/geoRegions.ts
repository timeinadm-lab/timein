// Regiões metropolitanas e microrregiões do Brasil
// Cada entrada: [estado, [cidades da região]]
// Usado para calcular proximidade no match de candidatos

const REGIONS: [string, string[]][] = [
  // ── SP ──────────────────────────────────────────────────────────
  ['SP', ['são paulo','osasco','guarulhos','mogi das cruzes','suzano','itaquaquecetuba','carapicuíba','barueri','santana de parnaíba','cotia','taboão da serra','embu das artes','diadema','são bernardo do campo','santo andré','são caetano do sul','mauá','ribeirão pires']],
  ['SP', ['campinas','sumaré','hortolândia','americana','santa bárbara d\'oeste','indaiatuba','valinhos','vinhedo','paulínia','cosmópolis','engenheiro coelho','holambra','artur nogueira','jaguariúna','pedreira','nova odessa']],
  ['SP', ['piracicaba','capivari','rafard','mombuca','saltinho','rio das pedras','charqueada','santa maria da serra','iracemápolis','limeira']],
  ['SP', ['sorocaba','votorantim','salto','itu','porto feliz','boituva','cerquilho','tietê','tatuí','cabreúva','laranjal paulista']],
  ['SP', ['são josé dos campos','taubaté','jacareí','pindamonhangaba','guaratinguetá','lorena','aparecida','caçapava','tremembé','roseira']],
  ['SP', ['santos','são vicente','guarujá','cubatão','praia grande','mongaguá','itanhaém','peruíbe','bertioga']],
  ['SP', ['ribeirão preto','sertãozinho','jaboticabal','barretos','bebedouro','são joaquim da barra','franca','brodowski','jardinópolis']],
  ['SP', ['bauru','marília','jaú','lins','ourinhos','botucatu','pederneiras','agudos']],
  ['SP', ['são josé do rio preto','catanduva','votuporanga','fernandópolis','mirassol','bady bassitt','cedral']],
  ['SP', ['araçatuba','birigui','penápolis','andradina','ilha solteira']],
  ['SP', ['presidente prudente','marabá paulista','rancharia','pirapozinho','regente feijó']],
  ['SP', ['araraquara','são carlos','matão','ibaté','descalvado']],

  // ── RJ ──────────────────────────────────────────────────────────
  ['RJ', ['rio de janeiro','niterói','são gonçalo','duque de caxias','nova iguaçu','belford roxo','nilópolis','mesquita','queimados','japeri','itaguaí','seropédica','paracambi']],
  ['RJ', ['campos dos goytacazes','macaé','rio das ostras','cabo frio','arraial do cabo','búzios','armação dos búzios']],
  ['RJ', ['petrópolis','nova friburgo','teresópolis','volta redonda','barra mansa','resende','itatiaia']],

  // ── MG ──────────────────────────────────────────────────────────
  ['MG', ['belo horizonte','contagem','betim','ribeirão das neves','santa luzia','ibirité','sabará','nova lima','vespasiano','lagoa santa','pedro leopoldo','sete lagoas']],
  ['MG', ['uberlândia','uberaba','patos de minas','araxá','ituiutaba']],
  ['MG', ['juiz de fora','barbacena','muriaé','carangola','leopoldina']],
  ['MG', ['montes claros','bocaiuva','pirapora','janaúba','januária']],
  ['MG', ['governador valadares','ipatinga','coronel fabriciano','timóteo','caratinga']],

  // ── RS ──────────────────────────────────────────────────────────
  ['RS', ['porto alegre','canoas','gravataí','viamão','cachoeirinha','alvorada','sapucaia do sul','são leopoldo','novo hamburgo','esteio','guaíba']],
  ['RS', ['caxias do sul','bento gonçalves','garibaldi','farroupilha','flores da cunha']],
  ['RS', ['pelotas','rio grande','capão do leão','morro redondo']],
  ['RS', ['santa maria','cachoeira do sul','são gabriel','itaqui']],

  // ── PR ──────────────────────────────────────────────────────────
  ['PR', ['curitiba','são josé dos pinhais','colombo','almirante tamandaré','pinhais','fazenda rio grande','araucária','campo largo','campo magro','mandirituba']],
  ['PR', ['londrina','cambé','ibiporã','rolândia','arapongas','apucarana']],
  ['PR', ['maringá','sarandi','paiçandu','mandaguaçu','marialva','mandaguari']],
  ['PR', ['foz do iguaçu','cascavel','toledo','medianeira','santa terezinha de itaipu']],

  // ── BA ──────────────────────────────────────────────────────────
  ['BA', ['salvador','lauro de freitas','camaçari','simões filho','dias d\'ávila','candeias','madre de deus','são francisco do conde']],
  ['BA', ['feira de santana','serrinha','alagoinhas','entre rios','catu']],
  ['BA', ['vitória da conquista','jequié','itapetinga','brumado','guanambi']],
  ['BA', ['ilhéus','itabuna','uruçuca','coaraci','buerarema']],

  // ── PE ──────────────────────────────────────────────────────────
  ['PE', ['recife','caruaru','olinda','jaboatão dos guararapes','paulista','camaragibe','cabo de santo agostinho','ipojuca','igarassu','abreu e lima','araçoiaba']],

  // ── CE ──────────────────────────────────────────────────────────
  ['CE', ['fortaleza','caucaia','maracanaú','maranguape','pacatuba','eusébio','aquiraz','horizonte','juazeiro do norte','crato','barbalha']],

  // ── GO ──────────────────────────────────────────────────────────
  ['GO', ['goiânia','aparecida de goiânia','trindade','senador canedo','goianira','anápolis','hidrolândia','guapó','bela vista de goiás','abadia de goiás']],

  // ── DF/GO ────────────────────────────────────────────────────────
  ['DF', ['brasília','ceilândia','taguatinga','samambaia','planaltina','gama','sobradinho','luziânia','águas lindas de goiás','valparaíso de goiás','novo gama','formosa']],

  // ── AM ──────────────────────────────────────────────────────────
  ['AM', ['manaus','iranduba','manacapuru','careiro','rio preto da eva']],

  // ── PA ──────────────────────────────────────────────────────────
  ['PA', ['belém','ananindeua','marituba','benevides','castanhal','santa barbara do pará']],

  // ── MA ──────────────────────────────────────────────────────────
  ['MA', ['são luís','são josé de ribamar','paço do lumiar','raposa','timon','imperatriz']],

  // ── SC ──────────────────────────────────────────────────────────
  ['SC', ['florianópolis','são josé','palhoça','biguaçu','governador celso ramos','joinville','jaraguá do sul','blumenau','itajaí','balneário camboriú','navegantes']],

  // ── ES ──────────────────────────────────────────────────────────
  ['ES', ['vitória','vila velha','cariacica','serra','viana','guarapari','anchieta']],

  // ── SE ──────────────────────────────────────────────────────────
  ['SE', ['aracaju','nossa senhora do socorro','são cristóvão','barra dos coqueiros','laranjeiras','maruim']],

  // ── AL ──────────────────────────────────────────────────────────
  ['AL', ['maceió','rio largo','marechal deodoro','satuba','coqueiro seco','paripueira']],

  // ── RN ──────────────────────────────────────────────────────────
  ['RN', ['natal','parnamirim','mossoró','são gonçalo do amarante','extremoz','macaíba','ceará-mirim']],

  // ── PB ──────────────────────────────────────────────────────────
  ['PB', ['joão pessoa','campina grande','santa rita','bayeux','cabedelo','conde','caaporã']],

  // ── PI ──────────────────────────────────────────────────────────
  ['PI', ['teresina','timon','união','beneditinos','altos','demerval lobão']],

  // ── MT / MS ─────────────────────────────────────────────────────
  ['MT', ['cuiabá','várzea grande','lucas do rio verde','sorriso','rondonópolis','sinop']],
  ['MS', ['campo grande','dourados','três lagoas','corumbá','ponta porã']],

  // ── TO / AC / RO / RR / AP ──────────────────────────────────────
  ['TO', ['palmas','porto nacional','paraíso do tocantins','guaraí']],
  ['RO', ['porto velho','ji-paraná','ariquemes','vilhena','cacoal']],
]

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

// Returns a region key (state + index) for a given city/state pair, or null
export function getCityRegion(city: string, state: string): string | null {
  const nc = normalize(city)
  const ns = normalize(state)
  for (let i = 0; i < REGIONS.length; i++) {
    const [rState, cities] = REGIONS[i]
    if (normalize(rState) !== ns) continue
    if (cities.some(c => normalize(c) === nc || nc.includes(normalize(c)) || normalize(c).includes(nc))) {
      return `${rState}-${i}`
    }
  }
  return null
}
