// Sakta Cab — anketas saturs (1:1 no JAUTAJUMI.md)
// Lauku tipi: text, textarea, number, choice, scale (0–10), slider, rank, table
// ev: 0 = parasta pievienošanas zona, 1 = gaidām ekrānuzņēmumu 📎, 2 = zelta pierādījums 📎📎

const SECTIONS = [
  { id: 1,  title: 'Profils & pieredze',                  who: 'atis',   min: 10 },
  { id: 2,  title: 'Naudas realitāte',                    who: 'atis',   min: 20 },
  { id: 3,  title: 'Izmaksas',                            who: 'atis',   min: 15 },
  { id: 4,  title: 'Attiecības ar Bolt',                  who: 'atis',   min: 15 },
  { id: 5,  title: 'Darba diena',                         who: 'atis',   min: 20 },
  { id: 6,  title: 'Konkurenti & pāreja',                 who: 'atis',   min: 15 },
  { id: 7,  title: 'Darbs autoostā',                      who: 'dina', min: 15,
    note: 'Dalies tikai ar to, ko drīksti, — nekādus darba devēja iekšējos datus vai ekrānus, ja tas pārkāpj tavu darba līgumu. Mūs interesē tava pieredze un zināšanas, ne autoostas noslēpumi. Tava autoostas pieredze ir pamats jaunā servisa taksometru dispečerpultij — pie katras atbildes padomā, ko no tās pārnest uz taksometriem.' },
  { id: 8,  title: 'Taksometru plūsma ap autoostu',       who: 'dina', min: 10 },
  { id: 9,  title: 'Tava dispečerpults',                  who: 'dina', min: 15 },
  { id: 10, title: 'Vīzija & nosacījumi',                 who: 'abi',       min: 15 },
  { id: 11, title: 'Brīvais mikrofons + pierādījumu kaste', who: 'abi',     min: 10 },
];

const QUESTIONS = [

  // ===== 1. Profils & pieredze =====
  { id: 'S1-1', s: 1, text: 'Cik gadus strādā par taksometra vadītāju, un kurās pilsētās?',
    fields: [{ k: 'a', t: 'text', ph: 'Piem.: 8 gadi, Rīga un Jūrmala' }] },

  { id: 'S1-2', s: 1, text: 'Ar kurām platformām/firmām esi strādājis (Bolt, Yandex, Forus, Panda, Red Cab, klasiskais radio takso, cits)? Par katru: cik ilgi, kāpēc sāki, kāpēc aizgāji vai paliki.',
    fields: [{ k: 'a', t: 'table', cols: [
      { k: 'p', label: 'Platforma' }, { k: 'ilgi', label: 'Cik ilgi' },
      { k: 'saki', label: 'Kāpēc sāki' }, { k: 'gaji', label: 'Kāpēc aizgāji / paliki' } ] }] },

  { id: 'S1-3', s: 1, text: 'Tavs auto: savs, nomāts no parka vai Bolt noma? Marka, gads, degviela/elektrība. Cik tas tev izmaksā mēnesī?',
    ev: 1, evHint: 'Nomas līgums vai rēķins, ja ir pa rokai.',
    fields: [
      { k: 'a', t: 'text', label: 'Auto un piederība', ph: 'Piem.: nomāts Toyota Corolla 2021, benzīns' },
      { k: 'b', t: 'number', label: 'Izmaksas mēnesī', unit: '€' } ] },

  { id: 'S1-4', s: 1, text: 'Kāds ir tavs juridiskais statuss, un kā tiek maksāti nodokļi?',
    ev: 1, evHint: 'VID EDS izraksts, ja gribi dalīties.',
    fields: [
      { k: 'a', t: 'choice', opts: ['Pašnodarbinātais', 'Mikrouzņēmums', 'SIA', 'Parka darbinieks', 'Cits'] },
      { k: 'b', t: 'textarea', label: 'Kā praktiski notiek nodokļu maksāšana?', rows: 3 } ] },

  { id: 'S1-5', s: 1, text: 'Cik stundas nedēļā tu reāli pavadi pie stūres? Un cik no tām — ar pasažieri salonā?',
    fields: [
      { k: 'a', t: 'number', label: 'Stundas pie stūres nedēļā', unit: 'h' },
      { k: 'b', t: 'number', label: 'No tām ar pasažieri', unit: 'h' } ] },

  { id: 'S1-6', s: 1, text: 'Pastāsti par dienu, kad nolēmi kļūt par taksistu, — un par dienu, kad pirmo reizi to nožēloji.',
    fields: [{ k: 'a', t: 'textarea', rows: 6 }] },

  { id: 'S1-7', s: 1, text: 'Ja rīt savā darbā varētu izmainīt tikai VIENU lietu — kas tā būtu?',
    fields: [{ k: 'a', t: 'textarea', rows: 3 }] },

  // ===== 2. Naudas realitāte =====
  { id: 'S2-1', s: 2, text: 'Tipiska nedēļa skaitļos: bruto ieņēmumi, Bolt ieturētais, tavs neto pirms izmaksām.',
    ev: 2, evHint: 'Bolt nedēļas pārskats — svarīgākais ekrānuzņēmums visā anketā.',
    fields: [
      { k: 'a', t: 'number', label: 'Bruto ieņēmumi nedēļā', unit: '€' },
      { k: 'b', t: 'number', label: 'Bolt ietur', unit: '€' },
      { k: 'c', t: 'number', label: 'Tavs neto pirms izmaksām', unit: '€' } ] },

  { id: 'S2-2', s: 2, text: 'Labākā un sliktākā nedēļa pēdējā gada laikā — skaitļi un kas tās tādas padarīja.',
    ev: 1,
    fields: [
      { k: 'a', t: 'number', label: 'Labākā nedēļa', unit: '€' },
      { k: 'b', t: 'number', label: 'Sliktākā nedēļa', unit: '€' },
      { k: 'c', t: 'textarea', label: 'Kas tās tādas padarīja?', rows: 4 } ] },

  { id: 'S2-3', s: 2, text: 'Komisijas anatomija: uzskaiti visu, ko Bolt reāli ietur vai pievieno (pamata %, pasažiera «platformas maksa», dinamiskās cenas starpība, citas maksas).',
    ev: 1, fields: [{ k: 'a', t: 'textarea', rows: 5 }] },

  { id: 'S2-4', s: 2, text: 'Sameklē braucienu, kur starpība starp pasažiera samaksāto un tevis saņemto ir VISLIELĀKĀ. Cik pasažieris maksāja, cik tu dabūji?',
    ev: 2, evHint: 'Brauciena detaļu ekrāns — zelta pierādījums.',
    fields: [
      { k: 'a', t: 'number', label: 'Pasažieris maksāja', unit: '€' },
      { k: 'b', t: 'number', label: 'Tu saņēmi', unit: '€' } ] },

  { id: 'S2-5', s: 2, text: 'Dinamiskās cenas: vai tu vispār redzi, cik pasažieris maksā? Piemēri, kur pasažierim dārgi, bet tev — parasti.',
    ev: 1, fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S2-6', s: 2, text: 'Bonusi, kvesti, akcijas: kādi ir, cik reāli sasniedzami un vai tie atmaksājas?',
    ev: 1, fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S2-7', s: 2, text: 'Sodi un ieturējumi: par ko Bolt tev ir ieturējis naudu vai samazinājis izmaksu? Konkrētas epizodes ar datumiem.',
    ev: 1, fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S2-8', s: 2, text: 'Cik ātri nauda nonāk tavā kontā? Vai ir bijuši kavējumi?',
    fields: [
      { k: 'a', t: 'textarea', label: 'Kā tas notiek tagad?', rows: 3 },
      { k: 'b', t: 'scale', label: 'Cik svarīga tev būtu tūlītēja izmaksa? (0 — vienalga, 10 — ļoti svarīga)' } ] },

  { id: 'S2-9', s: 2, text: 'Izvēles spēle — atbildi uz katru:',
    fields: [
      { k: 'a', t: 'choice', label: 'a) Kura komisija?', opts: ['15% bez bonusiem', '25% ar bonusu sistēmu'] },
      { k: 'b', t: 'choice', label: 'b) Kurš modelis?', opts: ['10% komisija + €50/mēn. abonements', '20% bez abonementa'] },
      { k: 'c', t: 'slider', label: 'c) Pie kāda komisijas % tu pat neapsvērtu aiziet no Bolt?', min: 0, max: 30, unit: '%' },
      { k: 'd', t: 'choice', label: 'd) Garantēta likme vai procenti?', opts: ['Garantēta stundas likme', 'Procenti no katra brauciena'] },
      { k: 'e', t: 'number', label: 'Kāda stundas likme būtu tava robeža?', unit: '€/h' } ] },

  { id: 'S2-10', s: 2, text: 'Ja jauns serviss maksātu fiksētu «algu» nedēļā par pilnu grafiku — cik tai jābūt, lai tu parakstītos rīt?',
    fields: [{ k: 'a', t: 'number', unit: '€ nedēļā' }] },

  // ===== 3. Izmaksas =====
  { id: 'S3-1', s: 3, text: 'Tavas mēneša izmaksas — aizpildi, cik vari:',
    ev: 1, evHint: 'Čeki vai rēķini, ja pie rokas.',
    fields: [{ k: 'a', t: 'table',
      fixedRows: ['Degviela / uzlāde', 'Auto noma vai kredīts', 'OCTA / KASKO', 'Serviss un riepas', 'Mazgāšana', 'Telefons / internets', 'Licences / nodevas', 'Nodokļi', 'Cits'],
      cols: [ { k: 'eur', label: '€ mēnesī', num: true }, { k: 'note', label: 'Piezīmes' } ] }] },

  { id: 'S3-2', s: 3, text: 'Taksometra licencēšana Rīgā: kā to nokārtoji, cik maksā, cik bieži jāatjauno, kas procesā kaitina visvairāk?',
    ev: 1, fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S3-3', s: 3, text: 'Godīgi (bez vārdiem, anonīmi): kā šoferi tavā lokā reāli kārto nodokļus? Kāpēc tā? Jaunajam servisam jāsaprot realitāte, ne skaistā versija.',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S3-4', s: 3, text: 'Cik procenti no bruto ieņēmumiem tev REĀLI paliek uz rokas pēc visa? Ja precīzi nezini — aptuveni.',
    fields: [{ k: 'a', t: 'slider', min: 0, max: 100, unit: '%' }] },

  { id: 'S3-5', s: 3, text: 'Kura izmaksa tevi kaitina visvairāk — ne obligāti lielākā, bet netaisnīgākā? Kāpēc?',
    fields: [{ k: 'a', t: 'textarea', rows: 3 }] },

  { id: 'S3-6', s: 3, text: 'Ja serviss sarunātu kopīgus līgumus šoferiem — sarindo, kas tev ietaupītu visvairāk (augšā — svarīgākais):',
    fields: [{ k: 'a', t: 'rank', items: ['Degvielas atlaide', 'Lētāka apdrošināšana', 'Riepu serviss ar atlaidi', 'Izdevīgāka auto noma'] }] },

  // ===== 4. Attiecības ar Bolt =====
  { id: 'S4-1', s: 4, text: 'Pēdējā reize, kad tev vajadzēja Bolt atbalstu: kas notika, cik ilgi gaidīji, vai atrisināja?',
    ev: 1, evHint: 'Sarakste ar atbalstu.', fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S4-2', s: 4, text: 'Bloķēšana / deaktivizācija — tev vai kolēģiem: par ko, kā varēja apstrīdēt, cik ilgi tas vilkās? Epizodes ar datumiem.',
    ev: 1, fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S4-3', s: 4, text: 'Reitings un atsauksmes: kā tās reāli ietekmē tavu darbu? Netaisnīgu atsauksmju piemēri.',
    ev: 1, fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S4-4', s: 4, text: 'Kad Bolt pēdējo reizi mainīja noteikumus vai komisiju bez īsta brīdinājuma? Kā tu to uzzināji?',
    ev: 1, evHint: 'Paziņojumi lietotnē vai e-pastā.', fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S4-5', s: 4, text: 'LOMU MAIŅA: tu esi Bolt Latvijas vadītājs uz vienu dienu. Tev jānotur šoferi, bet papildu budžeta nav. Ko tu darītu? Un ko tas atklāj par viņu vājajām vietām?',
    fields: [{ k: 'a', t: 'textarea', rows: 5 }] },

  { id: 'S4-6', s: 4, text: 'Uzraksti īsu sludinājumu (3–5 teikumi), ar ko jauns serviss pārvilinātu šoferus no Bolt. Kas tajā OBLIGĀTI jāsola?',
    fields: [{ k: 'a', t: 'textarea', rows: 5 }] },

  { id: 'S4-7', s: 4, text: 'Kā Bolt mēģinātu tevi noturēt, ja uzzinātu, ka aizej? Kas no tā tevi tiešām apturētu?',
    fields: [{ k: 'a', t: 'textarea', rows: 3 }] },

  { id: 'S4-8', s: 4, text: 'Pierādījumu kaste par Bolt: iemet šeit visus ekrānuzņēmumus ar netaisnībām, kas sakrājušies, un katram īsu komentāru.',
    ev: 2, evHint: 'Jebkas, kas rāda netaisnību, — jo vairāk, jo labāk.',
    fields: [{ k: 'a', t: 'textarea', label: 'Komentāri par pievienoto', rows: 4 }] },

  // ===== 5. Darba diena =====
  { id: 'S5-1', s: 5, text: 'DIENAS REKONSTRUKCIJA: izstāsti savu pēdējo pilno darba dienu stundu pa stundai — kur biji, cik braucienu, cik gaidīji, cik nopelnīji, kas nokaitināja.',
    ev: 1, evHint: 'Dienas pārskats no lietotnes.',
    fields: [{ k: 'a', t: 'table', cols: [
      { k: 'laiks', label: 'Laiks' }, { k: 'vieta', label: 'Kur biji' },
      { k: 'br', label: 'Braucieni' }, { k: 'eur', label: 'Ieņēmumi €', num: true },
      { k: 'note', label: 'Piezīmes' } ] }] },

  { id: 'S5-2', s: 5, text: 'Tava «zelta karte»: kur un kad Rīgā ir nauda? Lidosta, autoosta, stacija, Vecrīga, naktsklubi, tirdzniecības centri, pasākumi…',
    fields: [{ k: 'a', t: 'textarea', rows: 5 }] },

  { id: 'S5-3', s: 5, text: 'Tukšie kilometri: cik liela daļa brauciena ir «pa tukšo» līdz pasažierim?',
    fields: [
      { k: 'a', t: 'slider', min: 0, max: 100, unit: '%' },
      { k: 'b', t: 'textarea', label: 'Kur tas notiek visbiežāk?', rows: 2 } ] },

  { id: 'S5-4', s: 5, text: 'Lidostas un autoostas rindas: kā tas reāli darbojas? Cik ilgi gaidi, vai pastāv sava «sistēma» vai kārtība starp šoferiem?',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S5-5', s: 5, text: 'Nakts pret dienu, darbadienas pret brīvdienām: kur lielāka peļņa uz stundu? Kāpēc tu brauc tad, kad brauc?',
    fields: [{ k: 'a', t: 'textarea', rows: 3 }] },

  { id: 'S5-6', s: 5, text: 'Kuri pasažieri brauc ar Bolt, kuri ar klasisko takso, kuri ar citiem? Tūristi pret vietējiem — ko tu redzi?',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S5-7', s: 5, text: 'Drošība: bīstamākā situācija, kas tev bijusi, un ko lietotne tajā brīdī varēja izdarīt labāk (trauksmes poga, ieraksts, pasažiera verifikācija)?',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S5-8', s: 5, text: 'Kādu pieprasījumu tu redzi uz ielas, ko NEVIENS serviss vēl neapkalpo? (Piemēri: slimnīcas naktī, viesnīcu līgumi, bērnu sēdeklīši, lauku reisi…)',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  // ===== 6. Konkurenti & pāreja =====
  { id: 'S6-1', s: 6, text: 'Kas šobrīd vispār darbojas Rīgā/Latvijā un ko šoferi runā par katru?',
    fields: [{ k: 'a', t: 'table', cols: [
      { k: 's', label: 'Serviss' }, { k: 'kom', label: 'Komisija (cik zini)' },
      { k: 'plus', label: 'Plusi' }, { k: 'minus', label: 'Mīnusi' } ] }] },

  { id: 'S6-2', s: 6, text: 'Vai esi mēģinājis braukt paralēli divās platformās? Kā gāja — praktiski un finansiāli?',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S6-3', s: 6, text: 'Kāpēc, tavuprāt, neviens vēl nav izspiedis Bolt no Latvijas? Kas viņus tur virsotnē — pasažieru masa, cena, ieradums, nauda?',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S6-4', s: 6, text: 'Sarindo, kas tevi pārvilktu uz jaunu servisu (augšā — svarīgākais):',
    fields: [{ k: 'a', t: 'rank', items: ['Zemāka komisija', 'Tūlītēja izmaksa', 'Cilvēcisks atbalsts latviski', 'Bez sodu sistēmas', 'Līdzīpašnieka daļa (kooperatīvs)', 'Garantēts minimums', 'Labāka lietotne', 'Vietējais uzņēmums'] }] },

  { id: 'S6-5', s: 6, text: 'Kas tev būtu jāredz vai jāsaņem, lai tu PERSONĪGI atvestu 10 kolēģus?',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S6-6', s: 6, text: 'Cik šoferus tu pazīsti personīgi, kuri būtu gatavi mainīt platformu jau tagad?',
    fields: [{ k: 'a', t: 'number', unit: 'šoferi' }] },

  { id: 'S6-7', s: 6, text: 'Izvēles spēle: jauns serviss, bet pirmos 3 mēnešus pasažieru maz. Brauktu par 0% komisiju + stundas garantiju?',
    fields: [
      { k: 'a', t: 'choice', opts: ['Jā, brauktu', 'Nē', 'Atkarīgs no garantijas lieluma'] },
      { k: 'b', t: 'number', label: 'Cik lielai garantijai jābūt?', unit: '€/h' } ] },

  { id: 'S6-8', s: 6, text: 'Kooperatīvs: vai tu ieguldītu €500–2000, lai būtu servisa līdzīpašnieks ar, piemēram, 5% komisiju uz mūžu?',
    fields: [
      { k: 'a', t: 'choice', opts: ['Jā, ieguldītu', 'Varbūt', 'Nē'] },
      { k: 'b', t: 'textarea', label: 'Kāpēc jā vai nē? Kas šajā idejā biedē?', rows: 4 } ] },

  // ===== 7. Darbs autoostā =====
  { id: 'S7-1', s: 7, text: 'Kas īsti ir tavs darbs? Izstāsti savu maiņu stundu pa stundai.',
    fields: [{ k: 'a', t: 'textarea', rows: 6 }] },

  { id: 'S7-2', s: 7, text: 'Kādas sistēmas/programmas tu lieto ikdienā, un ko par tām domā? Kas tajās labs, kas — no pagājušā gadsimta? Ko no tām paņemtu — un ko tieši nepaņemtu — uz taksometru dispečerpulti?',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S7-3', s: 7, text: 'Cik reisu un aptuveni cik cilvēku dienā iet caur tavu darba vietu? Kad ir pīķi?',
    fields: [{ k: 'a', t: 'textarea', rows: 3 }] },

  { id: 'S7-4', s: 7, text: 'Kas tavā darbā regulāri lūst vai ir muļķīgi neefektīvs? Ko tu salabotu pirmo?',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S7-5', s: 7, text: 'Kā tu sazinies ar šoferiem un pārvadātājiem — rācija, telefons, sistēma? Kas tur strādā un kas nestrādā? Kā tas pats izskatītos ar taksometru šoferiem?',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S7-6', s: 7, text: 'Pēdējais lielais juceklis (sniegputenis, avārija, masveida kavējumi): kā tu to atrisināji? Ko tas iemācīja?',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S7-7', s: 7, text: 'LOMU MAIŅA: tev iedod pilnīgu varu pār autoostu uz mēnesi. Ko tu izdari, lai viss ietu gludāk?',
    fields: [{ k: 'a', t: 'textarea', rows: 5 }] },

  // ===== 8. Taksometru plūsma ap autoostu =====
  { id: 'S8-1', s: 8, text: 'Kā taksometri pie autoostas dabū pasažierus? Rindas, oficiālās vietas, «savējie», uzmācīgie piedāvātāji — kā tas reāli izskatās?',
    fields: [{ k: 'a', t: 'textarea', rows: 5 }] },

  { id: 'S8-2', s: 8, text: 'Vai autoostai ir kāda oficiāla kārtība vai līgumi ar takso firmām? Kā tas darbojas praksē?',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S8-3', s: 8, text: 'Par ko pasažieri visbiežāk sūdzas vai jautā saistībā ar takso pie autoostas? (Cena, apkrāpšana, valoda, drošība…)',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S8-4', s: 8, text: 'Ja jauns serviss gribētu OFICIĀLU sadarbību ar autoostu (QR kods pie izejas, garantēta cena, takso rinda ar noteikumiem) — pie kā jāiet, kas to izlemj, un kas autoostai būtu vajadzīgs pretī?',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S8-5', s: 8, text: 'Autobusu pienākšanas laiki ir takso pieprasījuma viļņi. Vai šie dati ir publiski pieejami? Kā gudrs serviss tos izmantotu?',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  // ===== 9. Tava dispečerpults =====
  { id: 'S9-1', s: 9, text: 'Tu būsi jaunā servisa dispečere — UZPROJEKTĒ savu nākotnes darba ekrānu: kas tajā redzams (karte ar auto, pasūtījumu rinda, čats ar šoferiem, trauksmes)? Apraksti — vai uzzīmē uz papīra un nofotografē.',
    ev: 2, evHint: 'Zīmējums uz papīra ir lieliska atbilde — nofotografē un iemet šeit!',
    fields: [{ k: 'a', t: 'textarea', rows: 6 }] },

  { id: 'S9-2', s: 9, text: 'Ja lietotne visu automatizē — kāda paliek cilvēka-dispečera loma? Ko cilvēks vienmēr izdarīs labāk par algoritmu?',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S9-3', s: 9, text: 'Cik liela daļa Latvijā vēl grib PIEZVANĪT, nevis spaidīt lietotni? Kuri tie ir (vecāki cilvēki, lauki, viesnīcas, biznesa klienti)? Vai telefona dispečere ir jaunā servisa trumpis pret Bolt?',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S9-4', s: 9, text: 'Izvēles spēle: pasūtījumus sadala algoritms automātiski VAI dispečerei ir vara pārlabot?',
    fields: [
      { k: 'a', t: 'choice', opts: ['Algoritms automātiski', 'Dispečere var pārlabot', 'Hibrīds — robeža jāapraksta'] },
      { k: 'b', t: 'textarea', label: 'Kur novilkt robežu?', rows: 3 } ] },

  { id: 'S9-5', s: 9, text: 'Tu būsi jaunā servisa dispečere. Kā tu to redzi praktiski — un kas tev vajadzīgs, lai šo darbu darītu labi?',
    fields: [
      { k: 'a', t: 'choice', label: 'Kā sāktu?', opts: ['Pilna slodze uzreiz', 'Vakaros / daļēji', 'Sākumā paralēli darbam autoostā'] },
      { k: 'b', t: 'textarea', label: 'Grafiks, atalgojums, tehnika, apmācība — ko tev vajag no pirmās dienas?', rows: 4 } ] },

  // ===== 10. Vīzija & nosacījumi =====
  { id: 'S10-1', s: 10, text: 'Kāds komisijas % tev šķiet GODĪGS par to, ko platforma reāli dara?',
    fields: [
      { k: 'a', t: 'slider', min: 0, max: 30, unit: '%' },
      { k: 'b', t: 'textarea', label: 'Kāpēc tieši tik?', rows: 3 } ] },

  { id: 'S10-2', s: 10, text: 'Vai braucieni Rīgā pasažierim ir par lētu vai par dārgu? Ja jaunais serviss šoferim maksā vairāk, bet pasažierim tikpat — no kā jāsastāv starpībai?',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S10-3', s: 10, text: 'Sarindo, kāpēc pasažieris izvēlētos jauno servisu (augšā — pārliecinošākais):',
    fields: [{ k: 'a', t: 'rank', items: ['Lētāk', 'Vietējais Latvijas uzņēmums', 'Laimīgāki šoferi = labāks serviss', 'Drošāk', 'Var gan zvanīt, gan lietotne', 'Nauda paliek Latvijā'] }] },

  { id: 'S10-4', s: 10, text: 'Kā jauno servisu saukt un kādam tam jāizskatās, lai latvietis tam uzticētos? Brīvas idejas — nosaukumi, krāsas, tēls.',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S10-5', s: 10, text: 'Nosauc trīs galvenos iemeslus, kāpēc šis plāns varētu izgāzties. Godīgi.',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S10-6', s: 10, text: 'BURVJU NŪJIŅA: ir pagājuši 3 gadi, viss ir izdevies. Apraksti savu parastu otrdienu šajā jaunajā dzīvē.',
    fields: [{ k: 'a', t: 'textarea', rows: 5 }] },

  { id: 'S10-7', s: 10, text: 'Kas Latvijā varētu būt sabiedrotie — šoferu biedrības, pašvaldība, mediji, juristi, kāds cits? Vai kādu pazīsti personīgi?',
    fields: [{ k: 'a', t: 'textarea', rows: 4 }] },

  { id: 'S10-8', s: 10, text: 'Ja pierādījumi sakrājas: vai tu būtu gatavs/gatava parakstīt iesniegumu Konkurences padomei vai runāt ar žurnālistu?',
    fields: [
      { k: 'a', t: 'choice', opts: ['Jā, ar vārdu', 'Jā, bet anonīmi', 'Nē'] },
      { k: 'b', t: 'textarea', label: 'Piebilde', rows: 2 } ] },

  // ===== 11. Brīvais mikrofons + pierādījumu kaste =====
  { id: 'S11-1', s: 11, text: 'Ko Linards nepajautāja, bet viņam VAJADZĒJA pajautāt? Atbildi arī uz to.',
    fields: [{ k: 'a', t: 'textarea', rows: 5 }] },

  { id: 'S11-2', s: 11, text: 'Izstāsti vienu stāstu, kas vislabāk raksturo tavu darbu — ar Bolt vai autoostā.',
    fields: [{ k: 'a', t: 'textarea', rows: 6 }] },

  { id: 'S11-3', s: 11, text: 'LIELĀ PIERĀDĪJUMU KASTE: iemet šeit pilnīgi visus ekrānuzņēmumus, kas šķiet svarīgi un citur neiederējās, un uzraksti pa teikumam — kas tas ir.',
    ev: 2, evHint: 'Šeit der VISS — jo vairāk materiāla, jo stiprāks plāns.',
    fields: [{ k: 'a', t: 'textarea', label: 'Kas ir pievienotajos failos?', rows: 4 }] },

  { id: 'S11-4', s: 11, text: 'Cik gatavs/gatava tu esi REĀLI iesaistīties šajā projektā?',
    fields: [
      { k: 'a', t: 'scale', label: '0 — nemaz, 10 — pilnībā iekšā' },
      { k: 'b', t: 'textarea', label: 'Kas šo skaitli paceltu par diviem punktiem?', rows: 3 } ] },
];

const WHO = {
  atis: { n: 'Atis', dat: 'Atim',  ico: '🚕' },
  dina: { n: 'Dina', dat: 'Dinai', ico: '☎️' },
  abi:  { n: 'Abi',  dat: 'Abiem', ico: '👫' },
};

const INTRO = {
  greet: 'Sveiki, Ati un Dina',
  body: [
    'Šī anketa ir pirmais solis, lai saprastu, kā Latvijā izveidot taksometru servisu ar godīgākiem nosacījumiem šoferiem nekā Bolt. Jūsu atbildes ir izpētes pamats — jo godīgāk un detalizētāk, jo stiprāks plāns. Šeit nav pareizu atbilžu, ir tikai jūsu pieredze.',
  ],
  points: [
    'Anketa ir viena un kopīga: sadaļas 1–6 ir Atim, 7–9 Dinai, 10–11 abiem. Pie katra jautājuma redzams, kurš atbild, — kopīgajās sadaļās to var atzīmēt: Atis, Dina vai abi.',
    'Atbildes saglabājas automātiski — varat aizvērt lapu un turpināt citā vakarā no tās pašas vietas.',
    'Pie katra jautājuma var pievilkt ekrānuzņēmumus vai failus (vienkārši iemetiet tos laukā).',
    'Katru jautājumu drīkst izlaist.',
    'Dati glabājas Linarda privātajā Google Drive un bez jūsu piekrišanas nekur tālāk neiet.',
    'Ja ekrānuzņēmumā redzami pasažieru vārdi, adreses vai telefoni — aizklājiet tos pirms ielikšanas.',
    'Linards atbildes pārskatīs: pie apstiprinātajām parādīsies ✓, pie citām — komentārs ar lūgumu precizēt.',
  ],
};

const OUTRO = 'Jūsu atbildes ir saglabātas. Linards tās pārskatīs — ienāciet vēlāk: pie atbildēm parādīsies ✓ vai jautājumi precizēšanai. Šī anketa ir pirmais solis; nākamais — plāns.';
