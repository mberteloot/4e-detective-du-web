// Tests automatiques du site dans un navigateur simulé (jsdom).
//
//   node tester.js <dbip-country-lite-AAAA-MM.csv.gz>
//
// Vérifie : la base IP encodée (comparée au CSV d'origine), les cas d'IP
// particuliers, le parcours DNS → IP → pari → carnet, et le mode secours.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = path.join(__dirname, '..', 'docs');
let echecs = 0;
function verifier(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { echecs++; console.log('  ÉCHEC  ' + message); }
}

function chargerSite(fetchSimule) {
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8').replace(/<script src="[^"]+"><\/script>/g, '');
  const consoleMuette = new VirtualConsole(); // masque « canvas non implémenté » (normal dans jsdom)
  const dom = new JSDOM(html, { virtualConsole: consoleMuette, runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://exemple.github.io/' });
  const w = dom.window;
  w.fetch = fetchSimule;
  w.Element.prototype.scrollIntoView = () => {};
  w.SVGElement.prototype.getTotalLength = () => 100;
  w.confirm = () => true;
  for (const f of ['data/ip-pays.js', 'data/carte.js', 'data/hors-ligne.js', 'app.js']) {
    w.eval(fs.readFileSync(path.join(SITE, f), 'utf8'));
  }
  return w;
}

const attendre = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const texte = (w, id) => w.document.getElementById(id).textContent.replace(/\s+/g, ' ');

function reponseDns(ips, alias = []) {
  return {
    ok: true,
    json: async () => ({
      Status: 0,
      Answer: [...alias.map((a) => ({ type: 5, data: a + '.' })), ...ips.map((ip) => ({ type: 1, data: ip }))],
    }),
  };
}

(async () => {
  // ---------------------------------------------------------------- base IP
  console.log('Base IP comparée au CSV');
  const w0 = chargerSite(async () => { throw new Error('hors ligne'); });
  // on retrouve paysDeIP via l'interface : saisie IP puis lecture du pays affiché serait lent,
  // donc on recalcule ici avec les mêmes données et on compare à quelques affichages réels.
  const lignes = zlib.gunzipSync(fs.readFileSync(process.argv[2])).toString().split('\n').filter((l) => l && !l.includes(':'));
  const versEntier = (ip) => ip.split('.').reduce((a, o) => a * 256 + Number(o), 0);
  const plages = lignes.map((l) => { const [d, f, c] = l.split(','); return [versEntier(d), versEntier(f), c.trim()]; });
  const versIP = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

  let erreursBase = 0;
  const tirages = 3000;
  const nomsFr = new w0.Intl.DisplayNames(['fr'], { type: 'region' });
  for (let i = 0; i < tirages; i++) {
    const plage = plages[Math.floor(Math.random() * plages.length)];
    const ip = plage[0] + Math.floor(Math.random() * (plage[1] - plage[0] + 1));
    const [a, b] = [ip >>> 24, (ip >>> 16) & 255];
    if (a === 10 || a === 127 || a === 0 || a >= 224 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) ||
        (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || plage[2] === 'ZZ') continue;
    w0.document.getElementById('saisie-ip').value = versIP(ip);
    w0.document.getElementById('form-ip').dispatchEvent(new w0.Event('submit', { cancelable: true }));
    w0.document.getElementById('pari-passer').click();
    const affiche = w0.document.querySelector('.fiche-pays h3');
    const attendu = plage[2] === 'HK' ? 'Hong Kong' : nomsFr.of(plage[2]);
    if (!affiche || (affiche.textContent !== attendu && affiche.textContent !== 'Pays ' + plage[2])) {
      if (erreursBase++ < 5) console.log('    ', versIP(ip), 'attendu', plage[2], 'affiché', affiche && affiche.textContent);
    }
  }
  verifier(erreursBase === 0, `${tirages} IP tirées au hasard → pays identique au CSV (${erreursBase} erreurs)`);

  // ------------------------------------------------------------- cas d'IP
  console.log('Cas particuliers d\'IP');
  const w = chargerSite(async (url) => {
    if (url.includes('ipify')) return { ok: true, json: async () => ({ ip: '8.8.8.8' }) };
    if (url.includes('alibaba.com')) return reponseDns(['47.246.131.198', '47.246.137.105'], ['alibaba.com.gds.alibabadns.com']);
    if (url.includes('existepas')) return { ok: true, json: async () => ({ Status: 3 }) };
    if (url.includes('name=gov.hk')) return { ok: true, json: async () => ({ Status: 0 }) };
    if (url.includes('www.gov.hk')) return reponseDns(['43.159.109.162']);
    return reponseDns(['193.57.128.103']);
  });
  const d = w.document;
  await attendre(50);
  console.log('Toi sur Internet');
  verifier(/8\.8\.8\.8/.test(texte(w, 'moi')) && /États-Unis/.test(texte(w, 'moi')), 'IP de l\'élève et pays affichés : ' + texte(w, 'moi').slice(0, 90));
  verifier(/serveur intermédiaire/.test(texte(w, 'moi')), 'pays différent de HK → explication proxy / VPN');
  verifier(/placé grâce à ton adresse IP \(8\.8\.8\.8\)/.test(texte(w, 'legende-carte')), 'légende de la carte : point jaune placé grâce à l\'IP');
  const centreUS = w.CARTE.centres.US;
  verifier(Number(d.getElementById('moi-point').getAttribute('cx')) === centreUS[0], 'point jaune déplacé au centre des États-Unis');
  d.getElementById('localiser-moi').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  d.getElementById('pari-passer').click();
  verifier(/C'est toi/.test(texte(w, 'resultat-ip')), 'bouton « Localiser mon adresse » → « C\'est toi ! »');
  const saisirIP = (ip) => {
    d.getElementById('saisie-ip').value = ip;
    d.getElementById('form-ip').dispatchEvent(new w.Event('submit', { cancelable: true }));
    return texte(w, 'resultat-ip');
  };
  verifier(/4 nombres/.test(saisirIP('1.2.3')), '« 1.2.3 » → il faut 4 nombres');
  verifier(/0 et 255/.test(saisirIP('300.1.1.1')) && d.querySelector('.octet.faux'), '« 300.1.1.1 » → nombre trop grand, en rouge');
  verifier(/privée/.test(saisirIP('192.168.1.12')), '192.168.1.12 → adresse privée');
  verifier(/ton propre ordinateur/.test(saisirIP('127.0.0.1')), '127.0.0.1 → ton propre ordinateur');
  verifier(/IPv6/.test(saisirIP('2001:db8::1')), 'IPv6 → message explicatif');
  verifier(/réservée/.test(saisirIP('239.1.1.1')), '239.1.1.1 → adresse réservée');
  saisirIP('104.18.32.47');
  d.getElementById('pari-passer').click();
  verifier(/Cloudflare/.test(texte(w, 'resultat-ip')), '104.18.32.47 → explication Cloudflare (anycast)');

  // ---------------------------------------------------------- parcours DNS
  console.log('Parcours complet');
  d.getElementById('saisie-domaine').value = 'https://www.Alibaba.com/produits?x=1';
  d.getElementById('form-dns').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await attendre();
  const resDns = texte(w, 'resultat-dns');
  verifier(/2 adresses IP/.test(resDns) && /alibabadns/.test(resDns), 'URL complète nettoyée, alias + 2 IP affichés');
  verifier(/Google Public DNS/.test(resDns), 'source : Google Public DNS');
  d.querySelector('[data-ip="47.246.131.198"]').click();
  verifier(!d.getElementById('pari').hidden, 'clic sur l\'IP → le pari s\'affiche');
  d.querySelector('[data-continent="AS"]').click();
  const resIP = texte(w, 'resultat-ip');
  console.log('     →', resIP.slice(0, 160));
  verifier(/www\.alibaba\.com/.test(resIP), 'le nom du site est rappelé avec le pays');
  verifier(d.querySelectorAll('#tampons .tampon').length === 2, 'deux tampons dans le passeport (Cloudflare + alibaba)');
  verifier(d.querySelector('#defis li.reussi') !== null, 'défis réussis cochés (plusieurs IP, alibaba)');
  verifier(d.querySelectorAll('#historique tr').length === 3, 'trois lignes dans « Mes découvertes » (mon IP, Cloudflare, alibaba)');
  verifier(d.querySelector('#calque-trajet .epingle') !== null, 'épingle posée sur la carte');
  await attendre(2500); // les gains s'affichent l'un après l'autre
  verifier(Number(texte(w, 'score')) > 0, 'score animé : ' + texte(w, 'score') + ' points');

  d.getElementById('saisie-domaine').value = 'existepas.fr';
  d.getElementById('form-dns').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await attendre();
  verifier(/n'existe pas/.test(texte(w, 'resultat-dns')), 'domaine inexistant → message clair');

  d.getElementById('saisie-domaine').value = 'gov.hk';
  d.getElementById('form-dns').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await attendre();
  verifier(/www\.gov\.hk/.test(texte(w, 'resultat-dns')), 'gov.hk sans IP → réessai automatique avec www.');

  d.getElementById('saisie-domaine').value = 'wikipedia';
  d.getElementById('form-dns').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await attendre();
  verifier(/extension/.test(texte(w, 'resultat-dns')), '« wikipedia » sans extension → message');

  // ----------------------------------------------------------- mode secours
  console.log('Mode secours (annuaires bloqués)');
  const ws = chargerSite(async () => { throw new TypeError('Failed to fetch'); });
  const ds = ws.document;
  ds.getElementById('saisie-domaine').value = 'tiktok.com';
  ds.getElementById('form-dns').dispatchEvent(new ws.Event('submit', { cancelable: true }));
  await attendre();
  verifier(!ds.getElementById('bandeau-secours').hidden, 'bandeau « mode secours » affiché');
  verifier(/par défaut à Hong Kong/.test(texte(ws, 'moi')) && /par défaut à Hong Kong/.test(texte(ws, 'legende-carte')),
    'IP introuvable → point jaune par défaut à Hong Kong, et c\'est écrit');
  verifier(ds.querySelectorAll('.bouton-ip').length > 0 && /liste de secours/.test(texte(ws, 'resultat-dns')), 'tiktok.com trouvé dans la liste de secours');
  ds.getElementById('saisie-domaine').value = 'sitepasdanslaliste.com';
  ds.getElementById('form-dns').dispatchEvent(new ws.Event('submit', { cancelable: true }));
  await attendre();
  verifier(ds.querySelectorAll('#resultat-dns .puce').length > 40, 'site absent → liste de secours proposée en boutons');

  console.log(echecs ? `\n${echecs} échec(s)` : '\nTout est bon ✅');
  process.exit(echecs ? 1 : 0);
})();
